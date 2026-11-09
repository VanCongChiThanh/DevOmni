#[derive(Debug, thiserror::Error)]
pub enum CoreError {
    #[error("I/O error: {0}")]
    Io(#[from] std::io::Error),

    #[error("file is too large ({size} bytes, limit is {limit} bytes)")]
    TooLarge { size: u64, limit: u64 },

    #[error("file appears to be binary")]
    Binary,

    #[error("{0}")]
    Convert(String),

    #[error("input too large to compare: {lines} lines (limit is {limit})")]
    TooManyLines { lines: usize, limit: usize },
}
