use std::path::PathBuf;

use devomni_core::io::{load_text_file, LoadedFile};

use crate::error::{blocking, AppResult};

/// Paths come from the native open dialog or OS drag-and-drop.
#[tauri::command]
pub async fn read_text_file(path: String) -> AppResult<LoadedFile> {
    Ok(blocking(move || load_text_file(&PathBuf::from(path))).await??)
}
