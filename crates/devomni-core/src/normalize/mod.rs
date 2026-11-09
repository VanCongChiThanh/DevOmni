//! Pre-compare normalization — the "smart alignment" engine.
//!
//! Two kinds of passes:
//!
//! 1. **Rewrites** (JSON key sorting) replace the document. Code formatting
//!    happens in the frontend before the text reaches this crate.
//!    The UI then shows the rewritten text and flags the side as `rewritten`.
//! 2. **Key transforms** (whitespace, case, comments, blank lines) only change
//!    the per-line comparison key. Display text stays the original, and every
//!    key remembers which display line it came from (`key_lines`), so dropped
//!    lines (comment-only, blank) are still rendered as "ignored" rows.

mod comments;
pub mod external;
mod json;

use std::borrow::Cow;

use serde::{Deserialize, Serialize};

use crate::language::Language;

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct NormalizeOptions {
    pub trim_trailing_whitespace: bool,
    pub ignore_indentation: bool,
    /// Collapse runs of inner whitespace to one space (indentation is kept).
    pub collapse_whitespace: bool,
    pub ignore_all_whitespace: bool,
    /// Expand tabs to this many columns before comparing (tabs vs spaces).
    pub tab_width: Option<u8>,
    pub ignore_case: bool,
    pub ignore_blank_lines: bool,
    pub strip_comments: bool,
    pub sort_json_keys: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum NoteLevel {
    Info,
    Warn,
}

#[derive(Debug, Clone, Serialize)]
pub struct Note {
    pub level: NoteLevel,
    pub message: String,
}

impl Note {
    fn info(message: impl Into<String>) -> Self {
        Note { level: NoteLevel::Info, message: message.into() }
    }
    fn warn(message: impl Into<String>) -> Self {
        Note { level: NoteLevel::Warn, message: message.into() }
    }
}

#[derive(Debug, Clone)]
pub struct Normalized {
    /// Lines shown to the user.
    pub display: Vec<String>,
    /// Comparison keys fed to the diff algorithm.
    pub keys: Vec<String>,
    /// `key_lines[k]` = index into `display` that produced `keys[k]` (strictly increasing).
    pub key_lines: Vec<usize>,
    /// True when `display` differs from the input (JSON sort applied).
    pub rewritten: bool,
    pub notes: Vec<Note>,
}

pub fn normalize(text: &str, language: Language, opts: &NormalizeOptions) -> Normalized {
    let mut notes = Vec::new();
    let mut rewritten = false;
    let mut text = canonical_newlines(text);

    // ── Stage 1: document rewrites ───────────────────────────────────────────
    if opts.sort_json_keys && language == Language::Json && !text.trim().is_empty() {
        match json::sort_keys(&text) {
            Ok(out) => {
                if out != text {
                    rewritten = true;
                    text = out;
                }
                notes.push(Note::info("JSON keys sorted"));
            }
            Err(e) => notes.push(Note::warn(e)),
        }
    }

    let display: Vec<String> = split_lines(&text).into_iter().map(str::to_owned).collect();

    // ── Stage 2: comment stripping (needs the whole text: block comments span lines)
    let stripped: Option<(Vec<String>, Vec<bool>)> = if opts.strip_comments {
        match language.comment_syntax() {
            Some(syntax) => {
                let (s, flags) = comments::strip(&text, &syntax);
                let lines = split_lines(&s).into_iter().map(str::to_owned).collect();
                Some((lines, flags))
            }
            None => {
                notes.push(Note::warn(format!("No comment syntax known for {:?}", language)));
                None
            }
        }
    } else {
        None
    };

    // ── Stage 3: per-line comparison keys ────────────────────────────────────
    let mut keys = Vec::with_capacity(display.len());
    let mut key_lines = Vec::with_capacity(display.len());
    for (i, line) in display.iter().enumerate() {
        let base: &str = match &stripped {
            Some((lines, had_comment)) => {
                let s = lines.get(i).map(String::as_str).unwrap_or("");
                if had_comment.get(i).copied().unwrap_or(false) && s.trim().is_empty() {
                    continue; // comment-only line
                }
                s
            }
            None => line.as_str(),
        };
        let key = line_key(base, opts);
        if opts.ignore_blank_lines && key.trim().is_empty() {
            continue;
        }
        keys.push(key);
        key_lines.push(i);
    }

    Normalized { display, keys, key_lines, rewritten, notes }
}

fn canonical_newlines(s: &str) -> String {
    let s = s.strip_prefix('\u{feff}').unwrap_or(s);
    if !s.contains('\r') {
        return s.to_owned();
    }
    s.replace("\r\n", "\n").replace('\r', "\n")
}

/// Split into lines; a single trailing newline does not create an extra empty line.
fn split_lines(s: &str) -> Vec<&str> {
    if s.is_empty() {
        return Vec::new();
    }
    s.strip_suffix('\n').unwrap_or(s).split('\n').collect()
}

fn line_key(line: &str, o: &NormalizeOptions) -> String {
    let mut s: Cow<'_, str> = Cow::Borrowed(line);

    if let Some(w) = o.tab_width.filter(|w| *w > 0) {
        if s.contains('\t') {
            s = Cow::Owned(expand_tabs(&s, w as usize));
        }
    }

    if o.ignore_all_whitespace {
        if s.chars().any(char::is_whitespace) {
            s = Cow::Owned(s.chars().filter(|c| !c.is_whitespace()).collect());
        }
    } else {
        if o.trim_trailing_whitespace {
            let t = s.trim_end();
            if t.len() != s.len() {
                s = Cow::Owned(t.to_owned());
            }
        }
        if o.ignore_indentation {
            let t = s.trim_start();
            if t.len() != s.len() {
                s = Cow::Owned(t.to_owned());
            }
        }
        if o.collapse_whitespace {
            s = Cow::Owned(collapse_inner_whitespace(&s));
        }
    }

    if o.ignore_case {
        s = Cow::Owned(s.to_lowercase());
    }
    s.into_owned()
}

fn expand_tabs(s: &str, width: usize) -> String {
    let mut out = String::with_capacity(s.len() + width * 2);
    let mut col = 0usize;
    for c in s.chars() {
        if c == '\t' {
            let n = width - (col % width);
            out.extend(std::iter::repeat(' ').take(n));
            col += n;
        } else {
            out.push(c);
            col += 1;
        }
    }
    out
}

fn collapse_inner_whitespace(s: &str) -> String {
    let lead_len = s.len() - s.trim_start().len();
    let (lead, rest) = s.split_at(lead_len);
    let mut out = String::with_capacity(s.len());
    out.push_str(lead);
    let mut in_ws = false;
    for c in rest.chars() {
        if c.is_whitespace() {
            if !in_ws {
                out.push(' ');
                in_ws = true;
            }
        } else {
            out.push(c);
            in_ws = false;
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    fn opts() -> NormalizeOptions {
        NormalizeOptions::default()
    }

    #[test]
    fn crlf_and_trailing_newline() {
        let n = normalize("a\r\nb\r\n", Language::Plain, &opts());
        assert_eq!(n.display, vec!["a", "b"]);
        assert_eq!(n.key_lines, vec![0, 1]);
    }

    #[test]
    fn tabs_vs_spaces() {
        let o = NormalizeOptions { tab_width: Some(4), ..opts() };
        let a = normalize("\tfoo()", Language::Plain, &o);
        let b = normalize("    foo()", Language::Plain, &o);
        assert_eq!(a.keys, b.keys);
        assert_eq!(a.display, vec!["\tfoo()"]); // display untouched
    }

    #[test]
    fn collapse_keeps_indentation() {
        assert_eq!(collapse_inner_whitespace("  a   b \t c"), "  a b c");
    }

    #[test]
    fn strips_comment_only_lines_but_keeps_display() {
        let o = NormalizeOptions { strip_comments: true, trim_trailing_whitespace: true, ..opts() };
        let src = "let a = 1; // one\n/* block\n   still */\nlet b = \"// not a comment\";";
        let n = normalize(src, Language::Typescript, &o);
        assert_eq!(n.display.len(), 4);
        assert_eq!(n.key_lines, vec![0, 3]);
        assert_eq!(n.keys[0], "let a = 1;");
        assert_eq!(n.keys[1], "let b = \"// not a comment\";");
    }

    #[test]
    fn blank_lines_ignored() {
        let o = NormalizeOptions { ignore_blank_lines: true, ..opts() };
        let n = normalize("a\n\n   \nb", Language::Plain, &o);
        assert_eq!(n.key_lines, vec![0, 3]);
    }

    #[test]
    fn json_sorting_rewrites() {
        let o = NormalizeOptions { sort_json_keys: true, ..opts() };
        let n = normalize(r#"{"b":1,"a":{"d":2,"c":3}}"#, Language::Json, &o);
        assert!(n.rewritten);
        assert_eq!(n.display[1].trim(), "\"a\": {");
        assert_eq!(n.display[2].trim(), "\"c\": 3,");
    }

    #[test]
    fn invalid_json_warns_and_keeps_text() {
        let o = NormalizeOptions { sort_json_keys: true, ..opts() };
        let n = normalize("{ broken", Language::Json, &o);
        assert!(!n.rewritten);
        assert_eq!(n.notes[0].level, NoteLevel::Warn);
    }
}
