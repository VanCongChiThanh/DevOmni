//! Language-aware comment stripper.
//!
//! A small lexer state machine that knows about strings (so `"http://x"` is not
//! a comment) and preserves every `\n`, so output line `i` maps to input line `i`.

use crate::language::CommentSyntax;

#[derive(Clone, Copy)]
enum State {
    Code,
    Str(char),
    LineComment,
    BlockComment,
}

/// Returns the text with comments removed (newlines preserved) and, per line,
/// whether that line contained (or was inside) a comment.
pub fn strip(text: &str, syn: &CommentSyntax) -> (String, Vec<bool>) {
    let mut out = String::with_capacity(text.len());
    let mut had_comment = vec![false];
    let mut state = State::Code;
    let mut i = 0usize;

    macro_rules! mark {
        () => {
            if let Some(last) = had_comment.last_mut() {
                *last = true;
            }
        };
    }

    while i < text.len() {
        let rest = &text[i..];
        let c = match rest.chars().next() {
            Some(c) => c,
            None => break,
        };
        let clen = c.len_utf8();

        match state {
            State::Code => {
                if let Some((open, _)) = syn.block {
                    if rest.starts_with(open) {
                        state = State::BlockComment;
                        mark!();
                        i += open.len();
                        continue;
                    }
                }
                if let Some(tok) = syn.line.iter().find(|t| rest.starts_with(**t)) {
                    state = State::LineComment;
                    mark!();
                    i += tok.len();
                    continue;
                }
                if syn.quotes.contains(&c)
                    && !(c == '\'' && syn.char_literal_heuristic && !looks_like_char_literal(rest))
                {
                    state = State::Str(c);
                }
                if c == '\n' {
                    had_comment.push(false);
                }
                out.push(c);
                i += clen;
            }
            State::Str(q) => {
                out.push(c);
                i += clen;
                if c == '\\' {
                    // Escaped char: copy verbatim.
                    if let Some(n) = text[i..].chars().next() {
                        if n == '\n' {
                            had_comment.push(false);
                        }
                        out.push(n);
                        i += n.len_utf8();
                    }
                } else if c == q {
                    state = State::Code;
                } else if c == '\n' {
                    had_comment.push(false);
                    if syn.multiline_quote != Some(q) {
                        state = State::Code; // unterminated single-line string: recover
                    }
                }
            }
            State::LineComment => {
                if c == '\n' {
                    state = State::Code;
                    out.push('\n');
                    had_comment.push(false);
                }
                i += clen;
            }
            State::BlockComment => {
                let close = syn.block.map(|(_, c)| c).unwrap_or("*/");
                if rest.starts_with(close) {
                    state = State::Code;
                    i += close.len();
                    continue;
                }
                if c == '\n' {
                    out.push('\n');
                    had_comment.push(true); // next line starts inside the comment
                }
                i += clen;
            }
        }
    }

    (out, had_comment)
}

/// `rest` starts with `'`. Distinguish `'a'` / `'\n'` from a Rust lifetime `'a`.
fn looks_like_char_literal(rest: &str) -> bool {
    let mut it = rest.chars().skip(1);
    match it.next() {
        Some('\\') => true,
        Some(_) => it.next() == Some('\''),
        None => false,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::language::Language;

    fn run(lang: Language, src: &str) -> (String, Vec<bool>) {
        strip(src, &lang.comment_syntax().unwrap())
    }

    #[test]
    fn line_and_block() {
        let (s, f) = run(Language::C, "a // x\n/* y\nz */ b");
        assert_eq!(s, "a \n\n b");
        assert_eq!(f, vec![true, true, true]);
    }

    #[test]
    fn markers_inside_strings_are_kept() {
        let (s, _) = run(Language::Javascript, "const u = 'http://x'; // c");
        assert_eq!(s, "const u = 'http://x'; ");
    }

    #[test]
    fn rust_lifetimes_do_not_open_strings() {
        let (s, _) = run(Language::Rust, "fn f<'a>(x: &'a str) {} // c\nlet c = '\"';");
        assert_eq!(s, "fn f<'a>(x: &'a str) {} \nlet c = '\"';");
    }

    #[test]
    fn python_hash() {
        let (s, f) = run(Language::Python, "x = '#no'  # yes\n# only");
        assert_eq!(s, "x = '#no'  \n");
        assert_eq!(f, vec![true, true]);
    }
}
