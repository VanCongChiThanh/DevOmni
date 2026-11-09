import { useEffect, useMemo, useState } from "react";
import { CheckCircle2, ShieldQuestion, XCircle } from "lucide-react";
import { decodeJwt, verifyJwt } from "../lib/jwt";
import { relative } from "../lib/text";
import { Card, CopyButton, Input, Note, Pane, Row, TextArea } from "../ui";

const TIME_CLAIMS: Record<string, string> = { exp: "Expires", iat: "Issued at", nbf: "Not before", auth_time: "Auth time" };

export default function JwtTool() {
  const [token, setToken] = useState("");
  const [key, setKey] = useState("");
  const [verdict, setVerdict] = useState<{ ok?: boolean; error?: string } | null>(null);

  const decoded = useMemo(() => {
    if (!token.trim()) return null;
    try {
      return { jwt: decodeJwt(token) };
    } catch (e) {
      return { error: (e as Error).message };
    }
  }, [token]);

  const jwt = decoded && "jwt" in decoded ? decoded.jwt : null;
  const alg = String(jwt?.header.alg ?? "");
  const isHmac = alg.startsWith("HS");

  useEffect(() => {
    setVerdict(null);
    if (!jwt || !key.trim()) return;
    let live = true;
    verifyJwt(jwt, key)
      .then((ok) => live && setVerdict({ ok }))
      .catch((e) => live && setVerdict({ error: (e as Error).message }));
    return () => {
      live = false;
    };
  }, [jwt, key]);

  const payload = jwt?.payload && typeof jwt.payload === "object" ? (jwt.payload as Record<string, unknown>) : null;
  const now = Date.now();
  const exp = typeof payload?.exp === "number" ? payload.exp * 1000 : null;

  return (
    <div className="flex h-full flex-col gap-3 overflow-y-auto pr-1">
      <Pane label="Token" className="h-28 shrink-0">
        <TextArea value={token} onChange={(e) => setToken(e.target.value)} placeholder="Paste a JWT (eyJhbGciOi…) — “Bearer …” is fine too" />
      </Pane>

      {decoded && "error" in decoded && <Note>{decoded.error}</Note>}

      {jwt && (
        <>
          <div className="flex flex-wrap items-center gap-2 text-[12px]">
            <span className="rounded-md bg-surface-2 px-2 py-0.5 font-mono text-fg">{alg || "no alg"}</span>
            {exp !== null && (
              <span className={`rounded-md px-2 py-0.5 ${exp < now ? "bg-err/10 text-err" : "bg-ok/10 text-ok"}`}>
                {exp < now ? `Expired ${relative(new Date(exp), now)}` : `Valid, expires ${relative(new Date(exp), now)}`}
              </span>
            )}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <Pane label="Header" actions={<CopyButton text={JSON.stringify(jwt.header, null, 2)} />}>
              <pre className="selectable max-h-60 overflow-auto rounded-lg border border-line bg-surface-0 p-3 font-mono text-[12px] text-fg">
                {JSON.stringify(jwt.header, null, 2)}
              </pre>
            </Pane>
            <Pane label="Payload" actions={<CopyButton text={JSON.stringify(jwt.payload, null, 2)} />}>
              <pre className="selectable max-h-60 overflow-auto rounded-lg border border-line bg-surface-0 p-3 font-mono text-[12px] text-fg">
                {JSON.stringify(jwt.payload, null, 2)}
              </pre>
            </Pane>
          </div>

          {payload && Object.keys(TIME_CLAIMS).some((k) => typeof payload[k] === "number") && (
            <Card>
              {Object.entries(TIME_CLAIMS).map(([k, label]) =>
                typeof payload[k] === "number" ? (
                  <Row
                    key={k}
                    label={`${label} (${k})`}
                    value={new Date((payload[k] as number) * 1000).toLocaleString()}
                    hint={relative(new Date((payload[k] as number) * 1000), now)}
                  />
                ) : null,
              )}
            </Card>
          )}

          <Pane label="Verify signature">
            <div className="flex flex-col gap-2">
              {isHmac ? (
                <Input type="text" value={key} onChange={(e) => setKey(e.target.value)} placeholder="Shared secret" />
              ) : (
                <TextArea
                  className="h-24 flex-none"
                  value={key}
                  onChange={(e) => setKey(e.target.value)}
                  placeholder="-----BEGIN PUBLIC KEY-----  (PEM public key)"
                />
              )}
              <div className="flex items-center gap-1.5 text-[12px]">
                {!key.trim() ? (
                  <span className="inline-flex items-center gap-1 text-fg-faint">
                    <ShieldQuestion size={14} /> Not verified — decoding alone doesn't prove the token is genuine
                  </span>
                ) : verdict?.error ? (
                  <span className="text-err">{verdict.error}</span>
                ) : verdict?.ok ? (
                  <span className="inline-flex items-center gap-1 text-ok">
                    <CheckCircle2 size={14} /> Signature valid
                  </span>
                ) : verdict ? (
                  <span className="inline-flex items-center gap-1 text-err">
                    <XCircle size={14} /> Signature invalid
                  </span>
                ) : null}
              </div>
            </div>
          </Pane>
        </>
      )}
    </div>
  );
}
