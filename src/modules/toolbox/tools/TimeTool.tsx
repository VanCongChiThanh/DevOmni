import { useEffect, useMemo, useState } from "react";
import { isoLocal, localStamp, parseTime, relative } from "../lib/text";
import { Card, CopyButton, Input, Note, Pane, Row } from "../ui";

const p2 = (n: number) => String(n).padStart(2, "0");

export default function TimeTool() {
  const [input, setInput] = useState("");
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(t);
  }, []);

  const parsed = useMemo(() => {
    if (!input.trim()) return null;
    try {
      return { date: parseTime(input) };
    } catch (e) {
      return { error: (e as Error).message };
    }
  }, [input]);
  const d = parsed && "date" in parsed ? parsed.date : null;
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const utcStamp = d
    ? `${d.getUTCFullYear()}-${p2(d.getUTCMonth() + 1)}-${p2(d.getUTCDate())} ${p2(d.getUTCHours())}:${p2(d.getUTCMinutes())}:${p2(d.getUTCSeconds())}`
    : "";

  return (
    <div className="flex h-full flex-col gap-3 overflow-y-auto pr-1">
      <div className="flex items-center gap-4 rounded-lg border border-line bg-surface-1 px-4 py-3">
        <div>
          <div className="text-[11px] uppercase tracking-wide text-fg-faint">Now (Unix)</div>
          <div className="selectable font-mono text-lg font-semibold tabular-nums text-fg">{Math.floor(now / 1000)}</div>
        </div>
        <CopyButton text={String(Math.floor(now / 1000))} />
        <div className="ml-4 text-[12px] text-fg-muted">
          <div className="selectable font-mono tabular-nums">{now} ms</div>
          <div>{localStamp(new Date(now))}</div>
        </div>
        <button className="btn ml-auto border border-line" onClick={() => setInput(String(Math.floor(now / 1000)))}>
          Use now
        </button>
      </div>

      <Pane label="Timestamp or date">
        <Input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="1731139200 · 1731139200123 · 2026-11-09 10:00 · 2026-11-09T03:00:00Z"
          className="h-9 font-mono"
          autoFocus
        />
      </Pane>

      {parsed && "error" in parsed && <Note>{parsed.error}</Note>}

      {d && (
        <Card>
          <Row label="Unix seconds" value={String(Math.floor(d.getTime() / 1000))} />
          <Row label="Unix milliseconds" value={String(d.getTime())} />
          <Row label={`Local (${tz})`} value={localStamp(d)} hint={relative(d, now)} />
          <Row label="UTC" value={utcStamp} />
          <Row label="ISO 8601 (local)" value={isoLocal(d)} />
          <Row label="ISO 8601 (UTC)" value={d.toISOString()} />
          <Row label="RFC 2822" value={d.toUTCString()} />
          <Row label="Oracle" value={`TO_TIMESTAMP('${localStamp(d)}', 'YYYY-MM-DD HH24:MI:SS')`} />
          <Row label="Day" value={d.toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long", year: "numeric" })} />
        </Card>
      )}
    </div>
  );
}
