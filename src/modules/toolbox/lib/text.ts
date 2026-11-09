// ── Case conversion ─────────────────────────────────────────────────────────

/** Remove Vietnamese (and other) diacritics: "Tên sản phẩm" → "Ten san pham". */
export const stripDiacritics = (s: string) =>
  s.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/đ/g, "d").replace(/Đ/g, "D");

/** Split into words across camelCase, PascalCase, ACRONYMS, snake, kebab, spaces, dots. */
export function words(s: string): string[] {
  return stripDiacritics(s)
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean);
}

const cap = (w: string) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase();

export const CASES: { id: string; label: string; fn: (line: string) => string }[] = [
  { id: "camel", label: "camelCase", fn: (s) => words(s).map((w, i) => (i ? cap(w) : w.toLowerCase())).join("") },
  { id: "pascal", label: "PascalCase", fn: (s) => words(s).map(cap).join("") },
  { id: "snake", label: "snake_case", fn: (s) => words(s).map((w) => w.toLowerCase()).join("_") },
  { id: "constant", label: "CONSTANT_CASE", fn: (s) => words(s).map((w) => w.toUpperCase()).join("_") },
  { id: "kebab", label: "kebab-case", fn: (s) => words(s).map((w) => w.toLowerCase()).join("-") },
  { id: "dot", label: "dot.case", fn: (s) => words(s).map((w) => w.toLowerCase()).join(".") },
  { id: "title", label: "Title Case", fn: (s) => s.toLocaleLowerCase().replace(/(^|\s)(\S)/gu, (_, a, b) => a + b.toLocaleUpperCase()) },
  { id: "lower", label: "lower case", fn: (s) => s.toLocaleLowerCase() },
  { id: "upper", label: "UPPER CASE", fn: (s) => s.toLocaleUpperCase() },
  { id: "ascii", label: "No diacritics", fn: stripDiacritics },
];

// ── Number bases ────────────────────────────────────────────────────────────

export type Base = 2 | 8 | 10 | 16;

/** Parse an integer of any size. `base` null = detect from 0x / 0b / 0o prefix. */
export function parseBigInt(input: string, base: Base | null): bigint {
  let s = input.trim().replace(/[_\s,]/g, "");
  if (!s) throw new Error("Enter a number");
  let neg = false;
  if (s[0] === "-") {
    neg = true;
    s = s.slice(1);
  }
  let b: Base = base ?? 10;
  const pre = /^0([xbo])/i.exec(s);
  if (pre && (base === null || base === { x: 16, b: 2, o: 8 }[pre[1].toLowerCase() as "x" | "b" | "o"])) {
    b = { x: 16, b: 2, o: 8 }[pre[1].toLowerCase() as "x" | "b" | "o"] as Base;
    s = s.slice(2);
  }
  const digits = { 2: /^[01]+$/, 8: /^[0-7]+$/, 10: /^\d+$/, 16: /^[0-9a-f]+$/i }[b];
  if (!digits.test(s)) throw new Error(`Not a valid base-${b} number`);
  const prefix = { 2: "0b", 8: "0o", 10: "", 16: "0x" }[b];
  const v = BigInt(prefix + s);
  return neg ? -v : v;
}

export function formatBase(v: bigint, base: Base, group = false): string {
  const neg = v < 0n;
  let s = (neg ? -v : v).toString(base);
  if (base === 16) s = s.toUpperCase();
  if (group) {
    const size = base === 10 ? 3 : 4;
    s = s.replace(new RegExp(`\\B(?=(.{${size}})+(?!.))`, "g"), base === 10 ? "," : " ");
  }
  return (neg ? "-" : "") + s;
}

// ── Timestamps ──────────────────────────────────────────────────────────────

/** Unix seconds / ms / µs (by magnitude) or any date string Date can parse. */
export function parseTime(input: string): Date {
  const s = input.trim();
  if (!s) throw new Error("Enter a timestamp or date");
  if (/^-?\d+(\.\d+)?$/.test(s)) {
    const n = Number(s);
    const abs = Math.abs(n);
    const ms = abs < 1e11 ? n * 1000 : abs < 1e14 ? n : n / 1000;
    return new Date(ms);
  }
  // "2026-11-09 10:00:00" → treat as local time (Date.parse is inconsistent with a space).
  const normalized = /^\d{4}-\d{2}-\d{2} \d/.test(s) ? s.replace(" ", "T") : s;
  const d = new Date(normalized);
  if (Number.isNaN(d.getTime())) throw new Error("Unrecognized date. Try 1731139200, 2026-11-09 10:00 or an ISO date");
  return d;
}

const p2 = (n: number) => String(n).padStart(2, "0");

export const localStamp = (d: Date) =>
  `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())} ${p2(d.getHours())}:${p2(d.getMinutes())}:${p2(d.getSeconds())}`;

export function isoLocal(d: Date): string {
  const off = -d.getTimezoneOffset();
  const sign = off >= 0 ? "+" : "-";
  const ms = String(d.getMilliseconds()).padStart(3, "0");
  return `${localStamp(d).replace(" ", "T")}.${ms}${sign}${p2(Math.floor(Math.abs(off) / 60))}:${p2(Math.abs(off) % 60)}`;
}

export function relative(d: Date, now = Date.now()): string {
  const diff = d.getTime() - now;
  const abs = Math.abs(diff);
  const units: [Intl.RelativeTimeFormatUnit, number][] = [
    ["year", 31536e6],
    ["month", 2592e6],
    ["day", 864e5],
    ["hour", 36e5],
    ["minute", 6e4],
    ["second", 1e3],
  ];
  const rtf = new Intl.RelativeTimeFormat("en", { numeric: "auto" });
  for (const [unit, ms] of units) if (abs >= ms || unit === "second") return rtf.format(Math.round(diff / ms), unit);
  return "";
}

// ── Random ──────────────────────────────────────────────────────────────────

/** UUID v7: 48-bit Unix ms timestamp + random — sortable by creation time. */
export function uuidv7(now = Date.now()): string {
  const b = crypto.getRandomValues(new Uint8Array(16));
  let t = now;
  for (let i = 5; i >= 0; i--) {
    b[i] = t % 256;
    t = Math.floor(t / 256);
  }
  b[6] = (b[6] & 0x0f) | 0x70;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

/** Uniform random string (rejection sampling, no modulo bias). */
export function randomString(length: number, alphabet: string): string {
  if (!alphabet) return "";
  const chars = Array.from(alphabet);
  const limit = 256 - (256 % chars.length);
  let out = "";
  while (out.length < length) {
    for (const x of crypto.getRandomValues(new Uint8Array(length * 2))) {
      if (x < limit && chars.length <= 256) out += chars[x % chars.length];
      if (out.length >= length) break;
    }
  }
  return out;
}
