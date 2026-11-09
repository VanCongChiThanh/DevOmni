use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Language {
    Plain,
    Javascript,
    Typescript,
    Json,
    Rust,
    C,
    Cpp,
    Csharp,
    Java,
    Go,
    Kotlin,
    Swift,
    Php,
    Python,
    Ruby,
    Shell,
    Yaml,
    Toml,
    Sql,
    Plsql,
    Html,
    Xml,
    Css,
    Scss,
    Markdown,
}

/// Lexical comment/string rules used by the comment stripper.
#[derive(Debug, Clone, Copy)]
pub struct CommentSyntax {
    pub line: &'static [&'static str],
    pub block: Option<(&'static str, &'static str)>,
    /// Characters that open a string literal (comment markers inside are ignored).
    pub quotes: &'static [char],
    /// A quote character whose strings may span lines (JS template literals, Go raw strings...).
    pub multiline_quote: Option<char>,
    /// Rust: `'` is a char literal only when it looks like one (`'a'`, `'\n'`), otherwise a lifetime.
    pub char_literal_heuristic: bool,
}

const C_LIKE: CommentSyntax = CommentSyntax {
    line: &["//"],
    block: Some(("/*", "*/")),
    quotes: &['"', '\''],
    multiline_quote: None,
    char_literal_heuristic: false,
};

const HASH: CommentSyntax = CommentSyntax {
    line: &["#"],
    block: None,
    quotes: &['"', '\''],
    multiline_quote: None,
    char_literal_heuristic: false,
};

const MARKUP: CommentSyntax = CommentSyntax {
    line: &[],
    block: Some(("<!--", "-->")),
    quotes: &[],
    multiline_quote: None,
    char_literal_heuristic: false,
};

impl Language {
    pub fn from_path(path: &str) -> Language {
        let lower = path.to_ascii_lowercase();
        let file = lower.rsplit(['/', '\\']).next().unwrap_or(lower.as_str());
        match file {
            "dockerfile" | "makefile" | ".bashrc" | ".zshrc" | ".env" => return Language::Shell,
            _ => {}
        }
        let ext = file.rsplit_once('.').map(|(_, e)| e).unwrap_or("");
        Language::from_extension(ext)
    }

    pub fn from_extension(ext: &str) -> Language {
        match ext {
            "js" | "mjs" | "cjs" | "jsx" => Language::Javascript,
            "ts" | "mts" | "cts" | "tsx" => Language::Typescript,
            "json" | "jsonc" | "json5" => Language::Json,
            "rs" => Language::Rust,
            "c" | "h" => Language::C,
            "cc" | "cpp" | "cxx" | "hpp" | "hh" | "hxx" => Language::Cpp,
            "cs" => Language::Csharp,
            "java" => Language::Java,
            "go" => Language::Go,
            "kt" | "kts" => Language::Kotlin,
            "swift" => Language::Swift,
            "php" => Language::Php,
            "py" | "pyi" => Language::Python,
            "rb" => Language::Ruby,
            "sh" | "bash" | "zsh" | "ps1" => Language::Shell,
            "yaml" | "yml" => Language::Yaml,
            "toml" => Language::Toml,
            "sql" => Language::Sql,
            "pks" | "pkb" | "pls" | "plb" | "prc" | "fnc" | "trg" | "tps" | "tpb" => Language::Plsql,
            "html" | "htm" | "vue" | "svelte" => Language::Html,
            "xml" | "svg" | "xaml" | "csproj" | "plist" => Language::Xml,
            "css" => Language::Css,
            "scss" | "sass" | "less" => Language::Scss,
            "md" | "markdown" => Language::Markdown,
            _ => Language::Plain,
        }
    }

    /// Content sniffing for pasted text (no path). Line-start keyword voting
    /// over the first few hundred lines; cheap and good enough to pick a
    /// highlighter/formatter. The user can always override in the UI.
    pub fn sniff(text: &str) -> Language {
        let t = text.trim_start();
        if t.is_empty() {
            return Language::Plain;
        }
        if (t.starts_with('{') || t.starts_with('['))
            && serde_json::from_str::<serde::de::IgnoredAny>(text).is_ok()
        {
            return Language::Json;
        }

        let mut end = text.len().min(64 * 1024);
        while !text.is_char_boundary(end) {
            end -= 1;
        }
        let lower = text[..end].to_lowercase();
        let lt = lower.trim_start();
        if lt.starts_with("<?xml") {
            return Language::Xml;
        }
        if lt.starts_with("<!doctype html") || lt.starts_with("<html") {
            return Language::Html;
        }
        if lt.starts_with("<?php") {
            return Language::Php;
        }
        if lt.starts_with("#!") {
            let first = lt.lines().next().unwrap_or("");
            return if first.contains("python") {
                Language::Python
            } else if first.contains("node") {
                Language::Javascript
            } else {
                Language::Shell
            };
        }

        let (mut sql, mut plsql, mut python, mut rust, mut go) = (0u32, 0u32, 0u32, 0u32, 0u32);
        let (mut js, mut ts, mut java, mut csharp, mut cpp) = (0u32, 0u32, 0u32, 0u32, 0u32);
        let starts = |l: &str, p: &[&str]| p.iter().any(|x| l.starts_with(x));
        let has = |l: &str, p: &[&str]| p.iter().any(|x| l.contains(x));

        for line in lower.lines().take(400) {
            let l = line.trim_start();
            if l.is_empty() {
                continue;
            }
            if starts(l, &["select ", "insert ", "update ", "delete ", "create ", "alter ", "drop ", "grant ",
                "revoke ", "merge ", "truncate ", "comment on ", "commit", "rollback", "with "]) {
                sql += 2;
            }
            if starts(l, &["from ", "where ", "values", "join ", "left join", "inner join", "order by", "group by", "and ", "set "]) {
                sql += 1;
            }
            if l.starts_with("--") {
                sql += 1;
            }
            if has(l, &["varchar2", "nvarchar2", "pls_integer", "dbms_", "sysdate", "nvl(", "raise_application_error",
                "%rowtype", "%type", "bulk collect", "execute immediate", "number("]) {
                plsql += 2;
            }
            if starts(l, &["create or replace", "declare", "begin", "exception", "end;", "elsif ", "end if;", "end loop;"]) {
                plsql += 2;
            }
            if starts(l, &["def ", "elif ", "class "]) && l.trim_end().ends_with(':') {
                python += 2;
            }
            if l.starts_with("from ") && l.contains(" import ") || l.starts_with("import ") && !l.contains(" from ") && !l.ends_with(';') {
                python += 1;
            }
            if starts(l, &["fn ", "pub fn ", "let mut ", "use std", "use crate", "impl ", "pub struct ", "mod ", "#[derive"]) {
                rust += 2;
            }
            if starts(l, &["package ", "func "]) {
                go += 2;
            }
            if starts(l, &["const ", "let ", "function ", "export ", "var "]) || l.starts_with("import ") && l.contains(" from ") {
                js += 1;
            }
            if starts(l, &["interface ", "type ", "export interface", "export type", "enum "]) || has(l, &[": string", ": number", ": boolean"]) {
                ts += 2;
            }
            if starts(l, &["public class ", "private ", "protected ", "public static ", "@override"]) {
                java += 1;
            }
            if starts(l, &["using system", "namespace "]) {
                csharp += 2;
            }
            if l.starts_with("#include") {
                cpp += 3;
            }
        }

        let candidates = [
            (sql + plsql, if plsql >= 2 { Language::Plsql } else { Language::Sql }),
            (python, Language::Python),
            (rust, Language::Rust),
            (go, Language::Go),
            (js + ts, if ts > 0 { Language::Typescript } else { Language::Javascript }),
            (java, Language::Java),
            (csharp, Language::Csharp),
            (cpp, Language::Cpp),
        ];
        candidates
            .iter()
            .filter(|(score, _)| *score >= 2)
            .max_by_key(|(score, _)| *score)
            .map(|(_, lang)| *lang)
            .unwrap_or(Language::Plain)
    }

    /// Default file extension, used as a parser hint for external formatters.
    pub fn extension(self) -> &'static str {
        match self {
            Language::Plain => "txt",
            Language::Javascript => "js",
            Language::Typescript => "ts",
            Language::Json => "json",
            Language::Rust => "rs",
            Language::C => "c",
            Language::Cpp => "cpp",
            Language::Csharp => "cs",
            Language::Java => "java",
            Language::Go => "go",
            Language::Kotlin => "kt",
            Language::Swift => "swift",
            Language::Php => "php",
            Language::Python => "py",
            Language::Ruby => "rb",
            Language::Shell => "sh",
            Language::Yaml => "yaml",
            Language::Toml => "toml",
            Language::Sql | Language::Plsql => "sql",
            Language::Html => "html",
            Language::Xml => "xml",
            Language::Css => "css",
            Language::Scss => "scss",
            Language::Markdown => "md",
        }
    }

    pub fn comment_syntax(self) -> Option<CommentSyntax> {
        use Language::*;
        Some(match self {
            Plain => return None,
            Javascript | Typescript => CommentSyntax {
                quotes: &['"', '\'', '`'],
                multiline_quote: Some('`'),
                ..C_LIKE
            },
            Rust => CommentSyntax {
                multiline_quote: Some('"'),
                char_literal_heuristic: true,
                ..C_LIKE
            },
            Go => CommentSyntax {
                quotes: &['"', '\'', '`'],
                multiline_quote: Some('`'),
                ..C_LIKE
            },
            C | Cpp | Csharp | Java | Kotlin | Swift => C_LIKE,
            Php => CommentSyntax {
                line: &["//", "#"],
                ..C_LIKE
            },
            Json => CommentSyntax {
                quotes: &['"'],
                ..C_LIKE
            },
            Css => CommentSyntax {
                line: &[],
                ..C_LIKE
            },
            Scss => C_LIKE,
            Sql | Plsql => CommentSyntax {
                line: &["--"],
                ..C_LIKE
            },
            Python | Ruby | Shell | Yaml | Toml => HASH,
            Html | Xml | Markdown => MARKUP,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn detects_from_path() {
        assert_eq!(Language::from_path(r"C:\src\App.TSX"), Language::Typescript);
        assert_eq!(Language::from_path("/x/y/Dockerfile"), Language::Shell);
        assert_eq!(Language::from_path("notes"), Language::Plain);
    }

    #[test]
    fn sniffs_json() {
        assert_eq!(Language::sniff("  {\"a\": 1}"), Language::Json);
        assert_eq!(Language::sniff("{ not json"), Language::Plain);
    }

    #[test]
    fn sniffs_sql_and_plsql() {
        assert_eq!(Language::sniff("select a, b
from t
where x = 1;"), Language::Sql);
        let ora = "create table t (
  id number not null,
  name varchar2(30)
);
insert into t values (1, 'a');";
        assert_eq!(Language::sniff(ora), Language::Plsql);
        assert_eq!(Language::sniff("def f(x):
    return x
"), Language::Python);
        assert_eq!(Language::sniff("fn main() {
    let mut x = 1;
}"), Language::Rust);
    }
}
