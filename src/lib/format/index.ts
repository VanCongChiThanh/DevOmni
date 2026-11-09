import { invoke } from "@/lib/tauri";
import type { FormatRequest, FormatResponse, FormatSettings } from "./types";

export type { FormatSettings } from "./types";
export { DEFAULT_FORMAT } from "./types";

/** Engine labels (kept here so the UI doesn't load the worker bundle). */
const LABELS: Record<string, string> = {
  plsql: "DevOmni PL/SQL + sql-formatter",
  sql: "sql-formatter",
  javascript: "Prettier",
  typescript: "Prettier",
  json: "Prettier",
  css: "Prettier",
  scss: "Prettier",
  html: "Prettier",
  markdown: "Prettier",
  yaml: "Prettier",
  c: "clang-format",
  cpp: "clang-format",
  java: "clang-format",
  csharp: "clang-format",
  go: "gofmt",
  python: "Ruff",
  rust: "rustfmt",
};

export const formatterLabel = (language: string): string | null => LABELS[language] ?? null;

const TIMEOUT_MS = 20_000;
let worker: Worker | null = null;
let seq = 0;
const pending = new Map<number, { resolve: (s: string) => void; reject: (e: Error) => void; timer: number }>();

function getWorker(): Worker {
  if (worker) return worker;
  worker = new Worker(new URL("./worker.ts", import.meta.url), { type: "module" });
  worker.onmessage = (e: MessageEvent<FormatResponse>) => {
    const p = pending.get(e.data.id);
    if (!p) return;
    pending.delete(e.data.id);
    window.clearTimeout(p.timer);
    if (e.data.ok) p.resolve(e.data.text);
    else p.reject(new Error(e.data.error));
  };
  worker.onerror = (e) => resetWorker(new Error(e.message || "Formatter crashed"));
  return worker;
}

function resetWorker(err: Error) {
  worker?.terminate();
  worker = null;
  for (const p of pending.values()) {
    window.clearTimeout(p.timer);
    p.reject(err);
  }
  pending.clear();
}

/** Format `text` as `language`. Rejects with a readable message on syntax errors. */
export async function formatCode(text: string, language: string, settings: FormatSettings): Promise<string> {
  if (!text.trim()) return text;
  let out: string;
  if (language === "rust") {
    out = await invoke<string>("format_external", { formatter: "rustfmt", text, ext: "rs" });
  } else {
    if (!formatterLabel(language)) throw new Error(`No formatter available for ${language}`);
    const id = ++seq;
    const req: FormatRequest = { id, text, language, settings };
    out = await new Promise<string>((resolve, reject) => {
      const timer = window.setTimeout(() => resetWorker(new Error("Formatter timed out")), TIMEOUT_MS);
      pending.set(id, { resolve, reject, timer });
      getWorker().postMessage(req);
    });
  }
  verifyFormatted(text, out, language);
  return out;
}

/**
 * Safety net: a formatter must never lose code. Empty output is always rejected.
 * For SQL/PL/SQL (our own formatter) only whitespace and keyword case may change;
 * anything else means a formatter bug, so the code is left untouched.
 */
export function verifyFormatted(before: string, after: string, language: string) {
  if (typeof after !== "string" || (before.trim() !== "" && after.trim() === "")) {
    throw new Error("formatter returned no output; your code was left unchanged");
  }
  if (language === "sql" || language === "plsql") {
    const norm = (s: string) => s.replace(/\s+/g, "").toLowerCase();
    if (norm(before) !== norm(after)) {
      throw new Error("formatter would change more than whitespace/keyword case; your code was left unchanged");
    }
  }
}
