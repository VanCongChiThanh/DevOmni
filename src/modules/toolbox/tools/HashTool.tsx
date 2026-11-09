import { useEffect, useRef, useState } from "react";
import { FileUp, X } from "lucide-react";
import { utf8 } from "../lib/codec";
import { hmac, md5, sha, SHA } from "../lib/hash";
import { Bar, Card, Input, Pane, Row, TextArea, Toggle } from "../ui";

export default function HashTool() {
  const [text, setText] = useState("");
  const [file, setFile] = useState<{ name: string; bytes: Uint8Array } | null>(null);
  const [key, setKey] = useState("");
  const [upper, setUpper] = useState(false);
  const [hashes, setHashes] = useState<Record<string, string>>({});
  const fileInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let live = true;
    const data = file ? file.bytes : utf8(text);
    if (!file && !text) {
      setHashes({});
      return;
    }
    const k = utf8(key);
    void (async () => {
      const out: Record<string, string> = {};
      out.MD5 = key ? "" : md5(data);
      for (const alg of SHA) out[alg] = key ? await hmac(alg, k, data) : await sha(alg, data);
      if (live) setHashes(out);
    })();
    return () => {
      live = false;
    };
  }, [text, file, key]);

  const fmt = (h: string) => (upper ? h.toUpperCase() : h);

  return (
    <div className="flex h-full flex-col gap-3">
      <Bar>
        <button className="btn border border-line" onClick={() => fileInput.current?.click()}>
          <FileUp size={13} /> Hash a file…
        </button>
        <input
          ref={fileInput}
          type="file"
          className="hidden"
          onChange={async (e) => {
            const f = e.target.files?.[0];
            if (f) setFile({ name: f.name, bytes: new Uint8Array(await f.arrayBuffer()) });
            e.target.value = "";
          }}
        />
        <Input value={key} onChange={(e) => setKey(e.target.value)} placeholder="HMAC key (optional)" className="w-56" />
        <Toggle checked={upper} onChange={setUpper} label="Uppercase" />
      </Bar>

      <Pane label={file ? "File" : "Text"} className="h-40 shrink-0">
        {file ? (
          <div className="flex flex-1 items-center gap-2 rounded-lg border border-line bg-surface-0 px-3 text-[12.5px]">
            <span className="truncate font-medium text-fg">{file.name}</span>
            <span className="text-fg-faint">{file.bytes.length.toLocaleString()} bytes</span>
            <button className="ml-auto text-fg-faint hover:text-fg" onClick={() => setFile(null)} aria-label="Remove file">
              <X size={14} />
            </button>
          </div>
        ) : (
          <TextArea value={text} onChange={(e) => setText(e.target.value)} placeholder="Text to hash (UTF-8)…" />
        )}
      </Pane>

      <Card>
        <Row label="MD5" value={hashes.MD5 ? fmt(hashes.MD5) : ""} hint={key ? "HMAC-MD5 not supported" : undefined} />
        {SHA.map((alg) => (
          <Row key={alg} label={key ? `HMAC-${alg}` : alg} value={hashes[alg] ? fmt(hashes[alg]) : ""} />
        ))}
      </Card>
    </div>
  );
}
