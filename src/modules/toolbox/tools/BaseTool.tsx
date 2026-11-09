import { useMemo, useState } from "react";
import { formatBase, parseBigInt, type Base } from "../lib/text";
import { Bar, Card, Input, Note, Row, Segmented, Toggle } from "../ui";

export default function BaseTool() {
  const [input, setInput] = useState("");
  const [base, setBase] = useState<"auto" | "2" | "8" | "10" | "16">("auto");
  const [group, setGroup] = useState(true);

  const res = useMemo(() => {
    if (!input.trim()) return null;
    try {
      return { v: parseBigInt(input, base === "auto" ? null : (Number(base) as Base)) };
    } catch (e) {
      return { error: (e as Error).message };
    }
  }, [input, base]);
  const v: bigint | null = res && "v" in res && res.v !== undefined ? res.v : null;

  return (
    <div className="flex h-full flex-col gap-3">
      <Bar>
        <Segmented
          value={base}
          onChange={setBase}
          options={[
            ["auto", "Auto"],
            ["10", "Dec"],
            ["16", "Hex"],
            ["8", "Oct"],
            ["2", "Bin"],
          ]}
        />
        <Toggle checked={group} onChange={setGroup} label="Group digits" />
      </Bar>
      <Input
        value={input}
        onChange={(e) => setInput(e.target.value)}
        placeholder="255 · 0xFF · 0b1111_1111 · 0o377 — any size"
        className="h-9 font-mono"
        autoFocus
      />
      {res && "error" in res && <Note>{res.error}</Note>}
      {v !== null && (
        <Card>
          <Row label="Decimal" value={formatBase(v, 10, group)} />
          <Row label="Hexadecimal" value={formatBase(v, 16, group)} />
          <Row label="Octal" value={formatBase(v, 8, group)} />
          <Row label="Binary" value={formatBase(v, 2, group)} hint={`${v < 0n ? (-v).toString(2).length : v.toString(2).length} bits`} />
        </Card>
      )}
    </div>
  );
}
