import { useMemo, useState } from "react";
import { CASES } from "../lib/text";
import { Card, Pane, Row, TextArea } from "../ui";

export default function CaseTool() {
  const [input, setInput] = useState("");
  // Each line converts separately, so a list of column names converts in one go.
  const lines = useMemo(() => input.split(/\r?\n/), [input]);

  return (
    <div className="flex h-full flex-col gap-3 overflow-y-auto pr-1">
      <Pane label="Text — one item per line" className="h-36 shrink-0">
        <TextArea value={input} onChange={(e) => setInput(e.target.value)} placeholder={"Tên sản phẩm\nMOBILE_PACKAGE_ID\nxmlHttpRequest"} />
      </Pane>
      <Card>
        {CASES.map((c) => (
          <Row key={c.id} label={c.label} value={input ? lines.map(c.fn).join("\n") : ""} />
        ))}
      </Card>
    </div>
  );
}
