/**
 * JSON formatting that never silently corrupts data:
 * - Numbers JavaScript can't represent exactly (IDs > 2^53, long decimals) are
 *   kept digit-for-digit instead of being rounded by JSON.parse.
 * - Input with comments / trailing commas (copied from logs, configs, JS) is
 *   accepted, and the result says so.
 */
export type Indent = "2" | "4" | "tab" | "min";

export type JsonResult =
  | { ok: true; text: string; lenient: boolean; bigNumbers: number }
  | { ok: false; error: string; line?: number; col?: number };

/** Wrap number literals with >15 significant digits in sentinel strings. */
export function protectBigNumbers(src: string): { text: string; count: number } {
  let out = "";
  let count = 0;
  let i = 0;
  const n = src.length;
  while (i < n) {
    const ch = src[i];
    if (ch === '"') {
      let j = i + 1;
      while (j < n && src[j] !== '"') j += src[j] === "\\" ? 2 : 1;
      out += src.slice(i, j + 1);
      i = j + 1;
      continue;
    }
    if (ch === "-" || (ch >= "0" && ch <= "9")) {
      const m = /^-?\d+(\.\d+)?([eE][+-]?\d+)?/.exec(src.slice(i, i + 400));
      if (m) {
        const tok = m[0];
        const mantissa = tok.split(/[eE]/)[0].replace(/[-.]/g, "").replace(/^0+/, "");
        if (mantissa.length > 15) {
          // Escaped form: a raw U+0000 inside a JSON string is itself invalid JSON.
          out += `"\\u0000BIG:${tok}"`;
          count++;
        } else {
          out += tok;
        }
        i += tok.length;
        continue;
      }
    }
    out += ch;
    i++;
  }
  return { text: out, count };
}

export const restoreBigNumbers = (s: string) => s.replace(/"\\u0000BIG:([-+0-9.eE]+)"/g, "$1");

/** Strip // and /* *\/ comments and trailing commas (outside strings). */
export function relax(src: string): string {
  let out = "";
  let i = 0;
  const n = src.length;
  while (i < n) {
    const ch = src[i];
    if (ch === '"') {
      let j = i + 1;
      while (j < n && src[j] !== '"') j += src[j] === "\\" ? 2 : 1;
      out += src.slice(i, j + 1);
      i = j + 1;
    } else if (ch === "/" && src[i + 1] === "/") {
      while (i < n && src[i] !== "\n") i++;
    } else if (ch === "/" && src[i + 1] === "*") {
      const end = src.indexOf("*/", i + 2);
      i = end < 0 ? n : end + 2;
    } else if (ch === ",") {
      let j = i + 1;
      while (j < n && /\s/.test(src[j])) j++;
      if (src[j] === "}" || src[j] === "]") i++;
      else {
        out += ch;
        i++;
      }
    } else {
      out += ch;
      i++;
    }
  }
  return out;
}

function sortKeys(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(sortKeys);
  if (v && typeof v === "object") {
    const o = v as Record<string, unknown>;
    return Object.fromEntries(
      Object.keys(o)
        .sort((a, b) => a.localeCompare(b))
        .map((k) => [k, sortKeys(o[k])]),
    );
  }
  return v;
}

export function locate(src: string, message: string): { line?: number; col?: number } {
  const lc = /line (\d+) column (\d+)/.exec(message);
  if (lc) return { line: +lc[1], col: +lc[2] };
  const pos = /position (\d+)/.exec(message);
  if (!pos) return {};
  const p = Math.min(+pos[1], src.length);
  const before = src.slice(0, p);
  const line = before.split("\n").length;
  return { line, col: p - before.lastIndexOf("\n") };
}

export function formatJson(src: string, opts: { indent: Indent; sort: boolean }): JsonResult {
  if (!src.trim()) return { ok: true, text: "", lenient: false, bigNumbers: 0 };
  let lenient = false;
  let prepared = protectBigNumbers(src);
  let value: unknown;
  try {
    value = JSON.parse(prepared.text);
  } catch {
    try {
      prepared = protectBigNumbers(relax(src));
      value = JSON.parse(prepared.text);
      lenient = true;
    } catch {
      // Report the error against the user's own text.
      try {
        JSON.parse(src);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        return { ok: false, error: msg.replace(/^JSON\.parse: /, ""), ...locate(src, msg) };
      }
      return { ok: false, error: "Invalid JSON" };
    }
  }
  if (opts.sort) value = sortKeys(value);
  const space = opts.indent === "min" ? undefined : opts.indent === "tab" ? "\t" : Number(opts.indent);
  return { ok: true, text: restoreBigNumbers(JSON.stringify(value, null, space)), lenient, bigNumbers: prepared.count };
}
