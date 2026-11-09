# DevOmni Architecture

## Layout

```
.
├── Cargo.toml                   # Rust workspace (core + tauri shell), release profile
├── crates/
│   └── devomni-core/            # PURE Rust engine — no Tauri dependency
│       └── src/
│           ├── compare.rs       # request → normalize ×2 (parallel) → diff → response
│           ├── diff.rs          # interned line diff (similar), aligned rows, inline word diff
│           ├── normalize/
│           │   ├── mod.rs       # pipeline: rewrites → comment strip → per-line keys
│           │   ├── comments.rs  # lexer-aware comment stripper (strings, lifetimes)
│           │   ├── json.rs      # recursive key sort + canonical pretty-print
│           │   └── external.rs  # Prettier / clang-format / rustfmt / gofmt / black (allow-listed)
│           ├── convert/         # Markdown ⇄ DOCX via Pandoc + verification
│           │   ├── mod.rs       # locate pandoc, convert, AST word/image check
│           │   ├── html2native.lua  # raw HTML in .md → real elements (DOCX drops raw HTML)
│           │   └── docx2md.lua  # Word → portable GFM (tables, TOC, numbering, anchors)
│           ├── language.rs      # detection + comment/string syntax per language
│           ├── io.rs            # file loading: UTF-8/UTF-16 BOM, binary rejection
│           └── error.rs
├── src-tauri/                   # Thin shell: IPC commands only, no logic
│   ├── src/commands/{compare,fs}.rs   # one file per module
│   ├── capabilities/default.json      # least-privilege permissions
│   └── tauri.conf.json
└── src/                         # React + TS
    ├── app/App.tsx              # icon rail + keep-alive tab host
    ├── modules/
    │   ├── registry.tsx         # plugin registry (lazy-loaded modules)
    │   └── compare/
    │       ├── store.ts         # zustand: sources, options, result, navigation
    │       ├── hooks.ts         # debounced auto-compare, shortcuts, OS file drop
    │       ├── api.ts / types.ts# typed IPC + mirrors of Rust serde types
    │       └── components/      # Toolbar, SourceEditors, DiffViewer, Minimap, NormalizePanel…
    └── lib/                     # invoke wrapper, storage helpers
```

## Key design decisions

**Display lines vs comparison keys.** Normalization never mutates what the user
sees unless it is a *rewrite* (formatter / JSON sort). Whitespace, case and comment
options only change the per-line *key*. Each key records its source display line
(`key_lines`), so lines excluded from comparison are still rendered as `ignored`
rows and differences hidden by normalization show up as `similar` (dimmed) rows.

**Backend produces render-ready rows.** The frontend contains zero diff logic. The
response is `rows[]` of `{kind, left?, right?, leftSpans?, rightSpans?}` that
reference line indices (text is sent once per side). Inline spans are UTF-16
offsets so JS can `slice()` directly.

**Performance.**
- Keys are interned to `u32` before diffing → integer comparisons in Myers.
- `similar` with a 4s deadline: pathological inputs degrade to a valid, non-minimal diff instead of freezing.
- Both sides normalize in parallel (`std::thread::scope`); all commands run on `spawn_blocking`.
- Stale responses are dropped by a request sequence number in the store.
- Viewer: one virtualized scroller for both panes (scroll sync for free, ~60 DOM rows at any file size); horizontal pane scroll via CSS variables (no React renders); canvas minimap painted from hunks only.
- Modules are `React.lazy`; the shell + first tab is all that loads at startup.

**Security.** The webview sends a `FormatterId` enum, never a command line. No
network access is required by Module A. AI features (next milestone) will route
through Rust so API keys live in the OS keychain, never in the webview, and every
outbound payload is explicit opt-in with a preview.

**Formatting is built in and runs in a Web Worker** (`src/lib/format/`), picked by language:
PL/SQL → DevOmni PL/SQL formatter (block layout) + sql-formatter for embedded DML;
SQL → sql-formatter; JS/TS/JSON/CSS/HTML/Markdown/YAML → Prettier; C/C++/Java/C# →
clang-format (WASM); Go → gofmt (WASM); Python → Ruff (WASM); Rust → rustfmt (CLI via
Rust). Formatting always rewrites the editor text in place (undoable); Auto-format just
triggers it on toggle, file open and paste. The PL/SQL formatter is idempotent, and
`verifyFormatted` rejects any SQL/PL/SQL result that changes more than whitespace or
keyword case, or any empty result, so a formatter bug can never lose code.

**One editable merge view** (`components/MergeView.tsx`, `diffDecorations.ts`): there is no
separate source/diff mode. Both panes are CodeMirror editors; the Rust rows become line
classes, inline marks and block spacer widgets, so row N sits at the same height on both
sides (fixed 20px lines) and scroll sync is 1:1. Decorations map through edits while typing
and are rebuilt when a diff for the current text arrives.

**Merge** (`src/modules/compare/merge.ts`): each change block maps to a line range per side;
→/← replace the target range with the source range. Merges are disabled while the diff is
stale (`rev !== resultRev`) so a fast second click can never apply ranges from an old diff.
External text changes are applied to the editor as a minimal range edit, so cursor, scroll
and the editor's own undo history survive merges and formatting.

**Markdown ⇄ Word** (`crates/devomni-core/src/convert/`): Pandoc is located in this order:
bundled resource (`src-tauri/resources/pandoc/`, filled by `npm run fetch:pandoc` and by
`beforeBuildCommand`), PATH, default install dirs. Markdown is read as
`commonmark_x-smart-implicit_figures` (GFM-compatible parsing + Pandoc extensions, quotes
and `--` untouched, no auto captions) through stdin after our UTF-8/UTF-16 decoder, with
`--resource-path` = the source folder so relative images embed. DOCX → MD first marks empty auto-numbered paragraphs in a temp copy
(`mark_numbered`, so "STT" numbers survive), always writes GFM through `docx2md.lua`, and uses
`--extract-media` with a relative folder name and cwd = output folder, so links are relative.
After converting, both documents are parsed to Pandoc JSON and compared (multiset word
coverage + image count, NFC-normalized); the UI shows that report rather than assuming success.
Text a filter drops on purpose (TOC page numbers) is reported on stderr as
`[devomni:removed] …` and excused from the check. Lua filters must not use `%s`/`%a`/`%u`: on
Windows locales they match UTF-8 continuation bytes and would split Vietnamese characters.

**Theme** (`src/lib/theme.ts`): all colors are CSS variables in `styles.css`; light mode
redefines them under `:root[data-theme="light"]`. `public/theme-boot.js` sets the attribute
before first paint (no flash). CodeMirror follows via a `darkTheme` compartment.

## Adding a module

1. `src/modules/<id>/<Id>View.tsx` with a default export.
2. Register it in `src/modules/registry.tsx`.
3. If it needs native work: logic in `crates/devomni-core/src/<id>/`, a thin command in
   `src-tauri/src/commands/<id>.rs`, and register it in `src-tauri/src/lib.rs`.
