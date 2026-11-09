use std::collections::HashSet;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use devomni_core::convert::{self, office, ConvertReport, ConvertRequest, PandocInfo, Source, Target};
use serde::Serialize;
use tauri::ipc::Response;
use tauri::{AppHandle, Manager, State};
use tauri_plugin_opener::OpenerExt;

use crate::error::{blocking, AppError, AppResult};

const EXE: &str = if cfg!(windows) { "pandoc.exe" } else { "pandoc" };
const MAX_PDF_BYTES: u64 = 300 * 1024 * 1024;

/// Files DevOmni created this session — the only ones it may overwrite
/// (PDF → Markdown results updated after AI OCR).
#[derive(Default)]
pub struct Outputs(pub Mutex<HashSet<PathBuf>>);

impl Outputs {
    fn add(&self, p: &Path) {
        self.0.lock().unwrap_or_else(|e| e.into_inner()).insert(p.to_path_buf());
    }
    fn contains(&self, p: &Path) -> bool {
        self.0.lock().unwrap_or_else(|e| e.into_inner()).contains(p)
    }
}

/// DevOmni's own Pandoc (downloaded or bundled) wins over a system install.
fn bundled(app: &AppHandle) -> Vec<PathBuf> {
    let mut v = Vec::new();
    // Downloaded on first use (keeps the installer small)…
    if let Some(p) = super::engine::installed_path(app) {
        v.push(p);
    }
    // …or shipped next to the app by a custom build.
    if let Ok(dir) = app.path().resource_dir() {
        v.push(dir.join("pandoc").join(EXE));
    }
    #[cfg(debug_assertions)]
    v.push(PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("resources").join("pandoc").join(EXE));
    v
}

fn need_pandoc(paths: &[PathBuf]) -> AppResult<PandocInfo> {
    convert::locate_pandoc(paths).ok_or_else(|| AppError::Internal("Pandoc is not available".into()))
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TargetInfo {
    id: Target,
    label: &'static str,
    ext: &'static str,
    available: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Caps {
    pandoc: Option<PandocInfo>,
    /// Office app used for .doc input and PDF output, if any.
    office: Option<String>,
    inputs: Vec<&'static str>,
    targets: Vec<TargetInfo>,
}

#[tauri::command]
pub async fn converter_caps(app: AppHandle) -> AppResult<Caps> {
    let paths = bundled(&app);
    blocking(move || {
        let office = office::detect().map(|o| o.label().to_owned());
        Caps {
            pandoc: convert::locate_pandoc(&paths),
            targets: Target::FROM_MARKDOWN
                .iter()
                .map(|&t| TargetInfo { id: t, label: t.label(), ext: t.ext(), available: !t.needs_office() || office.is_some() })
                .collect(),
            office,
            inputs: Source::extensions(),
        }
    })
    .await
}

#[tauri::command]
pub async fn convert_document(app: AppHandle, request: ConvertRequest) -> AppResult<ConvertReport> {
    let paths = bundled(&app);
    let report = blocking(move || {
        let info = need_pandoc(&paths)?;
        Ok::<_, AppError>(convert::convert(Path::new(&info.path), &request)?)
    })
    .await??;
    app.state::<Outputs>().add(Path::new(&report.output));
    Ok(report)
}

/// Raw PDF bytes for pdf.js (binary IPC response, no JSON/base64 overhead).
#[tauri::command]
pub async fn read_pdf(path: String) -> AppResult<Response> {
    let p = PathBuf::from(&path);
    if Source::for_path(&p) != Some(Source::Pdf) {
        return Err(AppError::Internal("not a PDF file".into()));
    }
    let bytes = blocking(move || {
        let size = fs::metadata(&p)?.len();
        if size > MAX_PDF_BYTES {
            return Err(AppError::Internal(format!("PDF is too large ({} MB, limit 300 MB)", size / 1_048_576)));
        }
        Ok(fs::read(&p)?)
    })
    .await??;
    Ok(Response::new(bytes))
}

/// Write Markdown produced in the app (PDF → MD) next to the source; never overwrites.
#[tauri::command]
pub fn save_markdown(state: State<Outputs>, input: String, output_dir: Option<String>, content: String) -> AppResult<String> {
    let out = convert::new_output_path(Path::new(&input), output_dir.as_deref(), "md")?;
    fs::write(&out, content)?;
    state.add(&out);
    Ok(out.to_string_lossy().into_owned())
}

/// Rewrite a Markdown file — only one this session created (e.g. after AI OCR).
#[tauri::command]
pub fn update_markdown(state: State<Outputs>, path: String, content: String) -> AppResult<()> {
    let p = PathBuf::from(&path);
    if !state.contains(&p) || Source::for_path(&p) != Some(Source::Markdown) {
        return Err(AppError::Internal("DevOmni can only update Markdown files it created".into()));
    }
    fs::write(&p, content)?;
    Ok(())
}

#[tauri::command]
pub fn read_markdown(path: String) -> AppResult<String> {
    let p = PathBuf::from(&path);
    if Source::for_path(&p) != Some(Source::Markdown) {
        return Err(AppError::Internal("not a Markdown file".into()));
    }
    Ok(fs::read_to_string(&p)?)
}

#[tauri::command]
pub async fn preview_document(app: AppHandle, path: String) -> AppResult<String> {
    let paths = bundled(&app);
    blocking(move || {
        let info = need_pandoc(&paths)?;
        Ok(convert::preview_html(Path::new(&info.path), Path::new(&path))?)
    })
    .await?
}

/// Open a document (or reveal it in the file manager). Restricted to existing
/// document files so the webview can't launch arbitrary programs.
#[tauri::command]
pub fn open_document(app: AppHandle, path: String, reveal: bool) -> AppResult<()> {
    let p = PathBuf::from(&path);
    if !convert::is_document(&p) || !p.is_file() {
        return Err(AppError::Internal(format!("not a document: {path}")));
    }
    let opener = app.opener();
    let res = if reveal { opener.reveal_item_in_dir(&p) } else { opener.open_path(path, None::<&str>) };
    res.map_err(|e| AppError::Internal(e.to_string()))
}
