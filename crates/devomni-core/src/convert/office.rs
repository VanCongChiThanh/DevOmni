//! Office-app conversions Pandoc can't do: legacy `.doc` → `.docx`, and
//! `.docx` → `.pdf` (a faithful PDF without installing LaTeX).
//!
//! Uses LibreOffice (headless) when installed, otherwise on Windows Microsoft
//! Word or WPS Writer through COM automation. Nothing runs if neither exists.

use std::fs;
use std::path::{Path, PathBuf};
use std::sync::OnceLock;
use std::time::Duration;

use super::{fail, run};
use crate::error::CoreError;

const TIMEOUT: Duration = Duration::from_secs(240);

#[derive(Debug, Clone)]
pub enum OfficeApp {
    LibreOffice(PathBuf),
    /// Word or WPS via COM (Windows).
    WindowsCom(&'static str),
}

impl OfficeApp {
    pub fn label(&self) -> &'static str {
        match self {
            OfficeApp::LibreOffice(_) => "LibreOffice",
            OfficeApp::WindowsCom(name) => name,
        }
    }
}

#[derive(Debug, Clone, Copy)]
pub enum OfficeFormat {
    Docx,
    Pdf,
}

/// Detected once per process (installing Office mid-session needs a restart).
pub fn detect() -> Option<OfficeApp> {
    static APP: OnceLock<Option<OfficeApp>> = OnceLock::new();
    APP.get_or_init(|| {
        let mut candidates: Vec<PathBuf> = Vec::new();
        if let Ok(p) = which::which("soffice") {
            candidates.push(p);
        }
        if cfg!(windows) {
            for var in ["ProgramFiles", "ProgramFiles(x86)"] {
                if let Some(base) = std::env::var_os(var) {
                    candidates.push(PathBuf::from(base).join("LibreOffice").join("program").join("soffice.exe"));
                }
            }
        } else {
            candidates.push("/Applications/LibreOffice.app/Contents/MacOS/soffice".into());
            candidates.push("/usr/bin/soffice".into());
            candidates.push("/usr/bin/libreoffice".into());
        }
        if let Some(p) = candidates.into_iter().find(|p| p.is_file()) {
            return Some(OfficeApp::LibreOffice(p));
        }
        if cfg!(windows) {
            for (prog_id, name) in [("Word.Application", "Microsoft Word"), ("KWps.Application", "WPS Writer")] {
                let key = format!(r"HKEY_CLASSES_ROOT\{prog_id}\CLSID");
                if run(Path::new("reg"), &["query".into(), key], None, None, Duration::from_secs(10)).is_ok() {
                    return Some(OfficeApp::WindowsCom(name));
                }
            }
        }
        None
    })
    .clone()
}

/// Convert `input` into `out_dir` (which must exist); returns the new file.
pub fn convert(input: &Path, out_dir: &Path, to: OfficeFormat) -> Result<PathBuf, CoreError> {
    let app = detect().ok_or_else(|| {
        fail("this needs LibreOffice, Microsoft Word or WPS Office installed (none was found)")
    })?;
    let ext = match to {
        OfficeFormat::Docx => "docx",
        OfficeFormat::Pdf => "pdf",
    };
    let stem = input.file_stem().map(|s| s.to_string_lossy().into_owned()).unwrap_or_else(|| "document".into());
    let out = out_dir.join(format!("{stem}.{ext}"));
    let abs_in = fs::canonicalize(input)?;

    match &app {
        OfficeApp::LibreOffice(soffice) => {
            // A private profile dir keeps this working while LibreOffice is open.
            let profile = out_dir.join("lo-profile");
            let profile_url = format!("-env:UserInstallation=file:///{}", profile.to_string_lossy().replace('\\', "/"));
            let args = vec![
                profile_url,
                "--headless".into(),
                "--norestore".into(),
                "--convert-to".into(),
                ext.into(),
                "--outdir".into(),
                out_dir.to_string_lossy().into_owned(),
                plain(&abs_in),
            ];
            run(soffice, &args, None, Some(out_dir), TIMEOUT)?;
        }
        OfficeApp::WindowsCom(_) => {
            let script = out_dir.join("convert.ps1");
            fs::write(&script, COM_SCRIPT)?;
            let args = vec![
                "-NoProfile".into(),
                "-NonInteractive".into(),
                "-ExecutionPolicy".into(),
                "Bypass".into(),
                "-File".into(),
                plain(&script),
                "-In".into(),
                plain(&abs_in),
                "-Out".into(),
                out.to_string_lossy().into_owned(),
                "-Format".into(),
                ext.into(),
            ];
            run(Path::new("powershell"), &args, None, Some(out_dir), TIMEOUT)?;
        }
    }
    if !out.is_file() {
        return Err(fail(format!("{} did not produce a .{ext} file", app.label())));
    }
    Ok(out)
}

/// `canonicalize` on Windows yields `\\?\C:\…`, which Office apps reject.
fn plain(p: &Path) -> String {
    let s = p.to_string_lossy();
    s.strip_prefix(r"\\?\").unwrap_or(&s).to_owned()
}

/// Paths arrive as parameters (never spliced into code). Word and WPS share the
/// Word object model; SaveAs2 is missing in old versions, hence the fallback.
const COM_SCRIPT: &str = r#"param([string]$In, [string]$Out, [string]$Format)
$ErrorActionPreference = 'Stop'
$app = $null
foreach ($id in 'Word.Application', 'KWps.Application') {
  try { $app = New-Object -ComObject $id; break } catch { }
}
if (-not $app) { throw 'Neither Microsoft Word nor WPS Writer could be started.' }
try { $app.Visible = $false } catch { }
try { $app.DisplayAlerts = 0 } catch { }
$doc = $null
try {
  $doc = $app.Documents.Open($In, $false, $true)
  if ($Format -eq 'pdf') {
    $doc.ExportAsFixedFormat($Out, 17)
  } else {
    try { $doc.SaveAs2($Out, 16) } catch { $doc.SaveAs($Out, 16) }
  }
} finally {
  if ($doc) { try { $doc.Close($false) } catch { } }
  try { $app.Quit() } catch { }
  [System.Runtime.InteropServices.Marshal]::ReleaseComObject($app) | Out-Null
}
"#;
