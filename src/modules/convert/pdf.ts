/**
 * PDF → Markdown from the PDF's own text layer (pdf.js), plus page rendering
 * for thumbnails and AI OCR.
 *
 * Each page's Markdown starts with `<!-- page N -->` (invisible when rendered),
 * so OCR results can replace exactly the pages the user picked.
 */
import * as pdfjs from "pdfjs-dist";
import type { PDFDocumentProxy, TextItem } from "pdfjs-dist/types/src/display/api";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

export type PdfDoc = PDFDocumentProxy;

export function loadPdf(bytes: ArrayBuffer): Promise<PdfDoc> {
  return pdfjs.getDocument({ data: new Uint8Array(bytes), isEvalSupported: false, useSystemFonts: true }).promise;
}

export interface PdfMarkdown {
  markdown: string;
  pages: number;
  /** 1-based pages with (almost) no text layer — likely scanned images. */
  emptyPages: number[];
  words: number;
}

interface Line {
  text: string;
  x: number;
  y: number;
  size: number;
}

// Word bullets come as real glyphs, Symbol/Wingdings private-use chars (U+F0B7…),
// or a Courier "o" for the second level.
const BULLET = /^([•●▪◦○■□➢►✓✔❖➤\-–—*·]|[\uF000-\uF0FF]|o(?=\s+[A-ZÀ-Ỹ0-9]))\s*/u;
const NUMBERED = /^(\d{1,3}[.)]|[a-zđ][.)]|[ivx]{1,4}[.)])\s+/i;
/** Table-of-contents line: "1.2. Title ........ 5" */
const TOC_LINE = /^(.*\S)\s*[.…·_]{4,}\s*\d{1,4}$/;
const PAGE_NO = /^(trang|page)?\s*\d{1,4}(\s*(\/|of|trên)\s*\d{1,4})?$/i;

async function pageLines(doc: PdfDoc, n: number): Promise<Line[]> {
  const page = await doc.getPage(n);
  const content = await page.getTextContent();
  const items = (content.items as TextItem[])
    .filter((it) => typeof it.str === "string" && it.str.length > 0)
    .map((it) => ({
      str: it.str,
      x: it.transform[4],
      y: it.transform[5],
      w: it.width,
      size: Math.hypot(it.transform[2], it.transform[3]) || it.height || 10,
    }));
  // Top to bottom, then left to right.
  items.sort((a, b) => b.y - a.y || a.x - b.x);

  const lines: Line[] = [];
  let cur: typeof items = [];
  const flush = () => {
    if (!cur.length) return;
    cur.sort((a, b) => a.x - b.x);
    let text = "";
    let end = -Infinity;
    for (const it of cur) {
      const gap = it.x - end;
      if (text && gap > it.size * 0.18 && !text.endsWith(" ") && !it.str.startsWith(" ")) text += " ";
      text += it.str;
      end = it.x + it.w;
    }
    const chars = cur.reduce((s, it) => s + it.str.length, 0);
    const size = cur.reduce((s, it) => s + it.size * it.str.length, 0) / Math.max(1, chars);
    const t = text.replace(/\s+/g, " ").trim();
    if (t) lines.push({ text: t, x: cur[0].x, y: cur[0].y, size });
    cur = [];
  };
  for (const it of items) {
    if (cur.length && Math.abs(it.y - cur[0].y) > Math.max(2, Math.min(it.size, cur[0].size) * 0.45)) flush();
    cur.push(it);
  }
  flush();
  return lines;
}

const norm = (s: string) => s.replace(/\d+/g, "#").toLowerCase();

function escapeLine(s: string): string {
  return s
    .replace(/^(#{1,6}\s|>)/, "\\$1")
    .replace(/<(?=[A-Za-z/!?])/g, "&lt;")
    .replace(/^(\d{1,3})([.)])(?!\s)/, "$1\\$2");
}

export async function pdfToMarkdown(doc: PdfDoc, onProgress?: (page: number) => void): Promise<PdfMarkdown> {
  const pages: Line[][] = [];
  for (let n = 1; n <= doc.numPages; n++) {
    pages.push(await pageLines(doc, n));
    onProgress?.(n);
  }

  // Running headers/footers: same text (digits ignored) at the top or bottom of most pages.
  const repeated = new Set<string>();
  if (pages.length >= 3) {
    const counts = new Map<string, number>();
    for (const lines of pages) {
      const edge = new Set([...lines.slice(0, 2), ...lines.slice(-2)].map((l) => norm(l.text)));
      edge.forEach((k) => counts.set(k, (counts.get(k) ?? 0) + 1));
    }
    counts.forEach((c, k) => c >= Math.max(3, pages.length * 0.5) && repeated.add(k));
  }

  // Body text size = most common size by character count.
  const bySize = new Map<number, number>();
  pages.flat().forEach((l) => {
    const k = Math.round(l.size * 2) / 2;
    bySize.set(k, (bySize.get(k) ?? 0) + l.text.length);
  });
  const body = [...bySize.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? 10;
  const headingSizes = [...bySize.keys()].filter((s) => s >= body * 1.15).sort((a, b) => b - a);
  const level = (size: number) => {
    const k = Math.round(size * 2) / 2;
    const i = headingSizes.indexOf(k);
    return i < 0 ? 0 : Math.min(3, i + 1);
  };

  const out: string[] = [];
  const empty: number[] = [];
  let words = 0;

  pages.forEach((all, idx) => {
    const n = idx + 1;
    const lines = all.filter((l, i) => {
      const edge = i < 2 || i >= all.length - 2;
      return !(edge && (repeated.has(norm(l.text)) || PAGE_NO.test(l.text)));
    });
    const chars = lines.reduce((s, l) => s + l.text.replace(/\s/g, "").length, 0);
    if (chars < 15) {
      empty.push(n);
      out.push(`<!-- page ${n}: no text layer (scanned?) - use AI OCR -->`);
      return;
    }
    out.push(`<!-- page ${n} -->`);

    // Typical line spacing on this page, to tell line wraps from paragraph breaks.
    const gaps = lines.slice(1).map((l, i) => lines[i].y - l.y).filter((g) => g > 0).sort((a, b) => a - b);
    const typical = gaps[Math.floor(gaps.length / 2)] ?? body * 1.3;
    const left = Math.min(...lines.map((l) => l.x));

    const blocks: string[] = [];
    let para: string[] = [];
    let prev: Line | null = null;
    let heading: { level: number; line: Line } | null = null;
    const flush = () => {
      if (para.length) blocks.push(para.join(""));
      para = [];
    };

    for (const l of lines) {
      words += l.text.split(/\s+/).filter(Boolean).length;
      const h = l.text.length < 160 ? level(l.size) : 0;
      if (h) {
        flush();
        const text = l.text.replace(/^#+\s*/, "");
        // A long heading wrapped onto the next line: same level, tight spacing.
        if (heading && heading.level === h && heading.line.y - l.y < l.size * 1.8 && blocks.length) {
          blocks[blocks.length - 1] += ` ${text}`;
        } else {
          blocks.push(`${"#".repeat(h)} ${text}`);
        }
        heading = { level: h, line: l };
        prev = null;
        continue;
      }
      heading = null;
      const toc = TOC_LINE.exec(l.text);
      if (toc) {
        flush();
        blocks.push(`- ${escapeLine(toc[1].replace(/[.…·_\s]+$/, ""))}`);
        prev = null;
        continue;
      }
      const bullet = BULLET.exec(l.text);
      const numbered = NUMBERED.exec(l.text);
      const gap = prev ? prev.y - l.y : 0;
      const breakHere =
        !prev || bullet || numbered || gap > typical * 1.45 || gap < 0 || Math.abs(l.size - prev.size) > body * 0.12 || l.x - left > body * 2.5 && prev.x - left < body;
      if (breakHere) {
        flush();
        if (bullet) para.push(`- ${escapeLine(l.text.slice(bullet[0].length))}`);
        else para.push(escapeLine(l.text));
      } else {
        // Same paragraph: join wrapped lines, re-joining hyphenated words.
        const last = para[para.length - 1];
        if (/[A-Za-zÀ-ỹ]-$/.test(last) && /^[a-zà-ỹ]/.test(l.text)) para[para.length - 1] = last.slice(0, -1);
        else para.push(" ");
        para.push(l.text.replace(/</g, "&lt;"));
      }
      prev = l;
    }
    flush();
    out.push(blocks.join("\n\n"));
  });

  return { markdown: out.join("\n\n") + "\n", pages: pages.length, emptyPages: empty, words };
}

// ── Page markers ────────────────────────────────────────────────────────────

const MARKER = /^<!-- page (\d+)(?::[^>]*)? -->$/gm;

/** Replace the given pages' sections with new Markdown (from OCR). */
export function replacePages(markdown: string, replacements: Map<number, string>): string {
  const parts: { page: number; text: string }[] = [];
  let lastIndex = 0;
  let lastPage = 0;
  let head = "";
  for (const m of markdown.matchAll(MARKER)) {
    const chunk = markdown.slice(lastIndex, m.index);
    if (lastPage === 0) head = chunk;
    else parts.push({ page: lastPage, text: chunk });
    lastPage = Number(m[1]);
    lastIndex = (m.index ?? 0) + m[0].length;
  }
  if (lastPage) parts.push({ page: lastPage, text: markdown.slice(lastIndex) });
  else head = markdown;

  const seen = new Set(parts.map((p) => p.page));
  replacements.forEach((_text, page) => {
    if (!seen.has(page)) parts.push({ page, text: "" });
  });
  parts.sort((a, b) => a.page - b.page);
  const body = parts
    .map((p) => {
      const text = replacements.has(p.page) ? replacements.get(p.page)!.trim() : p.text.trim();
      return `<!-- page ${p.page} -->\n\n${text}`;
    })
    .join("\n\n");
  return (head.trim() ? head.trim() + "\n\n" : "") + body + "\n";
}

// ── Rendering ───────────────────────────────────────────────────────────────

async function renderToCanvas(doc: PdfDoc, n: number, scaleFor: (w: number, h: number) => number) {
  const page = await doc.getPage(n);
  const base = page.getViewport({ scale: 1 });
  const viewport = page.getViewport({ scale: scaleFor(base.width, base.height) });
  const canvas = document.createElement("canvas");
  canvas.width = Math.ceil(viewport.width);
  canvas.height = Math.ceil(viewport.height);
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  await page.render({ canvasContext: ctx, viewport }).promise;
  return canvas;
}

export async function renderThumb(doc: PdfDoc, n: number, width = 160): Promise<string> {
  const c = await renderToCanvas(doc, n, (w) => (width * (window.devicePixelRatio || 1)) / w);
  return c.toDataURL("image/jpeg", 0.8);
}

/** Page image for OCR: ~2000px on the long side (sharp enough, small enough to upload). */
export async function renderForOcr(doc: PdfDoc, n: number): Promise<{ data: string; mime: string }> {
  const c = await renderToCanvas(doc, n, (w, h) => Math.min(4, 2000 / Math.max(w, h)));
  const url = c.toDataURL("image/jpeg", 0.92);
  return { data: url.slice(url.indexOf(",") + 1), mime: "image/jpeg" };
}
