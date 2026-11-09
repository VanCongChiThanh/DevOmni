# DevOmni

A desktop toolkit for developers (Windows / macOS) that **works offline**. Your data stays on your machine unless you choose to use AI OCR.

It has 3 tools:

| Tool | What it's for |
|---|---|
| **Code Compare** | Compare two files or snippets and merge changes between them |
| **Document Converter** | Word, PDF, PowerPoint, Excel… ⇄ Markdown |
| **Dev Toolbox** | JSON, JWT, Base64, Hash, Timestamp, UUID, Regex… |

Light / Dark / System theme: click the button at the bottom of the left sidebar.

---

## Install and run

**You need:** Node.js 20, Rust (`winget install Rustlang.Rustup`), and Visual Studio Build Tools (the "Desktop development with C++" workload).

```bash
npm install
npm run fetch:pandoc   # downloads Pandoc (run once)
npm run tauri dev      # starts the app
```

> `npm run dev` only serves the UI in a browser. It **does not open the app window**, and anything that opens files won't work. Use `npm run tauri dev`.

To build an installer, run `npm run tauri build`. The installer ends up in `target/release/bundle`.

---

## 1. Code Compare

- Open files with the buttons, or drag a file onto the left or right half. Drop two files at once to fill both sides.
- You can also paste code and edit it directly in either pane.
- The **Compare options** panel on the right can ignore whitespace, blank lines, comments or letter case, sort JSON keys, and auto-format code.
  - Drag its left edge to resize it; double-click the edge to reset the width.
  - Drag it all the way closed, or press `Ctrl+B`, to hide or show it.

| Shortcut | Action |
|---|---|
| `F7` / `Shift+F7` (or `Alt+↓` / `Alt+↑`) | Next / previous change |
| `Alt+→` / `Alt+←` | Copy the current block right / left |
| `Ctrl+Z` | Undo |
| `Ctrl+B` | Show / hide the options panel |

---

## 2. Document Converter

Drag files in, or click to pick them. The rule is simple:

- **Markdown files** become the format you pick in **"Markdown →"** at the top: Word, PDF, ODT, RTF, HTML, EPUB, PowerPoint or LaTeX.
- **Every other file** becomes Markdown: `.docx .doc .pdf .pptx .xlsx .odt .rtf .html .epub …`

**No lost text:**
- After each conversion, the app reads the result back and counts its words and images. Each row shows something like `100% text · 5/5 images`.
- Images are kept. When converting to Markdown, they're saved to a `<file name>_media` folder next to the output.
- Existing files are never overwritten. If the name is taken, the new file is saved as `name (1).md`.
- RTF and LaTeX output shows "not verified", because those formats can't be read back reliably for checking.

**Options at the top:**
- **Default style:** pick a Word file as a template, so the output uses its fonts, heading styles and margins.
- **Next to source:** choose where results are saved (by default, the same folder as the original).

**Note:**
- Old `.doc` files and **PDF** output need Microsoft Word, WPS Office or LibreOffice on the machine. The app finds them automatically. If none is installed, these options are greyed out.

### PDF → Markdown and AI OCR

1. Drop a PDF in. The app reads the text already in the PDF and rebuilds headings, lists and paragraphs.
2. Click 👁 to **preview** the result, either rendered or as Markdown source.
3. If the text is wrong or missing, or the PDF is a **scan**, click **"Fix pages with AI OCR"**.
4. **Choose the pages** to re-read: click page thumbnails, hold `Shift` to select a range, type something like `1-3, 7`, or click "Scanned pages".
5. Click **Run OCR**. Only the selected pages are sent, and only those pages are replaced in the `.md` file.

**Turning on AI OCR the first time (free):**
1. Click **"Set up AI OCR"** → **"Open Google AI Studio"**.
2. Sign in with Google, click **Create API key**, and copy the key.
3. Paste it into the app and click **Connect**.

The key is stored in your system's credential manager (Windows Credential Manager), not in the app's files. To remove it, open "AI OCR" again and click **Remove API key**.

> Tables in a PDF often come out as run-together text with plain text reading. That's when AI OCR helps most.

---

## 3. Dev Toolbox

Pick a tool from the left column (there's a search box). Everything runs offline, and what you paste in is **never saved** to disk.

| Tool | What it does |
|---|---|
| **JSON** | Format, minify and sort keys; shows errors at the exact line and column. Long ID numbers are kept exactly (no rounding). |
| **JWT** | Decode a token, show whether it has expired, and verify its signature. |
| **Encode / Decode** | Base64, Base64URL, URL, HTML and Hex. If the data is an image, it's shown as an image. |
| **Hash** | MD5, SHA-1, SHA-256, SHA-384, SHA-512 and HMAC; can hash whole files. |
| **Timestamp** | Convert Unix time ⇄ date and time, including a ready-made Oracle `TO_TIMESTAMP`. |
| **UUID & Random** | Generate UUID v4/v7 in bulk, or random passwords. |
| **Regex** | Test regular expressions, highlight matches, and replace. |
| **Case** | Convert between camelCase, snake_case, CONSTANT and more. Strips Vietnamese accents automatically: "Tên sản phẩm" → `ten_san_pham`. |
| **Number base** | Convert between decimal, hex, octal and binary, with no size limit. |

---

## For developers

```bash
npm run test:core     # Rust core tests
npm run typecheck     # TypeScript type check
cargo run -p devomni-core --example convert -- <file> [output-dir] [format]   # convert a file from the command line
```

Code structure and design decisions: see [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).
