import { useMemo, useState } from "react";
import { ArrowLeftRight } from "lucide-react";
import {
  base64ToBytes,
  bytesToBase64,
  bytesToHex,
  hexToBytes,
  htmlDecode,
  htmlEncode,
  imageMime,
  utf8,
  utf8Decode,
} from "../lib/codec";
import { Bar, CopyButton, Note, Pane, Segmented, TextArea } from "../ui";

type Mode = "b64" | "b64url" | "url" | "html" | "hex";
type Dir = "encode" | "decode";

type Out = { text: string } | { binary: Uint8Array } | { error: string };

function run(mode: Mode, dir: Dir, input: string): Out {
  if (!input) return { text: "" };
  try {
    if (dir === "encode") {
      switch (mode) {
        case "b64":
          return { text: bytesToBase64(utf8(input)) };
        case "b64url":
          return { text: bytesToBase64(utf8(input), true) };
        case "url":
          return { text: encodeURIComponent(input) };
        case "html":
          return { text: htmlEncode(input) };
        case "hex":
          return { text: bytesToHex(utf8(input), " ") };
      }
    }
    if (mode === "url") return { text: decodeURIComponent(input.replace(/\+/g, " ")) };
    if (mode === "html") return { text: htmlDecode(input) };
    const bytes = mode === "hex" ? hexToBytes(input) : base64ToBytes(input);
    const text = utf8Decode(bytes);
    return text === null ? { binary: bytes } : { text };
  } catch (e) {
    return { error: e instanceof URIError ? "Malformed URL encoding (a % not followed by two hex digits)" : (e as Error).message };
  }
}

export default function EncodeTool() {
  const [mode, setMode] = useState<Mode>("b64");
  const [dir, setDir] = useState<Dir>("encode");
  const [input, setInput] = useState("");
  const out = useMemo(() => run(mode, dir, input), [mode, dir, input]);
  const text = "text" in out ? out.text : "";

  const swap = () => {
    if ("text" in out) setInput(out.text);
    setDir((d) => (d === "encode" ? "decode" : "encode"));
  };

  const binary = "binary" in out ? out.binary : null;
  const mime = binary ? imageMime(binary) : null;

  return (
    <div className="flex h-full flex-col gap-3">
      <Bar>
        <Segmented
          value={mode}
          onChange={setMode}
          options={[
            ["b64", "Base64"],
            ["b64url", "Base64URL"],
            ["url", "URL"],
            ["html", "HTML"],
            ["hex", "Hex"],
          ]}
        />
        <Segmented
          value={dir}
          onChange={setDir}
          options={[
            ["encode", "Encode"],
            ["decode", "Decode"],
          ]}
        />
        <button className="btn border border-line" onClick={swap} title="Use the output as input and flip direction">
          <ArrowLeftRight size={13} /> Swap
        </button>
      </Bar>

      <div className="grid min-h-0 flex-1 grid-cols-2 gap-3">
        <Pane label={dir === "encode" ? "Text" : "Encoded"}>
          <TextArea value={input} onChange={(e) => setInput(e.target.value)} placeholder={dir === "encode" ? "Text to encode…" : "Paste encoded data…"} />
        </Pane>
        <Pane label={dir === "encode" ? "Encoded" : "Text"} actions={<CopyButton text={text} label="Copy" />}>
          {binary ? (
            <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-auto rounded-lg border border-line bg-surface-0 p-3">
              <div className="text-[12px] text-fg-muted">
                Binary data · {binary.length.toLocaleString()} bytes{mime ? ` · ${mime}` : ""}
              </div>
              {mime && (
                <img
                  src={`data:${mime};base64,${bytesToBase64(binary)}`}
                  alt="Decoded"
                  className="max-h-72 max-w-full self-start rounded border border-line object-contain"
                />
              )}
              <pre className="selectable whitespace-pre-wrap break-all font-mono text-[11.5px] text-fg-faint">
                {bytesToHex(binary.subarray(0, 512), " ")}
                {binary.length > 512 ? " …" : ""}
              </pre>
            </div>
          ) : (
            <TextArea readOnly value={text} />
          )}
        </Pane>
      </div>
      {"error" in out && <Note>{out.error}</Note>}
    </div>
  );
}
