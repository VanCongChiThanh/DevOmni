//! Formatters that only exist as native CLIs (currently rustfmt, shipped with
//! rustup). Everything else is formatted in the frontend (Prettier, sql-formatter,
//! the PL/SQL formatter, WASM builds of clang-format / gofmt / ruff).
//!
//! The frontend only ever sends a `FormatterId`; the program and its arguments
//! are fixed here, so the webview can never execute an arbitrary command line.

use std::io::{Read, Write};
use std::path::PathBuf;
use std::process::{Command, Stdio};
use std::thread;
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};

pub const DEFAULT_TIMEOUT: Duration = Duration::from_secs(10);

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum FormatterId {
    Prettier,
    ClangFormat,
    Rustfmt,
    Gofmt,
    Black,
}

impl FormatterId {
    pub const ALL: [FormatterId; 5] = [
        FormatterId::Prettier,
        FormatterId::ClangFormat,
        FormatterId::Rustfmt,
        FormatterId::Gofmt,
        FormatterId::Black,
    ];

    pub fn label(self) -> &'static str {
        match self {
            FormatterId::Prettier => "Prettier",
            FormatterId::ClangFormat => "clang-format",
            FormatterId::Rustfmt => "rustfmt",
            FormatterId::Gofmt => "gofmt",
            FormatterId::Black => "Black",
        }
    }

    fn program(self) -> &'static str {
        match self {
            FormatterId::Prettier => "prettier",
            FormatterId::ClangFormat => "clang-format",
            FormatterId::Rustfmt => "rustfmt",
            FormatterId::Gofmt => "gofmt",
            FormatterId::Black => "black",
        }
    }

    fn args(self, ext: &str) -> Vec<String> {
        match self {
            FormatterId::Prettier => vec!["--stdin-filepath".into(), format!("stdin.{ext}")],
            FormatterId::ClangFormat => vec![format!("--assume-filename=stdin.{ext}")],
            FormatterId::Rustfmt => vec!["--edition".into(), "2021".into()],
            FormatterId::Gofmt => vec![],
            FormatterId::Black => vec!["-q".into(), "-".into()],
        }
    }

    fn resolve(self) -> Option<PathBuf> {
        which::which(self.program()).ok()
    }
}

/// Pipe `text` through the formatter (stdin → stdout) with a hard timeout.
pub fn format(id: FormatterId, text: &str, ext: &str, timeout: Duration) -> Result<String, String> {
    let label = id.label();
    let program = id.resolve().ok_or_else(|| format!("{label} not found on PATH"))?;

    let mut cmd = Command::new(program);
    cmd.args(id.args(ext))
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }

    let mut child = cmd.spawn().map_err(|e| format!("failed to start {label}: {e}"))?;

    // Feed stdin and drain stdout/stderr on threads to avoid pipe deadlocks.
    let mut stdin = child.stdin.take().ok_or("stdin unavailable")?;
    let input = text.to_owned();
    let writer = thread::spawn(move || {
        let _ = stdin.write_all(input.as_bytes());
    });
    let mut stdout = child.stdout.take().ok_or("stdout unavailable")?;
    let out_reader = thread::spawn(move || {
        let mut buf = Vec::new();
        let _ = stdout.read_to_end(&mut buf);
        buf
    });
    let mut stderr = child.stderr.take().ok_or("stderr unavailable")?;
    let err_reader = thread::spawn(move || {
        let mut s = String::new();
        let _ = stderr.read_to_string(&mut s);
        s
    });

    let deadline = Instant::now() + timeout;
    let status = loop {
        match child.try_wait() {
            Ok(Some(status)) => break status,
            Ok(None) if Instant::now() >= deadline => {
                let _ = child.kill();
                let _ = child.wait();
                return Err(format!("{label} timed out after {}s", timeout.as_secs()));
            }
            Ok(None) => thread::sleep(Duration::from_millis(5)),
            Err(e) => return Err(format!("{label}: {e}")),
        }
    };

    let _ = writer.join();
    let out = out_reader.join().unwrap_or_default();
    let err = err_reader.join().unwrap_or_default();

    if !status.success() {
        let detail: String = err.lines().take(3).collect::<Vec<_>>().join(" | ");
        return Err(format!("{label} failed: {}", if detail.is_empty() { status.to_string() } else { detail }));
    }
    String::from_utf8(out).map_err(|_| format!("{label} produced non-UTF-8 output"))
}
