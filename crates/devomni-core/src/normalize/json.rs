use serde_json::Value;

/// Parse, recursively sort object keys, pretty-print (2-space indent).
///
/// Sorting is done explicitly rather than relying on serde_json's BTreeMap
/// backing, because any crate in the graph enabling `preserve_order` would
/// silently disable it.
pub fn sort_keys(text: &str) -> Result<String, String> {
    let value: Value = serde_json::from_str(text).map_err(|e| {
        format!("JSON parse error at line {}, column {}: key sorting skipped", e.line(), e.column())
    })?;
    serde_json::to_string_pretty(&sort_value(value)).map_err(|e| e.to_string())
}

fn sort_value(v: Value) -> Value {
    match v {
        Value::Object(map) => {
            let mut entries: Vec<(String, Value)> = map.into_iter().collect();
            entries.sort_by(|a, b| a.0.cmp(&b.0));
            Value::Object(entries.into_iter().map(|(k, v)| (k, sort_value(v))).collect())
        }
        Value::Array(items) => Value::Array(items.into_iter().map(sort_value).collect()),
        other => other,
    }
}
