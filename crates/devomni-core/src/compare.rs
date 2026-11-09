use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};

use crate::diff::{self, DiffAlgorithm, DiffStats, Hunk, Row};
use crate::error::CoreError;
use crate::language::Language;
use crate::normalize::{normalize, Normalized, Note, NormalizeOptions};

/// Per-side hard limit; beyond this the UI should switch to a streaming mode.
pub const MAX_LINES: usize = 2_000_000;
/// After this, `similar` returns a valid but possibly non-minimal diff.
pub const DIFF_DEADLINE: Duration = Duration::from_secs(4);

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SideInput {
    pub text: String,
    #[serde(default)]
    pub path: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CompareRequest {
    pub left: SideInput,
    pub right: SideInput,
    #[serde(default)]
    pub options: NormalizeOptions,
    /// `None` = auto-detect from paths, then content.
    #[serde(default)]
    pub language: Option<Language>,
    #[serde(default)]
    pub algorithm: DiffAlgorithm,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SideOutput {
    /// Display lines (original text, or rewritten text when `rewritten`).
    pub lines: Vec<String>,
    pub rewritten: bool,
    pub notes: Vec<Note>,
    pub compared_lines: u32,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CompareResponse {
    pub language: Language,
    pub left: SideOutput,
    pub right: SideOutput,
    pub rows: Vec<Row>,
    pub hunks: Vec<Hunk>,
    pub stats: DiffStats,
    pub timed_out: bool,
    pub elapsed_ms: f64,
}

pub fn compare(req: CompareRequest) -> Result<CompareResponse, CoreError> {
    let started = Instant::now();

    for side in [&req.left, &req.right] {
        let lines = side.text.bytes().filter(|b| *b == b'\n').count() + 1;
        if lines > MAX_LINES {
            return Err(CoreError::TooManyLines { lines, limit: MAX_LINES });
        }
    }

    let language = req.language.unwrap_or_else(|| detect_language(&req.left, &req.right));

    // Normalize both sides in parallel.
    let (l, r) = std::thread::scope(|s| {
        let handle = s.spawn(|| normalize(&req.left.text, language, &req.options));
        let r = normalize(&req.right.text, language, &req.options);
        (handle.join().expect("normalizer thread panicked"), r)
    });

    let out = diff::diff(&l, &r, req.algorithm, Some(Instant::now() + DIFF_DEADLINE));

    Ok(CompareResponse {
        language,
        left: side_output(l),
        right: side_output(r),
        rows: out.rows,
        hunks: out.hunks,
        stats: out.stats,
        timed_out: out.timed_out,
        elapsed_ms: started.elapsed().as_secs_f64() * 1000.0,
    })
}

fn side_output(n: Normalized) -> SideOutput {
    SideOutput {
        compared_lines: n.keys.len() as u32,
        lines: n.display,
        rewritten: n.rewritten,
        notes: n.notes,
    }
}

/// Path extension wins; `.sql` is upgraded to PL/SQL when the content is Oracle.
/// Without paths (pasted text) the content decides.
pub fn detect_language(left: &SideInput, right: &SideInput) -> Language {
    let sniffed = || match Language::sniff(&left.text) {
        Language::Plain => Language::sniff(&right.text),
        l => l,
    };
    let from_path = [left.path.as_deref(), right.path.as_deref()]
        .into_iter()
        .flatten()
        .map(Language::from_path)
        .find(|l| *l != Language::Plain);
    match from_path {
        Some(Language::Sql) if sniffed() == Language::Plsql => Language::Plsql,
        Some(l) => l,
        None => sniffed(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn end_to_end_json_semantic_compare() {
        let req = CompareRequest {
            left: SideInput { text: r#"{"name":"a","version":1}"#.into(), path: None },
            right: SideInput { text: "{\n  \"version\": 1,\n  \"name\": \"a\"\n}\n".into(), path: None },
            options: NormalizeOptions { sort_json_keys: true, ..Default::default() },
            language: None,
            algorithm: DiffAlgorithm::Myers,
        };
        let res = compare(req).unwrap();
        assert_eq!(res.language, Language::Json);
        assert_eq!(res.stats.hunks, 0, "key order must not matter");
    }
}
