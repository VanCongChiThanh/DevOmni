use std::fs;
use std::path::Path;

use serde::Serialize;

use crate::error::CoreError;
use crate::language::Language;

pub const MAX_FILE_BYTES: u64 = 64 * 1024 * 1024;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LoadedFile {
    pub path: String,
    pub name: String,
    pub text: String,
    pub language: Language,
    pub size: u64,
    /// Invalid UTF-8 sequences were replaced with U+FFFD.
    pub lossy: bool,
}

pub fn load_text_file(path: &Path) -> Result<LoadedFile, CoreError> {
    let size = fs::metadata(path)?.len();
    if size > MAX_FILE_BYTES {
        return Err(CoreError::TooLarge { size, limit: MAX_FILE_BYTES });
    }
    let bytes = fs::read(path)?;
    let (text, lossy) = decode(&bytes)?;
    let path_str = path.to_string_lossy().into_owned();
    Ok(LoadedFile {
        name: path.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default(),
        language: Language::from_path(&path_str),
        path: path_str,
        text,
        size,
        lossy,
    })
}

/// UTF-8 (with/without BOM) and UTF-16 LE/BE (with BOM). Rejects binary files.
pub fn decode(bytes: &[u8]) -> Result<(String, bool), CoreError> {
    if let Some(rest) = bytes.strip_prefix(&[0xFFu8, 0xFE][..]) {
        return Ok((utf16(rest, u16::from_le_bytes), false));
    }
    if let Some(rest) = bytes.strip_prefix(&[0xFEu8, 0xFF][..]) {
        return Ok((utf16(rest, u16::from_be_bytes), false));
    }
    let rest = bytes.strip_prefix(&[0xEFu8, 0xBB, 0xBF][..]).unwrap_or(bytes);
    if rest.iter().take(8192).any(|b| *b == 0) {
        return Err(CoreError::Binary);
    }
    match std::str::from_utf8(rest) {
        Ok(s) => Ok((s.to_owned(), false)),
        Err(_) => Ok((String::from_utf8_lossy(rest).into_owned(), true)),
    }
}

fn utf16(bytes: &[u8], to_u16: fn([u8; 2]) -> u16) -> String {
    let units: Vec<u16> = bytes.chunks_exact(2).map(|c| to_u16([c[0], c[1]])).collect();
    String::from_utf16_lossy(&units)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn decodes_variants() {
        assert_eq!(decode(b"\xEF\xBB\xBFhi").unwrap(), ("hi".into(), false));
        assert_eq!(decode(b"\xFF\xFEh\0i\0").unwrap(), ("hi".into(), false));
        assert!(decode(b"\x00\x01\x02").is_err());
        assert!(decode(b"ok\xFF").unwrap().1);
    }
}
