use serde::{Serialize, Serializer};

/// Error type returned by every command. Serialized as a plain string so the
/// frontend gets a readable message in the rejected promise.
#[derive(Debug, thiserror::Error)]
pub enum AppError {
    #[error(transparent)]
    Core(#[from] devomni_core::CoreError),

    #[error("{0}")]
    Io(#[from] std::io::Error),

    #[error("{0}")]
    Internal(String),
}

impl Serialize for AppError {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        serializer.serialize_str(&self.to_string())
    }
}

pub type AppResult<T> = Result<T, AppError>;

/// Run CPU-heavy / blocking work off the async runtime so IPC stays responsive.
pub async fn blocking<T, F>(f: F) -> AppResult<T>
where
    F: FnOnce() -> T + Send + 'static,
    T: Send + 'static,
{
    tauri::async_runtime::spawn_blocking(f)
        .await
        .map_err(|e| AppError::Internal(e.to_string()))
}
