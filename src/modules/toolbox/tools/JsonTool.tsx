import { useDeferredValue, useMemo, useState } from "react";
import { CheckCircle2 } from "lucide-react";
import { formatJson, type Indent } from "../lib/json";
import { Bar, CopyButton, Note, Pane, Segmented, TextArea, Toggle } from "../ui";

const SAMPLE = '{"id": 98765432109876543210, "name": "Gói DATA", "price": 70000, "tags": ["sim", "kit"], "active": true}';

export default function JsonTool() {
  const [input, setInput] = useState("");
  const [indent, setIndent] = useState<Indent>("2");
  const [sort, setSort] = useState(false);
  const deferred = useDeferredValue(input);
  const res = useMemo(() => formatJson(deferred, { indent, sort }), [deferred, indent, sort]);

  return (
    <div className="flex h-full flex-col gap-3">
      <Bar>
        <Segmented
          value={indent}
          onChange={setIndent}
          options={[
            ["2", "2 spaces"],
            ["4", "4 spaces"],
            ["tab", "Tab"],
            ["min", "Minify"],
          ]}
        />
        <Toggle checked={sort} onChange={setSort} label="Sort keys" />
        <div className="ml-auto text-[11.5px]">
          {input.trim() &&
            (res.ok ? (
              <span className="inline-flex items-center gap-1 text-ok">
                <CheckCircle2 size={13} /> Valid JSON · {new Blob([res.text]).size.toLocaleString()} bytes
              </span>
            ) : (
              <span className="text-err">Invalid{res.line ? ` · line ${res.line}, col ${res.col}` : ""}</span>
            ))}
        </div>
      </Bar>

      <div className="grid min-h-0 flex-1 grid-cols-2 gap-3">
        <Pane
          label="Input"
          actions={
            !input && (
              <button className="text-[11px] text-accent hover:underline" onClick={() => setInput(SAMPLE)}>
                Try sample
              </button>
            )
          }
        >
          <TextArea value={input} onChange={(e) => setInput(e.target.value)} placeholder="Paste JSON…" />
        </Pane>
        <Pane label="Output" actions={<CopyButton text={res.ok ? res.text : ""} label="Copy" />}>
          <TextArea readOnly value={res.ok ? res.text : ""} placeholder="Formatted JSON appears here" />
        </Pane>
      </div>

      {!res.ok && <Note>{res.error}</Note>}
      {res.ok && res.lenient && <Note tone="warn">Comments or trailing commas were removed to make this valid JSON.</Note>}
      {res.ok && res.bigNumbers > 0 && (
        <Note tone="info">
          {res.bigNumbers} number{res.bigNumbers > 1 ? "s" : ""} too large for JavaScript (e.g. long IDs) kept exactly, digit for digit.
        </Note>
      )}
    </div>
  );
}
