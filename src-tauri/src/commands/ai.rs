//! Gemini (Google AI Studio) for OCR of PDF pages.
//!
//! The API key lives in the OS credential store (Windows Credential Manager,
//! macOS Keychain, Secret Service) and is only ever used here in Rust: the
//! webview never sees it. Only pages the user explicitly selects are sent.

use std::sync::OnceLock;
use std::time::Duration;

use serde::Serialize;
use serde_json::{json, Value};
use tauri::AppHandle;
use tauri_plugin_opener::OpenerExt;

use crate::error::{AppError, AppResult};

const API: &str = "https://generativelanguage.googleapis.com/v1beta";
const KEY_PAGE: &str = "https://aistudio.google.com/apikey";
const SERVICE: &str = "DevOmni";
const ACCOUNT: &str = "gemini-api-key";
const MAX_IMAGE_B64: usize = 20 * 1024 * 1024;

const OCR_PROMPT: &str = "You are an OCR engine. Transcribe this document page into GitHub-Flavored Markdown.
Rules:
- Output ONLY the Markdown of this page: no explanations, no code fences around it.
- Keep the original language and wording exactly (Vietnamese stays Vietnamese; do not translate, summarize or fix typos).
- Preserve reading order, headings (#, ##, ###), paragraphs, bullet and numbered lists, bold and italic.
- Reproduce tables as GFM pipe tables; use <br> for line breaks inside a cell. Merged cells: repeat nothing, leave the covered cells empty.
- Write math as LaTeX between $...$.
- For pictures, charts, stamps or signatures write a short placeholder such as *[Image: company logo]*.
- Leave out running headers, footers and page numbers.";

fn err(msg: impl Into<String>) -> AppError {
    AppError::Internal(msg.into())
}

fn entry() -> AppResult<keyring::Entry> {
    keyring::Entry::new(SERVICE, ACCOUNT).map_err(|e| err(format!("credential store unavailable: {e}")))
}

fn stored_key() -> Option<String> {
    entry().ok()?.get_password().ok().filter(|k| !k.trim().is_empty())
}

fn client() -> &'static reqwest::Client {
    static C: OnceLock<reqwest::Client> = OnceLock::new();
    C.get_or_init(|| {
        reqwest::Client::builder()
            .timeout(Duration::from_secs(180))
            .connect_timeout(Duration::from_secs(15))
            .build()
            .expect("http client")
    })
}

/// Human message for a Gemini error response.
fn api_error(status: reqwest::StatusCode, body: &Value) -> AppError {
    let msg = body.pointer("/error/message").and_then(Value::as_str).unwrap_or("");
    let reason = body.to_string();
    if reason.contains("API_KEY_INVALID") || msg.contains("API key not valid") {
        return err("The API key is not valid. Create a new one in Google AI Studio.");
    }
    match status.as_u16() {
        429 => err("Gemini free-tier limit reached. Wait a minute, or choose fewer pages / another model."),
        403 => err(format!("Access denied by Gemini: {msg}")),
        404 => err("This model is not available for your key. Pick another model."),
        _ => err(format!("Gemini error {}: {}", status.as_u16(), if msg.is_empty() { "request failed" } else { msg })),
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AiStatus {
    configured: bool,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct AiModel {
    id: String,
    label: String,
}

#[tauri::command]
pub fn ai_status() -> AiStatus {
    AiStatus { configured: stored_key().is_some() }
}

/// Opens Google AI Studio's key page in the browser (fixed URL).
#[tauri::command]
pub fn open_ai_studio(app: AppHandle) -> AppResult<()> {
    app.opener().open_url(KEY_PAGE, None::<&str>).map_err(|e| err(e.to_string()))
}

async fn list_models(key: &str) -> AppResult<Vec<AiModel>> {
    let res = client()
        .get(format!("{API}/models?pageSize=1000"))
        .header("x-goog-api-key", key)
        .send()
        .await
        .map_err(|e| err(format!("Can't reach Google AI Studio: {e}")))?;
    let status = res.status();
    let body: Value = res.json().await.unwrap_or(Value::Null);
    if !status.is_success() {
        return Err(api_error(status, &body));
    }
    let mut models: Vec<(i64, AiModel)> = body["models"]
        .as_array()
        .into_iter()
        .flatten()
        .filter(|m| {
            m["supportedGenerationMethods"].as_array().is_some_and(|a| a.iter().any(|x| x == "generateContent"))
        })
        .filter_map(|m| {
            let id = m["name"].as_str()?.strip_prefix("models/")?.to_owned();
            let skip = ["embedding", "tts", "image", "live", "audio", "aqa", "learnlm", "gemma", "robotics", "computer"];
            if !id.starts_with("gemini") || skip.iter().any(|s| id.contains(s)) {
                return None;
            }
            let label = m["displayName"].as_str().unwrap_or(&id).to_owned();
            Some((rank(&id), AiModel { id, label }))
        })
        .collect();
    models.sort_by(|a, b| b.0.cmp(&a.0).then_with(|| a.1.id.cmp(&b.1.id)));
    Ok(models.into_iter().map(|(_, m)| m).collect())
}

/// Prefer stable "flash" models (fast, generous free tier), newest version first.
fn rank(id: &str) -> i64 {
    let version: f64 = id
        .trim_start_matches("gemini-")
        .split('-')
        .next()
        .and_then(|v| v.parse().ok())
        .unwrap_or(0.0);
    let mut score = (version * 100.0) as i64;
    if id.contains("flash") {
        score += 10_000;
    }
    if id.contains("lite") {
        score -= 3_000;
    }
    if id.contains("preview") || id.contains("exp") {
        score -= 5_000;
    }
    if id.ends_with("latest") {
        score -= 500;
    }
    score
}

/// Validate a key (by listing models) and store it. Returns the usable models.
#[tauri::command]
pub async fn ai_set_key(key: String) -> AppResult<Vec<AiModel>> {
    let key = key.trim().to_owned();
    if key.len() < 20 {
        return Err(err("That doesn't look like an API key."));
    }
    let models = list_models(&key).await?;
    if models.is_empty() {
        return Err(err("This key works, but no Gemini model is available for it."));
    }
    entry()?.set_password(&key).map_err(|e| err(format!("Couldn't save the key: {e}")))?;
    Ok(models)
}

#[tauri::command]
pub fn ai_clear_key() -> AppResult<()> {
    match entry()?.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(err(e.to_string())),
    }
}

#[tauri::command]
pub async fn ai_models() -> AppResult<Vec<AiModel>> {
    let key = stored_key().ok_or_else(|| err("No API key set"))?;
    list_models(&key).await
}

/// OCR one page image (base64 PNG/JPEG) into Markdown. Retries rate limits.
#[tauri::command]
pub async fn ai_ocr_page(image: String, mime: String, model: String) -> AppResult<String> {
    let key = stored_key().ok_or_else(|| err("No API key set"))?;
    if !matches!(mime.as_str(), "image/png" | "image/jpeg" | "image/webp") {
        return Err(err("unsupported image type"));
    }
    if image.len() > MAX_IMAGE_B64 {
        return Err(err("page image is too large"));
    }
    if !model.chars().all(|c| c.is_ascii_alphanumeric() || "-._".contains(c)) {
        return Err(err("invalid model name"));
    }
    let body = json!({
        "contents": [{ "role": "user", "parts": [
            { "inline_data": { "mime_type": mime, "data": image } },
            { "text": OCR_PROMPT }
        ]}],
        "generationConfig": { "temperature": 0 }
    });

    let mut attempt = 0;
    loop {
        attempt += 1;
        let res = client()
            .post(format!("{API}/models/{model}:generateContent"))
            .header("x-goog-api-key", &key)
            .json(&body)
            .send()
            .await
            .map_err(|e| err(format!("Can't reach Gemini: {e}")))?;
        let status = res.status();
        let data: Value = res.json().await.unwrap_or(Value::Null);
        if status.as_u16() == 429 && attempt < 4 {
            // Honor RetryInfo ("27s") when present; free tier resets per minute.
            let wait = data
                .pointer("/error/details")
                .and_then(Value::as_array)
                .and_then(|d| d.iter().find_map(|x| x["retryDelay"].as_str()))
                .and_then(|s| s.trim_end_matches('s').parse::<f64>().ok())
                .unwrap_or(20.0 * attempt as f64)
                .min(65.0);
            tokio::time::sleep(Duration::from_secs_f64(wait + 1.0)).await;
            continue;
        }
        if !status.is_success() {
            return Err(api_error(status, &data));
        }
        let cand = &data["candidates"][0];
        let text: String = cand["content"]["parts"]
            .as_array()
            .into_iter()
            .flatten()
            .filter_map(|p| p["text"].as_str())
            .collect();
        if text.trim().is_empty() {
            let reason = cand["finishReason"].as_str().unwrap_or("no text returned");
            return Err(err(format!("Gemini returned no text for this page ({reason})")));
        }
        return Ok(strip_fences(&text));
    }
}

/// Models sometimes wrap the answer in ```markdown fences despite the prompt.
fn strip_fences(s: &str) -> String {
    let t = s.trim();
    if let Some(rest) = t.strip_prefix("```") {
        let rest = rest.split_once('\n').map(|(_, r)| r).unwrap_or("");
        return rest.trim_end().strip_suffix("```").unwrap_or(rest).trim().to_owned();
    }
    t.to_owned()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn prefers_stable_flash() {
        let mut ids = vec!["gemini-2.5-pro", "gemini-2.5-flash", "gemini-2.0-flash-lite", "gemini-3.0-flash-preview", "gemini-2.0-flash"];
        ids.sort_by_key(|id| -rank(id));
        assert_eq!(ids[0], "gemini-2.5-flash");
    }

    #[test]
    fn strips_code_fences() {
        assert_eq!(strip_fences("```markdown\n# Hi\n```"), "# Hi");
        assert_eq!(strip_fences("# Hi"), "# Hi");
    }
}
