use devomni_core::compare::detect_language;
use devomni_core::normalize::external::{self, FormatterId};
use devomni_core::{CompareRequest, CompareResponse, Language, SideInput};

use crate::error::{blocking, AppError, AppResult};

#[tauri::command]
pub async fn compare_texts(request: CompareRequest) -> AppResult<CompareResponse> {
    Ok(blocking(move || devomni_core::compare(request)).await??)
}

/// Same detection the diff uses — lets the UI pick a highlighter/formatter
/// before the first compare finishes.
#[tauri::command]
pub async fn detect_language_cmd(left: SideInput, right: SideInput) -> AppResult<Language> {
    blocking(move || detect_language(&left, &right)).await
}

/// Native-CLI formatters (rustfmt). Everything else formats in the frontend.
#[tauri::command]
pub async fn format_external(formatter: FormatterId, text: String, ext: String) -> AppResult<String> {
    blocking(move || external::format(formatter, &text, &ext, external::DEFAULT_TIMEOUT))
        .await?
        .map_err(AppError::Internal)
}
