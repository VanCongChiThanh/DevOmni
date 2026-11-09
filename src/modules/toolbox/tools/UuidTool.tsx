import { useCallback, useEffect, useState } from "react";
import { RefreshCw } from "lucide-react";
import { randomString, uuidv7 } from "../lib/text";
import { Bar, CopyButton, Input, Pane, Segmented, TextArea, Toggle } from "../ui";

type Kind = "v4" | "v7" | "random";

const SETS = {
  lower: "abcdefghijklmnopqrstuvwxyz",
  upper: "ABCDEFGHIJKLMNOPQRSTUVWXYZ",
  digits: "0123456789",
  symbols: "!@#$%^&*()-_=+[]{};:,.?",
};
const AMBIGUOUS = /[O0Il1|]/g;

export default function UuidTool() {
  const [kind, setKind] = useState<Kind>("v4");
  const [count, setCount] = useState(5);
  const [upper, setUpper] = useState(false);
  const [hyphens, setHyphens] = useState(true);
  const [length, setLength] = useState(24);
  const [sets, setSets] = useState({ lower: true, upper: true, digits: true, symbols: true });
  const [noAmbiguous, setNoAmbiguous] = useState(true);
  const [out, setOut] = useState("");

  const generate = useCallback(() => {
    const n = Math.min(1000, Math.max(1, count || 1));
    const lines: string[] = [];
    if (kind === "random") {
      let alphabet = Object.entries(sets)
        .filter(([, on]) => on)
        .map(([k]) => SETS[k as keyof typeof SETS])
        .join("");
      if (noAmbiguous) alphabet = alphabet.replace(AMBIGUOUS, "");
      for (let i = 0; i < n; i++) lines.push(randomString(Math.min(512, Math.max(1, length)), alphabet));
    } else {
      for (let i = 0; i < n; i++) {
        let id = kind === "v4" ? crypto.randomUUID() : uuidv7();
        if (!hyphens) id = id.replace(/-/g, "");
        lines.push(upper ? id.toUpperCase() : id);
      }
    }
    setOut(lines.join("\n"));
  }, [kind, count, upper, hyphens, length, sets, noAmbiguous]);

  useEffect(generate, [generate]);

  return (
    <div className="flex h-full flex-col gap-3">
      <Bar>
        <Segmented
          value={kind}
          onChange={setKind}
          options={[
            ["v4", "UUID v4"],
            ["v7", "UUID v7"],
            ["random", "Random string"],
          ]}
        />
        <label className="flex items-center gap-1.5 text-[11.5px] text-fg-muted">
          Count
          <Input type="number" min={1} max={1000} value={count} onChange={(e) => setCount(+e.target.value)} className="h-7 w-16" />
        </label>
        {kind === "random" ? (
          <>
            <label className="flex items-center gap-1.5 text-[11.5px] text-fg-muted">
              Length
              <Input type="number" min={1} max={512} value={length} onChange={(e) => setLength(+e.target.value)} className="h-7 w-16" />
            </label>
            {(Object.keys(SETS) as (keyof typeof SETS)[]).map((k) => (
              <Toggle key={k} checked={sets[k]} onChange={(v) => setSets((s) => ({ ...s, [k]: v }))} label={k === "lower" ? "a-z" : k === "upper" ? "A-Z" : k === "digits" ? "0-9" : "!@#"} />
            ))}
            <Toggle checked={noAmbiguous} onChange={setNoAmbiguous} label="No O0Il1" />
          </>
        ) : (
          <>
            <Toggle checked={upper} onChange={setUpper} label="Uppercase" />
            <Toggle checked={hyphens} onChange={setHyphens} label="Hyphens" />
          </>
        )}
        <button className="btn ml-auto border border-line" onClick={generate}>
          <RefreshCw size={13} /> Generate
        </button>
      </Bar>
      <Pane label={kind === "v7" ? "UUID v7 — time-ordered, good for database keys" : kind === "v4" ? "UUID v4 — random" : "Cryptographically random"} actions={<CopyButton text={out} label="Copy all" />}>
        <TextArea readOnly value={out} />
      </Pane>
    </div>
  );
}
