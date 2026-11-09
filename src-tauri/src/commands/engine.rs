//! On-demand install of Pandoc, so the installer stays small: the ~35 MB engine
//! is downloaded once, the first time the converter is used.
//!
//! Source: the official GitHub release (pinned version). The archive is checked
//! against the SHA-256 digest GitHub publishes for the asset when available.

use std::fs;
use std::io::{Cursor, Read};
use std::path::PathBuf;
use std::time::Duration;

use serde::Serialize;
use sha2::{Digest, Sha256};
use tauri::ipc::Channel;
use tauri::{AppHandle, Manager};

use crate::error::{AppError, AppResult};

pub const PANDOC_VERSION: &str = "3.13";
const EXE: &str = if cfg!(windows) { "pandoc.exe" } else { "pandoc" };

/// Where the downloaded engine lives (per user, no admin rights needed).
pub fn installed_path(app: &AppHandle) -> Option<PathBuf> {
    app.path().app_local_data_dir().ok().map(|d| d.join("pandoc").join(EXE))
}

fn asset() -> AppResult<String> {
    let v = PANDOC_VERSION;
    let name = match (std::env::consts::OS, std::env::consts::ARCH) {
        ("windows", "x86_64") => format!("pandoc-{v}-windows-x86_64.zip"),
        ("macos", "aarch64") => format!("pandoc-{v}-arm64-macOS.zip"),
        ("macos", "x86_64") => format!("pandoc-{v}-x86_64-macOS.zip"),
        (os, arch) => {
            return Err(AppError::Internal(format!(
                "Automatic download isn't available for {os}/{arch}. Install Pandoc with your package manager."
            )))
        }
    };
    Ok(name)
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Progress {
    downloaded: u64,
    total: Option<u64>,
    stage: &'static str,
}

fn err(msg: impl Into<String>) -> AppError {
    AppError::Internal(msg.into())
}

/// SHA-256 GitHub publishes for the release asset (`"digest": "sha256:…"`).
/// Best effort: `None` if the API is unreachable or rate-limited.
async fn published_digest(client: &reqwest::Client, asset: &str) -> Option<String> {
    let url = format!("https://api.github.com/repos/jgm/pandoc/releases/tags/{PANDOC_VERSION}");
    let res = client.get(url).header("Accept", "application/vnd.github+json").send().await.ok()?;
    let body: serde_json::Value = res.error_for_status().ok()?.json().await.ok()?;
    body["assets"]
        .as_array()?
        .iter()
        .find(|a| a["name"] == asset)?["digest"]
        .as_str()?
        .strip_prefix("sha256:")
        .map(str::to_ascii_lowercase)
}

#[tauri::command]
pub async fn install_pandoc(app: AppHandle, on_progress: Channel<Progress>) -> AppResult<String> {
    let asset = asset()?;
    let target = installed_path(&app).ok_or_else(|| err("no app data folder"))?;
    let client = reqwest::Client::builder()
        .user_agent("DevOmni")
        .connect_timeout(Duration::from_secs(20))
        .timeout(Duration::from_secs(900))
        .build()
        .map_err(|e| err(e.to_string()))?;

    let expected = published_digest(&client, &asset).await;
    let url = format!("https://github.com/jgm/pandoc/releases/download/{PANDOC_VERSION}/{asset}");
    let mut res = client
        .get(&url)
        .send()
        .await
        .and_then(|r| r.error_for_status())
        .map_err(|e| err(format!("Download failed: {e}")))?;
    let total = res.content_length();
    let mut data: Vec<u8> = Vec::with_capacity(total.unwrap_or(40_000_000) as usize);
    let mut last = 0u64;
    while let Some(chunk) = res.chunk().await.map_err(|e| err(format!("Download interrupted: {e}")))? {
        data.extend_from_slice(&chunk);
        let n = data.len() as u64;
        if n - last > 256 * 1024 || Some(n) == total {
            last = n;
            let _ = on_progress.send(Progress { downloaded: n, total, stage: "download" });
        }
    }

    let _ = on_progress.send(Progress { downloaded: data.len() as u64, total, stage: "verify" });
    if let Some(want) = expected {
        let got = format!("{:x}", Sha256::digest(&data));
        if got != want {
            return Err(err("The download is corrupted (checksum mismatch). Please try again."));
        }
    }

    // Extract only the pandoc executable from the archive.
    let _ = on_progress.send(Progress { downloaded: data.len() as u64, total, stage: "install" });
    let mut zip = zip::ZipArchive::new(Cursor::new(data)).map_err(|e| err(format!("Bad archive: {e}")))?;
    let index = (0..zip.len())
        .find(|&i| zip.by_index(i).map(|f| f.name().rsplit('/').next() == Some(EXE)).unwrap_or(false))
        .ok_or_else(|| err("pandoc executable not found in the archive"))?;
    let mut bin = Vec::new();
    zip.by_index(index).map_err(|e| err(e.to_string()))?.read_to_end(&mut bin)?;

    let dir = target.parent().expect("has parent");
    fs::create_dir_all(dir)?;
    let tmp = dir.join(format!("{EXE}.part"));
    fs::write(&tmp, &bin)?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(&tmp, fs::Permissions::from_mode(0o755))?;
    }
    fs::rename(&tmp, &target)?;
    Ok(target.to_string_lossy().into_owned())
}
