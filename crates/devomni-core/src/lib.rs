//! DevOmni core engine.
//!
//! Pure Rust, no Tauri dependency: everything here is unit-testable with
//! `cargo test -p devomni-core` and reusable from a future CLI.
//!
//! Pipeline for a compare request:
//!   raw text ──► normalize (per side, in parallel) ──► intern keys ──► diff ──► aligned rows
//!
//! The diff runs on *comparison keys* (normalized lines) while the UI renders
//! *display lines*, so "ignore whitespace / comments / case" never changes what
//! the user sees — only what counts as a difference.

pub mod compare;
pub mod convert;
pub mod diff;
pub mod error;
pub mod io;
pub mod language;
pub mod normalize;

pub use compare::{compare, CompareRequest, CompareResponse, SideInput};
pub use error::CoreError;
pub use language::Language;
