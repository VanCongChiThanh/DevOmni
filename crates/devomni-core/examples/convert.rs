//! Run the converter from the command line (handy for checking real documents):
//!   cargo run -p devomni-core --example convert -- <file.md|file.docx> [output-dir]
use std::path::{Path, PathBuf};

use devomni_core::convert::{convert, locate_pandoc, ConvertRequest};

fn main() {
    let mut args = std::env::args().skip(1);
    let input = args.next().expect("usage: convert <file> [output-dir]");
    let output_dir = args.next();
    let bundled = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../../src-tauri/resources/pandoc")
        .join(if cfg!(windows) { "pandoc.exe" } else { "pandoc" });
    let info = locate_pandoc(&[bundled]).expect("pandoc not found");
    eprintln!("pandoc {} at {}", info.version, info.path);
    let target = args.next().and_then(|t| serde_json::from_value(serde_json::Value::String(t)).ok());
    let req = ConvertRequest { input, output_dir, reference_doc: None, target };
    match convert(Path::new(&info.path), &req) {
        Ok(r) => println!("{}", serde_json::to_string_pretty(&r).unwrap()),
        Err(e) => {
            eprintln!("error: {e}");
            std::process::exit(1);
        }
    }
}
