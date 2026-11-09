//! Markdown ⇄ DOCX conversion through Pandoc.
//!
//! Pandoc is the reference converter for this job: both formats are parsed into
//! one document AST, so headings, lists, tables (incl. merged cells), footnotes,
//! code blocks, links, math (TeX ⇄ Word OMML) and images survive the trip.
//! DevOmni adds what Pandoc leaves to the caller:
//!
//! * **Raw HTML in Markdown** (`<img>`, `<br>`, `<b>`, `<table>`…) is turned into
//!   real elements by `html2native.lua`, otherwise DOCX drops it silently.
//! * **Images**: Markdown → DOCX embeds local (relative to the .md), data-URI and
//!   remote images; DOCX → Markdown extracts them next to the output and links
//!   them with relative paths.
//! * **Verification**: input and output are both parsed back to the AST and their
//!   words and images are compared, so every report says exactly what (if
//!   anything) was lost. Nothing is guessed.
//! * Outputs never overwrite existing files (`name (1).md`, …).
//!
//! The frontend sends only paths and enum options; the program and arguments are
//! built here.

use std::collections::HashMap;
use std::fs;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Mutex;
use std::thread;
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};
use serde_json::Value;
use unicode_normalization::UnicodeNormalization;

use crate::error::CoreError;
use crate::io::decode;

pub mod formats;
pub mod office;

pub use formats::{format_label, is_document, Source, Target};

const HTML_FILTER: &str = include_str!("html2native.lua");
const DOCX_FILTER: &str = include_str!("docx2md.lua");
/// Invisible marker put into empty auto-numbered Word paragraphs (see `mark_numbered`).
const MARK: char = '\u{2063}';
const TIMEOUT: Duration = Duration::from_secs(180);
const MAX_INPUT_BYTES: u64 = 256 * 1024 * 1024;

/// Markdown dialect read from `.md`: CommonMark (GFM-compatible parsing) plus
/// Pandoc's extensions (pipe tables, footnotes, math, task lists, attributes…).
/// `smart` is off so `--flags` and "quotes" stay byte-identical; implicit
/// figures are off so images don't gain an auto-generated caption.
const MD_READER: &str = "commonmark_x-smart-implicit_figures";

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConvertRequest {
    pub input: String,
    /// Defaults to the input's folder.
    pub output_dir: Option<String>,
    /// Optional style template (same type as the output: .docx, .odt or .pptx).
    pub reference_doc: Option<String>,
    /// Output for Markdown input (default DOCX). Other inputs always become Markdown.
    #[serde(default)]
    pub target: Option<Target>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConvertReport {
    pub input: String,
    pub output: String,
    /// Source format label ("DOCX", "MD", "DOC"…).
    pub from: String,
    pub to: Target,
    /// Folder holding extracted images (… → Markdown only).
    pub media_dir: Option<String>,
    /// Words in the source document.
    pub words: usize,
    /// Fraction of source words present in the output (1.0 = nothing lost).
    pub text_kept: f64,
    /// A few source words missing from the output, for the report.
    pub missing_words: Vec<String>,
    pub images_in: usize,
    pub images_out: usize,
    /// False when the output format can't be read back reliably (RTF, LaTeX),
    /// so `text_kept` / `images_out` are not measured.
    pub verified: bool,
    pub warnings: Vec<String>,
    pub millis: u64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PandocInfo {
    pub path: String,
    pub version: String,
    pub bundled: bool,
}

// ── Locating Pandoc ─────────────────────────────────────────────────────────

/// `bundled` = paths shipped with the app (checked first), then PATH, then the
/// default install locations (GUI apps on macOS don't inherit the shell PATH).
pub fn locate_pandoc(bundled: &[PathBuf]) -> Option<PandocInfo> {
    let exe = if cfg!(windows) { "pandoc.exe" } else { "pandoc" };
    let mut candidates: Vec<(PathBuf, bool)> = bundled.iter().map(|p| (p.clone(), true)).collect();
    if let Ok(p) = which::which("pandoc") {
        candidates.push((p, false));
    }
    if cfg!(windows) {
        for var in ["LOCALAPPDATA", "ProgramFiles"] {
            if let Some(base) = std::env::var_os(var) {
                candidates.push((PathBuf::from(base).join("Pandoc").join(exe), false));
            }
        }
    } else {
        for dir in ["/opt/homebrew/bin", "/usr/local/bin", "/usr/bin"] {
            candidates.push((PathBuf::from(dir).join(exe), false));
        }
    }

    candidates.into_iter().filter(|(p, _)| p.is_file()).find_map(|(path, bundled)| {
        let out = run(&path, &["--version".into()], None, None, Duration::from_secs(15)).ok()?;
        let first = String::from_utf8_lossy(&out.stdout).lines().next()?.trim().to_owned();
        let version = first.strip_prefix("pandoc").unwrap_or(&first).trim().to_owned();
        Some(PandocInfo { path: path.to_string_lossy().into_owned(), version, bundled })
    })
}

// ── Conversion ──────────────────────────────────────────────────────────────

struct Job<'a> {
    pandoc: &'a Path,
    input: &'a Path,
    in_dir: PathBuf,
    out_dir: PathBuf,
    stem: String,
    html_filter: String,
    warnings: Vec<String>,
    /// Text a filter dropped on purpose (TOC page numbers), excused from the check.
    removed: Vec<String>,
}

struct Produced {
    verified: bool,
    output: PathBuf,
    media_dir: Option<String>,
    src: Stats,
    out: Stats,
}

pub fn convert(pandoc: &Path, req: &ConvertRequest) -> Result<ConvertReport, CoreError> {
    let started = Instant::now();
    let input = PathBuf::from(&req.input);
    let source = Source::for_path(&input).ok_or_else(|| fail("this file type can't be converted"))?;
    let meta = fs::metadata(&input)?;
    if meta.len() > MAX_INPUT_BYTES {
        return Err(CoreError::TooLarge { size: meta.len(), limit: MAX_INPUT_BYTES });
    }
    let in_dir = input.parent().map(Path::to_path_buf).unwrap_or_else(|| PathBuf::from("."));
    let out_dir = req.output_dir.as_ref().map(PathBuf::from).unwrap_or_else(|| in_dir.clone());
    fs::create_dir_all(&out_dir)?;
    let mut job = Job {
        pandoc,
        input: &input,
        in_dir,
        out_dir,
        stem: input.file_stem().map(|s| s.to_string_lossy().into_owned()).unwrap_or_else(|| "document".into()),
        html_filter: format!("--lua-filter={}", filter_path("html2native", HTML_FILTER)?.display()),
        warnings: Vec::new(),
        removed: Vec::new(),
    };

    let (to, produced) = match source {
        Source::Pdf => return Err(fail("PDF files are read in the app (text layer, optional AI OCR)")),
        Source::Markdown => {
            let to = req.target.filter(|t| *t != Target::Md).unwrap_or(Target::Docx);
            (to, markdown_to(&mut job, to, req.reference_doc.as_deref())?)
        }
        Source::Pandoc(reader) => (Target::Md, to_markdown(&mut job, &input, reader)?),
        Source::Office => {
            // Legacy Word: let an Office app write a .docx, then the DOCX path.
            let tmp = TempDir::new()?;
            let docx = office::convert(&input, &tmp.path, office::OfficeFormat::Docx)?;
            (Target::Md, to_markdown(&mut job, &docx, "docx")?)
        }
    };

    let Produced { verified, output, media_dir, mut src, out } = produced;
    for w in &job.removed {
        if let Some(n) = src.words.get_mut(w).filter(|n| **n > 0) {
            *n -= 1;
            src.total -= 1;
        }
    }
    let (text_kept, missing_words) = compare_words(&src.words, &out.words);
    if out.images < src.images {
        job.warnings.push(format!(
            "{} of {} images could not be carried over (missing file or unreachable URL).",
            src.images - out.images,
            src.images
        ));
    }

    Ok(ConvertReport {
        input: req.input.clone(),
        output: output.to_string_lossy().into_owned(),
        from: format_label(&input),
        to,
        media_dir,
        words: src.total,
        text_kept,
        missing_words,
        images_in: src.images,
        images_out: out.images,
        verified,
        warnings: job.warnings,
        millis: started.elapsed().as_millis() as u64,
    })
}

/// Markdown → DOCX / PDF / ODT / RTF / HTML / EPUB / PPTX / LaTeX.
fn markdown_to(job: &mut Job, to: Target, template: Option<&str>) -> Result<Produced, CoreError> {
    // Read through our UTF-8/UTF-16 decoder and pipe via stdin: Pandoc itself
    // only accepts UTF-8, so this also handles BOM'd / UTF-16 files.
    let (text, lossy) = decode(&fs::read(job.input)?)?;
    if lossy {
        job.warnings.push("Source had invalid UTF-8 bytes; they were replaced with \u{FFFD}.".into());
    }
    let (output, _) = unique_output(&job.out_dir, &job.stem, to.ext(), false);
    // PDF: write a DOCX to a temp folder, then let an Office app print it.
    let tmp = if to == Target::Pdf { Some(TempDir::new()?) } else { None };
    let pandoc_out = match &tmp {
        Some(t) => t.path.join(format!("{}.docx", job.stem)),
        None => output.clone(),
    };

    let mut args = vec![
        "-f".into(),
        MD_READER.into(),
        "-t".into(),
        to.writer().into(),
        format!("--resource-path={}", job.in_dir.display()),
        job.html_filter.clone(),
        "-o".into(),
        pandoc_out.to_string_lossy().into_owned(),
    ];
    if to.standalone() {
        args.push("--standalone".into());
    }
    match to {
        Target::Html => {
            args.push("--embed-resources".into());
            args.push(format!("--metadata=pagetitle:{}", job.stem));
        }
        Target::Epub => args.push(format!("--metadata=title:{}", job.stem)),
        _ => {}
    }
    if let Some(reference) = template {
        let r = Path::new(reference);
        if !r.is_file() {
            return Err(fail(format!("style template not found: {reference}")));
        }
        let fits = to.takes_template()
            && r.extension().map(|e| e.to_string_lossy().to_ascii_lowercase())
                == Some(if to == Target::Pdf { "docx".into() } else { to.ext().to_owned() });
        if fits {
            args.push(format!("--reference-doc={reference}"));
        } else if to.takes_template() {
            job.warnings.push(format!("Style template ignored: a .{} output needs a .{} template.", to.ext(), to.writer()));
        }
    }
    let res = run(job.pandoc, &args, Some(text.as_bytes()), Some(&job.in_dir), TIMEOUT)?;
    collect_warnings(&res.stderr, &mut job.warnings);

    let src = stats(job.pandoc, &[MD_READER, &job.html_filter], Some(text.as_bytes()), None, &job.in_dir)?;
    // Verify what Pandoc wrote (for PDF: the DOCX that becomes the PDF).
    // Pandoc's RTF and LaTeX readers can't read back everything its writers
    // produce, so for those a "loss" would be a false alarm: report unverified.
    let verified = !matches!(to, Target::Rtf | Target::Latex);
    let out = if verified {
        stats(job.pandoc, &[to.reader()], None, Some(&pandoc_out), &job.out_dir)?
    } else {
        Stats { words: src.words.clone(), total: src.total, images: src.images }
    };
    if let Some(t) = &tmp {
        let pdf = office::convert(&pandoc_out, &t.path, office::OfficeFormat::Pdf)?;
        fs::copy(&pdf, &output)?;
    }
    Ok(Produced { verified, output, media_dir: None, src, out })
}

/// DOCX / ODT / RTF / HTML / EPUB / PPTX / XLSX / … → GitHub-Flavored Markdown.
fn to_markdown(job: &mut Job, source: &Path, reader: &'static str) -> Result<Produced, CoreError> {
    let (output, media) = unique_output(&job.out_dir, &job.stem, "md", true);
    let media = media.expect("media dir requested");
    let media_name = media.file_name().unwrap().to_string_lossy().into_owned();
    // Word stores list numbers outside the text; empty numbered paragraphs
    // (e.g. "STT" columns) would vanish, so read a marked temp copy.
    let prepared = if reader == "docx" { TempDocx::prepare(source)? } else { None };
    let read_from = prepared.as_ref().map(|t| t.path.clone()).unwrap_or_else(|| source.to_path_buf());
    let mut args = vec![
        read_from.to_string_lossy().into_owned(),
        "-f".into(),
        reader.into(),
        // GFM renders in every viewer (GitHub, VS Code, Typora, Obsidian).
        "-t".into(),
        "gfm".into(),
        "--wrap=none".into(),
        format!("--lua-filter={}", filter_path("docx2md", DOCX_FILTER)?.display()),
        // Relative name + cwd = out_dir -> links in the .md are relative.
        format!("--extract-media={media_name}"),
        "-o".into(),
        output.to_string_lossy().into_owned(),
    ];
    if reader == "docx" {
        args.push("--track-changes=accept".into());
    }
    let res = run(job.pandoc, &args, None, Some(&job.out_dir), TIMEOUT)?;
    collect_warnings(&res.stderr, &mut job.warnings);
    job.removed = removed_words(&res.stderr);
    fix_media_links(&output, &media_name)?;
    image_format_warnings(&media, &mut job.warnings);

    let src = stats(job.pandoc, &[reader], None, Some(source), &job.in_dir)?;
    let out = stats(job.pandoc, &["gfm", &job.html_filter], None, Some(&output), &job.out_dir)?;
    let media_dir = media.is_dir().then(|| media.to_string_lossy().into_owned());
    Ok(Produced { verified: true, output, media_dir, src, out })
}

/// A fresh folder under the temp dir, removed (with its contents) on drop.
struct TempDir {
    path: PathBuf,
}

impl TempDir {
    fn new() -> Result<TempDir, CoreError> {
        static SEQ: AtomicU64 = AtomicU64::new(0);
        let path = std::env::temp_dir()
            .join("devomni")
            .join(format!("job-{}-{}", std::process::id(), SEQ.fetch_add(1, Ordering::Relaxed)));
        fs::create_dir_all(&path)?;
        Ok(TempDir { path })
    }
}

impl Drop for TempDir {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.path);
    }
}

/// A new, non-existing output path for content DevOmni writes itself (PDF → MD).
pub fn new_output_path(input: &Path, output_dir: Option<&str>, ext: &str) -> Result<PathBuf, CoreError> {
    let in_dir = input.parent().map(Path::to_path_buf).unwrap_or_else(|| PathBuf::from("."));
    let dir = output_dir.map(PathBuf::from).unwrap_or(in_dir);
    fs::create_dir_all(&dir)?;
    let stem = input.file_stem().map(|s| s.to_string_lossy().into_owned()).unwrap_or_else(|| "document".into());
    Ok(unique_output(&dir, &stem, ext, false).0)
}

// ── Preview ─────────────────────────────────────────────────────────────────

const PREVIEW_TEMPLATE: &str = "<!doctype html><html><head><meta charset=\"utf-8\"><title>Preview</title></head><body>$body$</body></html>";

/// Render a document to self-contained HTML (images inlined) for the preview pane.
pub fn preview_html(pandoc: &Path, path: &Path) -> Result<String, CoreError> {
    let reader: String = match Source::for_path(path) {
        Some(Source::Markdown) => MD_READER.into(),
        Some(Source::Pandoc(r)) => r.into(),
        _ => return Err(fail("no preview for this file type")),
    };
    let dir = path.parent().map(Path::to_path_buf).unwrap_or_else(|| PathBuf::from("."));
    let template = filter_path_ext("preview", PREVIEW_TEMPLATE, "html")?;
    let mut args = vec![
        path.to_string_lossy().into_owned(),
        "-f".into(),
        reader.clone(),
        "-t".into(),
        "html5".into(),
        "--standalone".into(),
        "--embed-resources".into(),
        "--mathml".into(),
        format!("--template={}", template.display()),
        format!("--resource-path={}", dir.display()),
    ];
    if reader == MD_READER {
        args.push(format!("--lua-filter={}", filter_path("html2native", HTML_FILTER)?.display()));
    }
    let out = run(pandoc, &args, None, Some(&dir), TIMEOUT)?;
    String::from_utf8(out.stdout).map_err(|_| fail("preview was not valid UTF-8"))
}

pub(crate) fn fail(msg: impl Into<String>) -> CoreError {
    CoreError::Convert(msg.into())
}

/// `name.ext`, else `name (1).ext`, … — never overwrites. With `media`, the
/// sibling `<name>_media` folder must be free too.
fn unique_output(dir: &Path, stem: &str, ext: &str, media: bool) -> (PathBuf, Option<PathBuf>) {
    for n in 0.. {
        let name = if n == 0 { stem.to_owned() } else { format!("{stem} ({n})") };
        let out = dir.join(format!("{name}.{ext}"));
        // Media folder name goes into Markdown links: keep it free of spaces/parens.
        let slug: String = name
            .chars()
            .map(|c| if c.is_alphanumeric() || c == '-' || c == '_' { c } else { '-' })
            .collect();
        let m = dir.join(format!("{slug}_media"));
        if !out.exists() && (!media || !m.exists()) {
            return (out, media.then_some(m));
        }
    }
    unreachable!()
}

/// Pandoc may join the media path with `\` on Windows; Markdown links need `/`.
fn fix_media_links(md: &Path, media_name: &str) -> Result<(), CoreError> {
    let text = fs::read_to_string(md)?;
    let fixed = text
        .replace(&format!("{media_name}\\media\\"), &format!("{media_name}/media/"))
        .replace(&format!("{media_name}\\media/"), &format!("{media_name}/media/"))
        .replace(&format!("{media_name}\\"), &format!("{media_name}/"));
    if fixed != text {
        fs::write(md, fixed)?;
    }
    Ok(())
}

fn image_format_warnings(media: &Path, warnings: &mut Vec<String>) {
    let mut legacy = 0;
    let mut stack = vec![media.to_path_buf()];
    while let Some(dir) = stack.pop() {
        let Ok(entries) = fs::read_dir(&dir) else { continue };
        for e in entries.flatten() {
            let p = e.path();
            if p.is_dir() {
                stack.push(p);
            } else if let Some(ext) = p.extension() {
                let ext = ext.to_string_lossy().to_ascii_lowercase();
                if ext == "emf" || ext == "wmf" {
                    legacy += 1;
                }
            }
        }
    }
    if legacy > 0 {
        warnings.push(format!(
            "{legacy} image(s) are EMF/WMF (Office vector format). They were extracted, but many Markdown viewers can't display them."
        ));
    }
}

fn collect_warnings(stderr: &str, out: &mut Vec<String>) {
    for line in stderr.lines() {
        let line = line.trim();
        if let Some(rest) = line.strip_prefix("[WARNING]") {
            let msg = rest.trim().to_owned();
            if !msg.is_empty() && !out.contains(&msg) && out.len() < 12 {
                out.push(msg);
            }
        }
    }
}

/// Lua filters are embedded in the binary and written to temp files on demand.
/// The file name carries a content hash, so a new build never runs a stale filter.
fn filter_path(name: &str, src: &str) -> Result<PathBuf, CoreError> {
    filter_path_ext(name, src, "lua")
}

fn filter_path_ext(name: &str, src: &str, ext: &str) -> Result<PathBuf, CoreError> {
    static LOCK: Mutex<()> = Mutex::new(());
    let _guard = LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let dir = std::env::temp_dir().join("devomni");
    fs::create_dir_all(&dir)?;
    let path = dir.join(format!("{name}-{:x}.{ext}", fnv(src.as_bytes())));
    if fs::read_to_string(&path).ok().as_deref() != Some(src) {
        let tmp = dir.join(format!("{name}-{}.tmp", std::process::id()));
        fs::write(&tmp, src)?;
        fs::rename(&tmp, &path)?;
    }
    Ok(path)
}

// ── DOCX pre-processing ─────────────────────────────────────────────────────

/// A patched copy of a .docx in the temp folder, deleted on drop.
struct TempDocx {
    path: PathBuf,
}

impl Drop for TempDocx {
    fn drop(&mut self) {
        let _ = fs::remove_file(&self.path);
    }
}

impl TempDocx {
    /// Returns `None` when the document needs no changes.
    fn prepare(input: &Path) -> Result<Option<TempDocx>, CoreError> {
        let bad = |e: zip::result::ZipError| fail(format!("not a valid .docx file: {e}"));
        let mut archive = zip::ZipArchive::new(fs::File::open(input)?).map_err(bad)?;
        let mut xml = String::new();
        archive.by_name("word/document.xml").map_err(bad)?.read_to_string(&mut xml)?;
        let (patched, n) = mark_numbered(&xml);
        if n == 0 {
            return Ok(None);
        }

        static SEQ: AtomicU64 = AtomicU64::new(0);
        let dir = std::env::temp_dir().join("devomni");
        fs::create_dir_all(&dir)?;
        let path = dir.join(format!("src-{}-{}.docx", std::process::id(), SEQ.fetch_add(1, Ordering::Relaxed)));
        let temp = TempDocx { path };
        let mut out = zip::ZipWriter::new(fs::File::create(&temp.path)?);
        for i in 0..archive.len() {
            let entry = archive.by_index_raw(i).map_err(bad)?;
            if entry.name() == "word/document.xml" {
                let name = entry.name().to_owned();
                drop(entry);
                let opts = zip::write::SimpleFileOptions::default().compression_method(zip::CompressionMethod::Deflated);
                out.start_file(name, opts).map_err(bad)?;
                out.write_all(patched.as_bytes())?;
            } else {
                out.raw_copy_file(entry).map_err(bad)?;
            }
        }
        out.finish().map_err(bad)?;
        Ok(Some(temp))
    }
}

/// Put an invisible marker into auto-numbered paragraphs that have no text, so
/// Pandoc keeps them as list items (their number is what Word shows, e.g. the
/// row numbers of an "STT" column). Returns the new XML and the patch count.
fn mark_numbered(xml: &str) -> (String, usize) {
    let mut out = String::with_capacity(xml.len() + 1024);
    let mut count = 0;
    let mut rest = xml;
    while let Some(start) = find_para_start(rest) {
        let Some(len) = rest[start..].find("</w:p>") else { break };
        let end = start + len; // index of "</w:p>"
        let para = &rest[start..end];
        out.push_str(&rest[..end]);
        let nested = find_para_start(&para[4..]).is_some();
        if !nested && para.contains("<w:numPr>") && !has_content(para) {
            out.push_str("<w:r><w:t>");
            out.push(MARK);
            out.push_str("</w:t></w:r>");
            count += 1;
        }
        out.push_str("</w:p>");
        rest = &rest[end + 6..];
    }
    out.push_str(rest);
    (out, count)
}

fn find_para_start(s: &str) -> Option<usize> {
    match (s.find("<w:p>"), s.find("<w:p ")) {
        (Some(x), Some(y)) => Some(x.min(y)),
        (x, y) => x.or(y),
    }
}

fn has_content(para: &str) -> bool {
    ["<w:t>", "<w:t ", "<w:drawing", "<w:pict", "<w:object", "<m:oMath", "<w:sym"]
        .iter()
        .any(|tag| para.contains(tag))
}

fn fnv(bytes: &[u8]) -> u64 {
    bytes.iter().fold(0xcbf2_9ce4_8422_2325u64, |h, b| (h ^ *b as u64).wrapping_mul(0x100_0000_01b3))
}

// ── Verification ────────────────────────────────────────────────────────────

#[derive(Debug, Default)]
struct Stats {
    words: HashMap<String, u32>,
    total: usize,
    images: usize,
}

/// Parse a document to Pandoc's JSON AST and count its words and images.
/// `reader[0]` is the input format; any further items are extra arguments.
fn stats(pandoc: &Path, reader: &[&str], stdin: Option<&[u8]>, file: Option<&Path>, cwd: &Path) -> Result<Stats, CoreError> {
    let mut args: Vec<String> = vec!["-f".into(), reader[0].into(), "-t".into(), "json".into()];
    args.extend(reader[1..].iter().map(|s| s.to_string()));
    if let Some(f) = file {
        args.push(f.to_string_lossy().into_owned());
    }
    let out = run(pandoc, &args, stdin, Some(cwd), TIMEOUT)?;
    let ast: Value = serde_json::from_slice(&out.stdout).map_err(|e| fail(format!("could not read document structure: {e}")))?;
    let mut s = Stats::default();
    walk(&ast, &mut s);
    Ok(s)
}

fn walk(v: &Value, s: &mut Stats) {
    match v {
        Value::Array(items) => items.iter().for_each(|i| walk(i, s)),
        Value::Object(map) => {
            let c = map.get("c");
            match map.get("t").and_then(Value::as_str) {
                Some("Str") => add_words(c.and_then(Value::as_str).unwrap_or(""), s),
                Some("Code" | "CodeBlock" | "Math") => {
                    add_words(c.and_then(|c| c.get(1)).and_then(Value::as_str).unwrap_or(""), s)
                }
                Some("RawInline" | "RawBlock") => {
                    let fmt = c.and_then(|c| c.get(0)).and_then(Value::as_str).unwrap_or("");
                    let text = c.and_then(|c| c.get(1)).and_then(Value::as_str).unwrap_or("");
                    if fmt.contains("html") {
                        s.images += text.matches("<img").count();
                        add_words(&strip_tags(text), s);
                    }
                }
                // Alt text is metadata, not body text — don't let it skew the score.
                Some("Image") => s.images += 1,
                _ => map.values().for_each(|i| walk(i, s)),
            }
        }
        _ => {}
    }
}

/// Words a Lua filter reported as intentionally removed (`[devomni:removed] a b c`).
fn removed_words(stderr: &str) -> Vec<String> {
    let mut s = Stats::default();
    for line in stderr.lines() {
        if let Some(rest) = line.trim().strip_prefix("[devomni:removed]") {
            add_words(rest, &mut s);
        }
    }
    s.words.into_iter().flat_map(|(w, n)| std::iter::repeat(w).take(n as usize)).collect()
}

/// NFC first: Word files often store Vietnamese (and other accented text) in
/// decomposed form, while Pandoc may write it composed. Same text, same words.
fn add_words(text: &str, s: &mut Stats) {
    let text: String = text.nfc().collect();
    for w in text.split(|c: char| !c.is_alphanumeric()).filter(|w| !w.is_empty()) {
        *s.words.entry(w.to_lowercase()).or_default() += 1;
        s.total += 1;
    }
}

fn strip_tags(html: &str) -> String {
    let mut out = String::with_capacity(html.len());
    let mut in_tag = false;
    for ch in html.chars() {
        match ch {
            '<' => in_tag = true,
            '>' if in_tag => {
                in_tag = false;
                out.push(' ');
            }
            _ if !in_tag => out.push(ch),
            _ => {}
        }
    }
    out
}

/// Multiset coverage: how many source words (with multiplicity) appear in the output.
fn compare_words(src: &HashMap<String, u32>, out: &HashMap<String, u32>) -> (f64, Vec<String>) {
    let total: u64 = src.values().map(|&n| n as u64).sum();
    if total == 0 {
        return (1.0, Vec::new());
    }
    let mut kept = 0u64;
    let mut missing: Vec<(&String, u32)> = Vec::new();
    for (w, &n) in src {
        let m = out.get(w).copied().unwrap_or(0);
        kept += n.min(m) as u64;
        if m < n {
            missing.push((w, n - m));
        }
    }
    missing.sort_by(|a, b| b.1.cmp(&a.1).then_with(|| a.0.cmp(b.0)));
    (kept as f64 / total as f64, missing.into_iter().take(8).map(|(w, _)| w.clone()).collect())
}

// ── Process runner ──────────────────────────────────────────────────────────

pub(crate) struct Output {
    stdout: Vec<u8>,
    stderr: String,
}

pub(crate) fn run(program: &Path, args: &[String], stdin: Option<&[u8]>, cwd: Option<&Path>, timeout: Duration) -> Result<Output, CoreError> {
    let mut cmd = Command::new(program);
    cmd.args(args)
        .stdin(if stdin.is_some() { Stdio::piped() } else { Stdio::null() })
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    if let Some(dir) = cwd {
        cmd.current_dir(dir);
    }
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }
    let mut child = cmd.spawn().map_err(|e| fail(format!("failed to start Pandoc: {e}")))?;

    // Feed stdin and drain both pipes on threads so large documents can't deadlock.
    let writer = stdin.map(|data| {
        let mut pipe = child.stdin.take().expect("piped stdin");
        let data = data.to_vec();
        thread::spawn(move || {
            let _ = pipe.write_all(&data);
        })
    });
    let mut so = child.stdout.take().expect("piped stdout");
    let out_reader = thread::spawn(move || {
        let mut buf = Vec::new();
        let _ = so.read_to_end(&mut buf);
        buf
    });
    let mut se = child.stderr.take().expect("piped stderr");
    let err_reader = thread::spawn(move || {
        let mut s = String::new();
        let _ = se.read_to_string(&mut s);
        s
    });

    let deadline = Instant::now() + timeout;
    let status = loop {
        match child.try_wait()? {
            Some(status) => break status,
            None if Instant::now() >= deadline => {
                let _ = child.kill();
                let _ = child.wait();
                return Err(fail(format!("Pandoc timed out after {}s", timeout.as_secs())));
            }
            None => thread::sleep(Duration::from_millis(10)),
        }
    };
    if let Some(w) = writer {
        let _ = w.join();
    }
    let stdout = out_reader.join().unwrap_or_default();
    let stderr = err_reader.join().unwrap_or_default();
    if !status.success() {
        let detail: Vec<&str> = stderr.lines().filter(|l| !l.trim().is_empty()).take(4).collect();
        return Err(fail(if detail.is_empty() { format!("Pandoc failed ({status})") } else { detail.join(" · ") }));
    }
    Ok(Output { stdout, stderr })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sources_and_targets() {
        assert_eq!(Source::for_path(Path::new("a/README.MD")), Some(Source::Markdown));
        assert_eq!(Source::for_path(Path::new("Báo cáo.docx")), Some(Source::Pandoc("docx")));
        assert_eq!(Source::for_path(Path::new("x.HTM")), Some(Source::Pandoc("html")));
        assert_eq!(Source::for_path(Path::new("old.doc")), Some(Source::Office));
        assert_eq!(Source::for_path(Path::new("scan.pdf")), Some(Source::Pdf));
        assert_eq!(Source::for_path(Path::new("x.exe")), None);
        assert_eq!(format_label(Path::new("a.markdown")), "MD");
        assert!(Source::extensions().contains(&"pptx"));
        assert_eq!(Target::Pdf.writer(), "docx");
    }

    #[test]
    fn word_coverage() {
        let mut a = Stats::default();
        add_words("Xin chào, thế giới! chào", &mut a);
        let mut b = Stats::default();
        add_words("xin chào thế", &mut b);
        let (kept, missing) = compare_words(&a.words, &b.words);
        assert_eq!(a.total, 5);
        assert!((kept - 0.6).abs() < 1e-9);
        assert_eq!(missing, vec!["chào".to_string(), "giới".to_string()]);
    }

    #[test]
    fn decomposed_and_composed_text_match() {
        let mut a = Stats::default();
        add_words("MU\u{0323}C LU\u{0323}C thua\u{0302}\u{0323}t", &mut a); // NFD
        let mut b = Stats::default();
        add_words("MỤC LỤC thuật", &mut b); // NFC
        assert_eq!(compare_words(&a.words, &b.words).0, 1.0);
        let mut removed = removed_words("noise\n[devomni:removed] 4 48 4\n");
        removed.sort();
        assert_eq!(removed, vec!["4", "4", "48"]);
    }

    #[test]
    fn counts_images_and_skips_alt_text() {
        let ast: Value = serde_json::from_str(
            r#"{"blocks":[{"t":"Para","c":[{"t":"Str","c":"Hi"},
               {"t":"Image","c":[["",[],[]],[{"t":"Str","c":"alt"}],["a.png",""]]},
               {"t":"RawInline","c":["html","<img src=\"b.png\"> <b>bold</b>"]}]}]}"#,
        )
        .unwrap();
        let mut s = Stats::default();
        walk(&ast, &mut s);
        assert_eq!(s.images, 2);
        assert_eq!(s.total, 2); // "Hi", "bold"
    }

    /// End-to-end MD → DOCX → MD. Runs only when Pandoc is available
    /// (`npm run fetch:pandoc`, or installed on PATH); otherwise it is a no-op.
    #[test]
    fn roundtrip_keeps_text_and_images() {
        let bundled = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("../../src-tauri/resources/pandoc")
            .join(if cfg!(windows) { "pandoc.exe" } else { "pandoc" });
        let Some(info) = locate_pandoc(&[bundled]) else {
            eprintln!("pandoc not found — skipping round-trip test");
            return;
        };
        let pandoc = PathBuf::from(&info.path);
        let dir = std::env::temp_dir().join(format!("devomni-rt-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(dir.join("img")).unwrap();
        let png = "89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d4944415478da636460f85f0f0002870180eb47ba920000000049454e44ae426082";
        let bytes: Vec<u8> = (0..png.len()).step_by(2).map(|i| u8::from_str_radix(&png[i..i + 2], 16).unwrap()).collect();
        fs::write(dir.join("img/dot.png"), &bytes).unwrap();
        fs::write(
            dir.join("Tài liệu.md"),
            "# Tiêu đề chính\n\nĐoạn văn có **đậm**, *nghiêng*, `code` và [liên kết](https://example.com).\n\
             - Mục một\n- Mục hai\n  1. Lồng nhau\n\n\
             | Cột A | Cột B |\n|---|---|\n| giá trị 1 | giá trị 2 |\n\n\
             ![Ảnh](img/dot.png)\n\n<p align=\"center\"><img src=\"img/dot.png\" width=\"40\"></p>\n\n\
             Phím <kbd>Ctrl</kbd> và H<sub>2</sub>O.<br>Dòng mới\n\n\
             Công thức $E = mc^2$ và chú thích[^1].\n\n```rust\nfn main() { println!(\"xin chào\"); }\n```\n\n\
             [^1]: Nội dung chú thích.\n",
        )
        .unwrap();

        let req = |input: PathBuf| ConvertRequest {
            input: input.to_string_lossy().into_owned(),
            output_dir: None,
            reference_doc: None,
            target: None,
        };
        let a = convert(&pandoc, &req(dir.join("Tài liệu.md"))).expect("md → docx");
        assert_eq!(a.images_in, 2, "{a:?}");
        assert_eq!(a.images_out, 2, "{a:?}");
        assert!(a.text_kept > 0.99, "{a:?}");

        let b = convert(&pandoc, &req(PathBuf::from(&a.output))).expect("docx → md");
        assert!(b.output.ends_with("Tài liệu (1).md"), "{b:?}");
        assert_eq!(b.images_out, 2, "{b:?}");
        assert!(b.text_kept > 0.99, "{b:?}");
        let md = fs::read_to_string(&b.output).unwrap();
        assert!(md.contains("_media/media/"), "relative image links: {md}");
        assert!(!md.contains('\\') || !md.contains("_media\\"), "forward slashes: {md}");
        fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn marks_only_empty_numbered_paragraphs() {
        let xml = concat!(
            r#"<w:p w:x="1"><w:pPr><w:numPr><w:ilvl w:val="0"/></w:numPr><w:pBdr><w:top/></w:pBdr></w:pPr><w:r></w:r></w:p>"#,
            r#"<w:p><w:pPr><w:numPr/></w:pPr><w:r><w:t>text</w:t></w:r></w:p>"#,
            r#"<w:p><w:pPr></w:pPr></w:p>"#,
            r#"<w:p><w:pPr><w:numPr><w:ilvl w:val="0"/></w:numPr></w:pPr><w:r><w:drawing/></w:r></w:p>"#,
        );
        let (out, n) = mark_numbered(xml);
        assert_eq!(n, 1, "{out}");
        assert!(out.starts_with(r#"<w:p w:x="1">"#));
        assert!(out.contains("<w:r></w:r><w:r><w:t>\u{2063}</w:t></w:r></w:p><w:p>"));
    }

    #[test]
    fn unique_names_never_overwrite() {
        let dir = std::env::temp_dir().join(format!("devomni-test-{}", std::process::id()));
        fs::create_dir_all(&dir).unwrap();
        fs::write(dir.join("doc.md"), "x").unwrap();
        let (out, media) = unique_output(&dir, "doc", "md", true);
        assert_eq!(out.file_name().unwrap(), "doc (1).md");
        assert_eq!(media.unwrap().file_name().unwrap(), "doc--1-_media");
        fs::remove_dir_all(&dir).unwrap();
    }
}
