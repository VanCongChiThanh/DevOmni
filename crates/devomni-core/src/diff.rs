//! Diff engine: line diff on interned comparison keys + word-level inline diff.
//!
//! Output is a flat list of **aligned rows** — exactly what a side-by-side
//! viewer renders, so the frontend does no diff logic at all. Rows reference
//! line indices instead of copying text, keeping IPC payloads small.

use std::collections::HashMap;
use std::time::Instant;

use serde::{Deserialize, Serialize};
use similar::{capture_diff_slices, capture_diff_slices_deadline, Algorithm, DiffTag};

use crate::normalize::Normalized;

/// `[start, end)` in UTF-16 code units, so JS can slice strings directly.
pub type Span = (u32, u32);

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum DiffAlgorithm {
    #[default]
    Myers,
    Patience,
}

impl From<DiffAlgorithm> for Algorithm {
    fn from(a: DiffAlgorithm) -> Self {
        match a {
            DiffAlgorithm::Myers => Algorithm::Myers,
            DiffAlgorithm::Patience => Algorithm::Patience,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum RowKind {
    /// Identical text.
    Equal,
    /// Same comparison key, different text (differs only in ignored aspects).
    Similar,
    /// Both sides present, keys differ.
    Changed,
    /// Left only.
    Deleted,
    /// Right only.
    Inserted,
    /// Line excluded from comparison (comment-only / blank, per options).
    Ignored,
}

impl RowKind {
    pub fn is_change(self) -> bool {
        matches!(self, RowKind::Changed | RowKind::Deleted | RowKind::Inserted)
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Row {
    pub kind: RowKind,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub left: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub right: Option<u32>,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub left_spans: Vec<Span>,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub right_spans: Vec<Span>,
}

impl Row {
    fn new(kind: RowKind, left: Option<usize>, right: Option<usize>) -> Self {
        Row {
            kind,
            left: left.map(|l| l as u32),
            right: right.map(|r| r as u32),
            left_spans: Vec::new(),
            right_spans: Vec::new(),
        }
    }
}

/// Row range `[start, end)` of a contiguous block of changes.
#[derive(Debug, Clone, Copy, Serialize)]
pub struct Hunk {
    pub start: u32,
    pub end: u32,
}

#[derive(Debug, Clone, Copy, Default, Serialize)]
pub struct DiffStats {
    pub added: u32,
    pub removed: u32,
    pub changed: u32,
    pub hunks: u32,
}

#[derive(Debug, Clone)]
pub struct DiffOutput {
    pub rows: Vec<Row>,
    pub hunks: Vec<Hunk>,
    pub stats: DiffStats,
    /// The deadline was hit; the diff is valid but may not be minimal.
    pub timed_out: bool,
}

pub fn diff(
    left: &Normalized,
    right: &Normalized,
    algorithm: DiffAlgorithm,
    deadline: Option<Instant>,
) -> DiffOutput {
    // Interning turns string comparisons into u32 comparisons — a big win for
    // Myers on large files where each key is compared many times.
    let (a, b) = intern(&left.keys, &right.keys);
    let ops = capture_diff_slices_deadline(algorithm.into(), &a, &b, deadline);
    let timed_out = deadline.is_some_and(|d| Instant::now() >= d);

    let mut builder = RowBuilder::new(left, right);
    for op in &ops {
        let (tag, o, n) = op.as_tag_tuple();
        match tag {
            DiffTag::Equal => {
                for k in 0..o.len() {
                    builder.pair(left.key_lines[o.start + k], right.key_lines[n.start + k], false);
                }
            }
            DiffTag::Delete => {
                for i in o {
                    builder.left_only(left.key_lines[i]);
                }
            }
            DiffTag::Insert => {
                for j in n {
                    builder.right_only(right.key_lines[j]);
                }
            }
            DiffTag::Replace => {
                let common = o.len().min(n.len());
                for k in 0..common {
                    builder.pair(left.key_lines[o.start + k], right.key_lines[n.start + k], true);
                }
                for i in o.start + common..o.end {
                    builder.left_only(left.key_lines[i]);
                }
                for j in n.start + common..n.end {
                    builder.right_only(right.key_lines[j]);
                }
            }
        }
    }
    builder.finish(timed_out)
}

fn intern<'a>(a: &'a [String], b: &'a [String]) -> (Vec<u32>, Vec<u32>) {
    let mut table: HashMap<&'a str, u32> = HashMap::with_capacity(a.len() + b.len());
    let mut ids = |side: &'a [String]| -> Vec<u32> {
        side.iter()
            .map(|s| {
                let next = table.len() as u32;
                *table.entry(s.as_str()).or_insert(next)
            })
            .collect()
    };
    let ia = ids(a);
    let ib = ids(b);
    (ia, ib)
}

struct RowBuilder<'a> {
    left: &'a Normalized,
    right: &'a Normalized,
    rows: Vec<Row>,
    /// Next display line on each side that has not been emitted yet.
    next_l: usize,
    next_r: usize,
}

impl<'a> RowBuilder<'a> {
    fn new(left: &'a Normalized, right: &'a Normalized) -> Self {
        RowBuilder {
            left,
            right,
            rows: Vec::with_capacity(left.display.len().max(right.display.len()) + 16),
            next_l: 0,
            next_r: 0,
        }
    }

    /// Emit display lines skipped by normalization as `Ignored` rows, pairing
    /// both sides' skipped lines side by side.
    fn flush_ignored(&mut self, l_end: usize, r_end: usize) {
        let nl = l_end.saturating_sub(self.next_l);
        let nr = r_end.saturating_sub(self.next_r);
        for k in 0..nl.max(nr) {
            let l = (k < nl).then(|| self.next_l + k);
            let r = (k < nr).then(|| self.next_r + k);
            self.rows.push(Row::new(RowKind::Ignored, l, r));
        }
        self.next_l = self.next_l.max(l_end);
        self.next_r = self.next_r.max(r_end);
    }

    fn pair(&mut self, l: usize, r: usize, changed: bool) {
        self.flush_ignored(l, r);
        let (left, right) = (self.left, self.right);
        let lt = &left.display[l];
        let rt = &right.display[r];
        let row = if changed {
            let (ls, rs) = inline_spans(lt, rt);
            Row { left_spans: ls, right_spans: rs, ..Row::new(RowKind::Changed, Some(l), Some(r)) }
        } else {
            let kind = if lt == rt { RowKind::Equal } else { RowKind::Similar };
            Row::new(kind, Some(l), Some(r))
        };
        self.rows.push(row);
        self.next_l = l + 1;
        self.next_r = r + 1;
    }

    fn left_only(&mut self, l: usize) {
        self.flush_ignored(l, self.next_r);
        self.rows.push(Row::new(RowKind::Deleted, Some(l), None));
        self.next_l = l + 1;
    }

    fn right_only(&mut self, r: usize) {
        self.flush_ignored(self.next_l, r);
        self.rows.push(Row::new(RowKind::Inserted, None, Some(r)));
        self.next_r = r + 1;
    }

    fn finish(mut self, timed_out: bool) -> DiffOutput {
        self.flush_ignored(self.left.display.len(), self.right.display.len());

        let mut stats = DiffStats::default();
        let mut hunks = Vec::new();
        let mut start: Option<usize> = None;
        for (i, row) in self.rows.iter().enumerate() {
            match row.kind {
                RowKind::Changed => stats.changed += 1,
                RowKind::Deleted => stats.removed += 1,
                RowKind::Inserted => stats.added += 1,
                _ => {}
            }
            match (row.kind.is_change(), start) {
                (true, None) => start = Some(i),
                (false, Some(s)) => {
                    hunks.push(Hunk { start: s as u32, end: i as u32 });
                    start = None;
                }
                _ => {}
            }
        }
        if let Some(s) = start {
            hunks.push(Hunk { start: s as u32, end: self.rows.len() as u32 });
        }
        stats.hunks = hunks.len() as u32;

        DiffOutput { rows: self.rows, hunks, stats, timed_out }
    }
}

// ── Inline (word-level) diff ─────────────────────────────────────────────────

const INLINE_MAX_BYTES: usize = 2_000;

fn inline_spans(a: &str, b: &str) -> (Vec<Span>, Vec<Span>) {
    if a.len() > INLINE_MAX_BYTES || b.len() > INLINE_MAX_BYTES {
        return (Vec::new(), Vec::new());
    }
    let ta = tokenize(a);
    let tb = tokenize(b);
    let ops = capture_diff_slices(Algorithm::Myers, &ta, &tb);
    let oa = utf16_offsets(&ta);
    let ob = utf16_offsets(&tb);

    let mut ls = Vec::new();
    let mut rs = Vec::new();
    for op in &ops {
        let (tag, o, n) = op.as_tag_tuple();
        if tag == DiffTag::Equal {
            continue;
        }
        if !o.is_empty() {
            push_span(&mut ls, (oa[o.start], oa[o.end]));
        }
        if !n.is_empty() {
            push_span(&mut rs, (ob[n.start], ob[n.end]));
        }
    }

    // A near-total rewrite is clearer as a whole-line change than as confetti.
    let total_a = *oa.last().unwrap_or(&0);
    let total_b = *ob.last().unwrap_or(&0);
    let covered = |spans: &[Span]| spans.iter().map(|(s, e)| e - s).sum::<u32>();
    if total_a > 0 && total_b > 0 && covered(&ls) * 10 > total_a * 7 && covered(&rs) * 10 > total_b * 7 {
        return (Vec::new(), Vec::new());
    }
    (ls, rs)
}

fn push_span(spans: &mut Vec<Span>, s: Span) {
    if s.1 <= s.0 {
        return;
    }
    if let Some(last) = spans.last_mut() {
        if last.1 >= s.0 {
            last.1 = last.1.max(s.1);
            return;
        }
    }
    spans.push(s);
}

fn utf16_offsets(tokens: &[&str]) -> Vec<u32> {
    let mut v = Vec::with_capacity(tokens.len() + 1);
    let mut acc = 0u32;
    v.push(0);
    for t in tokens {
        acc += t.encode_utf16().count() as u32;
        v.push(acc);
    }
    v
}

/// Words (`[A-Za-z0-9_]+` incl. Unicode), whitespace runs, single punctuation chars.
fn tokenize(s: &str) -> Vec<&str> {
    #[derive(Clone, Copy, PartialEq)]
    enum Class {
        Word,
        Space,
        Punct,
    }
    fn class(c: char) -> Class {
        if c.is_alphanumeric() || c == '_' {
            Class::Word
        } else if c.is_whitespace() {
            Class::Space
        } else {
            Class::Punct
        }
    }

    let mut tokens = Vec::new();
    let mut start = 0usize;
    let mut prev: Option<Class> = None;
    for (i, c) in s.char_indices() {
        let cl = class(c);
        if let Some(p) = prev {
            if p != cl || cl == Class::Punct {
                tokens.push(&s[start..i]);
                start = i;
            }
        }
        prev = Some(cl);
    }
    if start < s.len() {
        tokens.push(&s[start..]);
    }
    tokens
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::language::Language;
    use crate::normalize::{normalize, NormalizeOptions};

    fn run(a: &str, b: &str, o: &NormalizeOptions) -> DiffOutput {
        let l = normalize(a, Language::Plain, o);
        let r = normalize(b, Language::Plain, o);
        diff(&l, &r, DiffAlgorithm::Myers, None)
    }

    fn kinds(out: &DiffOutput) -> Vec<RowKind> {
        out.rows.iter().map(|r| r.kind).collect()
    }

    #[test]
    fn basic_rows_and_hunks() {
        let out = run("a\nb\nc\nd", "a\nB\nc\nd\ne", &NormalizeOptions::default());
        use RowKind::*;
        assert_eq!(kinds(&out), vec![Equal, Changed, Equal, Equal, Inserted]);
        assert_eq!(out.stats.hunks, 2);
        assert_eq!(out.stats.changed, 1);
        assert_eq!(out.stats.added, 1);
    }

    #[test]
    fn whitespace_only_change_is_similar_not_changed() {
        let o = NormalizeOptions { collapse_whitespace: true, trim_trailing_whitespace: true, ..Default::default() };
        let out = run("x  =  1 ", "x = 1", &o);
        assert_eq!(kinds(&out), vec![RowKind::Similar]);
        assert!(out.hunks.is_empty());
    }

    #[test]
    fn ignored_lines_are_still_rendered() {
        let o = NormalizeOptions { ignore_blank_lines: true, ..Default::default() };
        let out = run("a\n\nb", "a\nb", &o);
        use RowKind::*;
        assert_eq!(kinds(&out), vec![Equal, Ignored, Equal]);
        assert_eq!(out.rows[1].left, Some(1));
        assert_eq!(out.rows[1].right, None);
        assert_eq!(out.rows[2].left, Some(2));
        assert_eq!(out.rows[2].right, Some(1));
    }

    #[test]
    fn inline_spans_use_utf16_offsets() {
        let (l, r) = inline_spans("let ü = foo(1);", "let ü = foo(2);");
        assert_eq!(l, vec![(12, 13)]);
        assert_eq!(r, vec![(12, 13)]);
    }

    #[test]
    fn tokenizer() {
        assert_eq!(tokenize("a.b  c"), vec!["a", ".", "b", "  ", "c"]);
    }
}
