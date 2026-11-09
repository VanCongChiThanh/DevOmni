import { bytesToHex } from "./codec";

const K = new Uint32Array(64).map((_, i) => Math.floor(Math.abs(Math.sin(i + 1)) * 2 ** 32) >>> 0);
const S = [
  7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 4,
  11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21,
];

/** MD5 (RFC 1321). WebCrypto doesn't offer it, but it's still everywhere (checksums, legacy APIs). */
export function md5(data: Uint8Array): string {
  const len = data.length;
  const blocks = ((len + 8) >>> 6) + 1;
  const w = new Uint32Array(blocks * 16);
  for (let i = 0; i < len; i++) w[i >> 2] |= data[i] << ((i % 4) * 8);
  w[len >> 2] |= 0x80 << ((len % 4) * 8);
  w[blocks * 16 - 2] = (len * 8) >>> 0;
  w[blocks * 16 - 1] = Math.floor((len * 8) / 2 ** 32);

  let a0 = 0x67452301,
    b0 = 0xefcdab89,
    c0 = 0x98badcfe,
    d0 = 0x10325476;
  for (let blk = 0; blk < blocks; blk++) {
    let A = a0,
      B = b0,
      C = c0,
      D = d0;
    for (let i = 0; i < 64; i++) {
      let F: number, g: number;
      if (i < 16) {
        F = (B & C) | (~B & D);
        g = i;
      } else if (i < 32) {
        F = (D & B) | (~D & C);
        g = (5 * i + 1) % 16;
      } else if (i < 48) {
        F = B ^ C ^ D;
        g = (3 * i + 5) % 16;
      } else {
        F = C ^ (B | ~D);
        g = (7 * i) % 16;
      }
      F = (F + A + K[i] + w[blk * 16 + g]) >>> 0;
      A = D;
      D = C;
      C = B;
      B = (B + ((F << S[i]) | (F >>> (32 - S[i])))) >>> 0;
    }
    a0 = (a0 + A) >>> 0;
    b0 = (b0 + B) >>> 0;
    c0 = (c0 + C) >>> 0;
    d0 = (d0 + D) >>> 0;
  }
  const out = new Uint8Array(16);
  [a0, b0, c0, d0].forEach((v, k) => {
    for (let j = 0; j < 4; j++) out[k * 4 + j] = (v >>> (8 * j)) & 0xff;
  });
  return bytesToHex(out);
}

export const SHA = ["SHA-1", "SHA-256", "SHA-384", "SHA-512"] as const;
export type Sha = (typeof SHA)[number];

export async function sha(alg: Sha, data: Uint8Array): Promise<string> {
  return bytesToHex(new Uint8Array(await crypto.subtle.digest(alg, data)));
}

export async function hmac(alg: Sha, key: Uint8Array, data: Uint8Array): Promise<string> {
  const k = await crypto.subtle.importKey("raw", key.length ? key : new Uint8Array(1), { name: "HMAC", hash: alg }, false, ["sign"]);
  return bytesToHex(new Uint8Array(await crypto.subtle.sign("HMAC", k, data)));
}
