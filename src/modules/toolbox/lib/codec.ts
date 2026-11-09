/** Text ⇄ bytes ⇄ Base64 / URL / HTML / Hex. All UTF-8 safe. */
const enc = new TextEncoder();

export const utf8 = (s: string) => enc.encode(s);

/** Decode bytes as UTF-8; `null` when they aren't valid text (binary data). */
export function utf8Decode(bytes: Uint8Array): string | null {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return null;
  }
}

export function bytesToBase64(bytes: Uint8Array, urlSafe = false): string {
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  const b64 = btoa(bin);
  return urlSafe ? b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "") : b64;
}

/** Accepts standard and URL-safe alphabets, missing padding, whitespace, data: URIs. */
export function base64ToBytes(input: string): Uint8Array {
  let s = input.trim().replace(/^data:[^,]*;base64,/i, "").replace(/\s+/g, "");
  s = s.replace(/-/g, "+").replace(/_/g, "/");
  if (/[^A-Za-z0-9+/=]/.test(s)) throw new Error("Not Base64: contains characters outside the Base64 alphabet");
  s = s.replace(/=+$/, "");
  if (s.length % 4 === 1) throw new Error("Not Base64: invalid length");
  s += "=".repeat((4 - (s.length % 4)) % 4);
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function bytesToHex(bytes: Uint8Array, sep = ""): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join(sep);
}

export function hexToBytes(input: string): Uint8Array {
  const s = input.replace(/0x/gi, "").replace(/[\s,:-]+/g, "");
  if (/[^0-9a-f]/i.test(s)) throw new Error("Not hex: only 0-9 and a-f are allowed");
  if (s.length % 2) throw new Error("Not hex: odd number of digits");
  const out = new Uint8Array(s.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(s.slice(i * 2, i * 2 + 2), 16);
  return out;
}

const HTML_ESC: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
export const htmlEncode = (s: string) => s.replace(/[&<>"']/g, (c) => HTML_ESC[c]);

const NAMED: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };
/** Decodes numeric entities and common named ones (no DOM, so nothing executes). */
export function htmlDecode(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === "#") {
      const cp = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return cp >= 0 && cp <= 0x10ffff ? String.fromCodePoint(cp) : m;
    }
    return NAMED[e.toLowerCase()] ?? m;
  });
}

/** Sniff common image formats so decoded Base64 can be previewed. */
export function imageMime(bytes: Uint8Array): string | null {
  const b = bytes;
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return "image/png";
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  if (b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46) return "image/gif";
  if (b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45) return "image/webp";
  if (b[0] === 0x42 && b[1] === 0x4d) return "image/bmp";
  return null;
}
