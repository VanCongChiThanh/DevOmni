//! Which files DevOmni can convert, and to what.
//!
//! Rule of thumb: Markdown goes *out* to the format the user picks; every other
//! document comes *in* as Markdown.

use std::path::Path;

use serde::{Deserialize, Serialize};

/// Output format.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Target {
    Md,
    Docx,
    Pdf,
    Odt,
    Rtf,
    Html,
    Epub,
    Pptx,
    Latex,
}

impl Target {
    /// What a Markdown file can become, in menu order.
    pub const FROM_MARKDOWN: [Target; 8] =
        [Target::Docx, Target::Pdf, Target::Odt, Target::Rtf, Target::Html, Target::Epub, Target::Pptx, Target::Latex];

    pub fn ext(self) -> &'static str {
        match self {
            Target::Md => "md",
            Target::Docx => "docx",
            Target::Pdf => "pdf",
            Target::Odt => "odt",
            Target::Rtf => "rtf",
            Target::Html => "html",
            Target::Epub => "epub",
            Target::Pptx => "pptx",
            Target::Latex => "tex",
        }
    }

    pub fn label(self) -> &'static str {
        match self {
            Target::Md => "Markdown",
            Target::Docx => "Word (.docx)",
            Target::Pdf => "PDF",
            Target::Odt => "OpenDocument (.odt)",
            Target::Rtf => "Rich Text (.rtf)",
            Target::Html => "Web page (.html)",
            Target::Epub => "E-book (.epub)",
            Target::Pptx => "PowerPoint (.pptx)",
            Target::Latex => "LaTeX (.tex)",
        }
    }

    /// Pandoc writer. PDF is made from a DOCX by an Office app (no LaTeX needed).
    pub(crate) fn writer(self) -> &'static str {
        match self {
            Target::Md => "gfm",
            Target::Docx | Target::Pdf => "docx",
            Target::Odt => "odt",
            Target::Rtf => "rtf",
            Target::Html => "html5",
            Target::Epub => "epub3",
            Target::Pptx => "pptx",
            Target::Latex => "latex",
        }
    }

    /// Pandoc reader used to verify the output (PDF is verified via its DOCX).
    pub(crate) fn reader(self) -> &'static str {
        match self {
            Target::Md => "gfm",
            Target::Docx | Target::Pdf => "docx",
            Target::Odt => "odt",
            Target::Rtf => "rtf",
            Target::Html => "html",
            Target::Epub => "epub",
            Target::Pptx => "pptx",
            Target::Latex => "latex",
        }
    }

    pub(crate) fn standalone(self) -> bool {
        matches!(self, Target::Rtf | Target::Html | Target::Latex | Target::Epub)
    }

    /// Formats that take a `--reference-doc` style template of the same type.
    pub(crate) fn takes_template(self) -> bool {
        matches!(self, Target::Docx | Target::Pdf | Target::Odt | Target::Pptx)
    }

    pub fn needs_office(self) -> bool {
        self == Target::Pdf
    }
}

/// Input kind.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Source {
    Markdown,
    /// Read directly by Pandoc with this reader.
    Pandoc(&'static str),
    /// Legacy Office files: converted to DOCX by LibreOffice / Word / WPS first.
    Office,
    /// Read in the app (pdf.js text layer, optional AI OCR), not by Pandoc.
    Pdf,
}

const MARKDOWN_EXT: &[&str] = &["md", "markdown", "mdown", "mkd", "mkdn"];
const PANDOC_EXT: &[(&str, &str)] = &[
    ("docx", "docx"),
    ("odt", "odt"),
    ("fodt", "fodt"),
    ("rtf", "rtf"),
    ("html", "html"),
    ("htm", "html"),
    ("xhtml", "html"),
    ("epub", "epub"),
    ("pptx", "pptx"),
    ("xlsx", "xlsx"),
    ("ipynb", "ipynb"),
    ("tex", "latex"),
    ("latex", "latex"),
    ("rst", "rst"),
    ("org", "org"),
    ("typ", "typst"),
    ("csv", "csv"),
    ("tsv", "tsv"),
];
const OFFICE_EXT: &[&str] = &["doc", "dot", "docm", "dotx", "dotm", "wps"];

impl Source {
    pub fn for_path(path: &Path) -> Option<Source> {
        let ext = path.extension()?.to_string_lossy().to_ascii_lowercase();
        let ext = ext.as_str();
        if MARKDOWN_EXT.contains(&ext) {
            return Some(Source::Markdown);
        }
        if ext == "pdf" {
            return Some(Source::Pdf);
        }
        if OFFICE_EXT.contains(&ext) {
            return Some(Source::Office);
        }
        PANDOC_EXT.iter().find(|(e, _)| *e == ext).map(|(_, r)| Source::Pandoc(r))
    }

    /// Every extension DevOmni accepts (for file pickers and drop filtering).
    pub fn extensions() -> Vec<&'static str> {
        let mut v: Vec<&str> = MARKDOWN_EXT.to_vec();
        v.push("pdf");
        v.extend(PANDOC_EXT.iter().map(|(e, _)| *e));
        v.extend(OFFICE_EXT);
        v
    }
}

/// Short uppercase label for a file's format ("DOCX", "MD"…).
pub fn format_label(path: &Path) -> String {
    match Source::for_path(path) {
        Some(Source::Markdown) => "MD".into(),
        _ => path.extension().map(|e| e.to_string_lossy().to_ascii_uppercase()).unwrap_or_default(),
    }
}

/// Files DevOmni may open / preview: anything it reads or writes.
pub fn is_document(path: &Path) -> bool {
    Source::for_path(path).is_some()
}
