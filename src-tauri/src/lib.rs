//! Tauri shell: wires IPC commands to `devomni-core`.
//!
//! Keep this layer thin — no business logic here. Each module (compare, docs,
//! toolbox, ai) owns one file under `commands/` and registers its handlers below.

mod commands;
mod error;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .manage(commands::convert::Outputs::default())
        .invoke_handler(tauri::generate_handler![
            commands::compare::compare_texts,
            commands::compare::detect_language_cmd,
            commands::compare::format_external,
            commands::fs::read_text_file,
            commands::convert::converter_caps,
            commands::engine::install_pandoc,
            commands::convert::convert_document,
            commands::convert::read_pdf,
            commands::convert::save_markdown,
            commands::convert::update_markdown,
            commands::convert::read_markdown,
            commands::convert::preview_document,
            commands::convert::open_document,
            commands::ai::ai_status,
            commands::ai::ai_set_key,
            commands::ai::ai_clear_key,
            commands::ai::ai_models,
            commands::ai::ai_ocr_page,
            commands::ai::open_ai_studio,
        ])
        .run(tauri::generate_context!())
        .expect("error while running DevOmni");
}
