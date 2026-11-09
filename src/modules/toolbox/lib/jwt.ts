import { base64ToBytes, utf8, utf8Decode } from "./codec";

export interface DecodedJwt {
  header: Record<string, unknown>;
  payload: unknown;
  signature: Uint8Array;
  signingInput: string;
}

function part(s: string, name: string): unknown {
  const text = utf8Decode(base64ToBytes(s));
  if (text === null) throw new Error(`${name} is not valid UTF-8`);
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`${name} is not valid JSON`);
  }
}

export function decodeJwt(token: string): DecodedJwt {
  const t = token.trim().replace(/^Bearer\s+/i, "");
  const parts = t.split(".");
  if (parts.length === 5) throw new Error("This is an encrypted JWT (JWE); its payload can't be read without the key");
  if (parts.length !== 3) throw new Error("A JWT has 3 parts separated by dots (header.payload.signature)");
  const header = part(parts[0], "Header");
  if (!header || typeof header !== "object") throw new Error("Header is not a JSON object");
  return {
    header: header as Record<string, unknown>,
    payload: part(parts[1], "Payload"),
    signature: parts[2] ? base64ToBytes(parts[2]) : new Uint8Array(),
    signingInput: `${parts[0]}.${parts[1]}`,
  };
}

const HASH: Record<string, string> = { "256": "SHA-256", "384": "SHA-384", "512": "SHA-512" };
const CURVE: Record<string, string> = { "256": "P-256", "384": "P-384", "512": "P-521" };

function pemToDer(pem: string): Uint8Array {
  const body = pem.replace(/-----(BEGIN|END)[^-]+-----/g, "").replace(/\s+/g, "");
  if (!body) throw new Error("Paste a PEM public key (-----BEGIN PUBLIC KEY-----)");
  return base64ToBytes(body);
}

/** Verify the signature. HS* takes a shared secret, RS/PS/ES* a PEM public key (SPKI). */
export async function verifyJwt(jwt: DecodedJwt, key: string): Promise<boolean> {
  const alg = String(jwt.header.alg ?? "");
  const m = /^(HS|RS|PS|ES)(256|384|512)$/.exec(alg);
  if (!m) throw new Error(alg === "none" ? "Unsigned token (alg: none)" : `Unsupported algorithm: ${alg || "missing"}`);
  const [, family, bits] = m;
  const hash = HASH[bits];
  const data = utf8(jwt.signingInput);
  if (family === "HS") {
    const k = await crypto.subtle.importKey("raw", utf8(key), { name: "HMAC", hash }, false, ["verify"]);
    return crypto.subtle.verify("HMAC", k, jwt.signature, data);
  }
  const der = pemToDer(key);
  if (family === "RS") {
    const k = await crypto.subtle.importKey("spki", der, { name: "RSASSA-PKCS1-v1_5", hash }, false, ["verify"]);
    return crypto.subtle.verify("RSASSA-PKCS1-v1_5", k, jwt.signature, data);
  }
  if (family === "PS") {
    const k = await crypto.subtle.importKey("spki", der, { name: "RSA-PSS", hash }, false, ["verify"]);
    return crypto.subtle.verify({ name: "RSA-PSS", saltLength: Number(bits) / 8 }, k, jwt.signature, data);
  }
  // ES*: JWT signatures are raw r||s, which is exactly what WebCrypto expects.
  const k = await crypto.subtle.importKey("spki", der, { name: "ECDSA", namedCurve: CURVE[bits] }, false, ["verify"]);
  return crypto.subtle.verify({ name: "ECDSA", hash }, k, jwt.signature, data);
}
