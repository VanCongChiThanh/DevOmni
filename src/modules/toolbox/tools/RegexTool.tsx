import { Fragment, useEffect, useRef, useState } from "react";
import clsx from "clsx";
import type { RegexRequest, RegexResponse } from "../lib/regex.worker";
import { CopyButton, Input, Note, Pane, TextArea, Toggle } from "../ui";

const FLAGS = [
  ["g", "global"],
  ["i", "ignore case"],
  ["m", "multiline"],
  ["s", "dot all"],
  ["u", "unicode"],
] as const;
const TIMEOUT_MS = 1500;

const spawn = () => new Worker(new URL("../lib/regex.worker.ts", import.meta.url), { type: "module" });

export default function RegexTool() {
  const [pattern, setPattern] = useState("");
  const [flags, setFlags] = useState("gu");
  const [text, setText] = useState("");
  const [replaceOn, setReplaceOn] = useState(false);
  const [replace, setReplace] = useState("");
  const [res, setRes] = useState<RegexResponse | null>(null);
  const [timedOut, setTimedOut] = useState(false);
  const worker = useRef<Worker | null>(null);
  const seq = useRef(0);

  useEffect(() => () => worker.current?.terminate(), []);

  useEffect(() => {
    setTimedOut(false);
    if (!pattern) {
      setRes(null);
      return;
    }
    const id = ++seq.current;
    const t = window.setTimeout(() => {
      worker.current ??= spawn();
      const w = worker.current;
      const kill = window.setTimeout(() => {
        // Runaway backtracking: kill the worker, start fresh next time.
        w.terminate();
        if (worker.current === w) worker.current = null;
        if (seq.current === id) setTimedOut(true);
      }, TIMEOUT_MS);
      w.onmessage = (e: MessageEvent<RegexResponse>) => {
        window.clearTimeout(kill);
        if (e.data.id === seq.current) setRes(e.data);
      };
      w.postMessage({ id, pattern, flags, text, replace: replaceOn ? replace : null } satisfies RegexRequest);
    }, 120);
    return () => window.clearTimeout(t);
  }, [pattern, flags, text, replace, replaceOn]);

  const ok = res && res.ok ? res : null;

  return (
    <div className="flex h-full flex-col gap-3">
      <div className="flex items-center gap-2">
        <div className="flex min-w-0 flex-1 items-center rounded-md border border-line bg-surface-0 font-mono text-[13px] focus-within:border-accent/60">
          <span className="pl-2.5 text-fg-faint">/</span>
          <input
            value={pattern}
            onChange={(e) => setPattern(e.target.value)}
            spellCheck={false}
            placeholder="pattern, e.g. (\d{3})-(\d{4})"
            className="selectable h-9 min-w-0 flex-1 bg-transparent px-1 text-fg outline-none placeholder:text-fg-faint"
            autoFocus
          />
          <span className="pr-2.5 text-fg-faint">/{flags}</span>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        {FLAGS.map(([f, label]) => (
          <Toggle
            key={f}
            checked={flags.includes(f)}
            onChange={(on) => setFlags((cur) => (on ? cur + f : cur.replace(f, "")).split("").sort().join(""))}
            label={`${f} · ${label}`}
          />
        ))}
        <Toggle checked={replaceOn} onChange={setReplaceOn} label="Replace" />
        <span className="ml-auto text-[11.5px] text-fg-muted">
          {ok && `${ok.matches.length}${ok.truncated ? "+" : ""} match${ok.matches.length === 1 ? "" : "es"}`}
        </span>
      </div>
      {replaceOn && <Input value={replace} onChange={(e) => setReplace(e.target.value)} placeholder="Replacement — $1, $<name>, $& work" className="font-mono" />}

      {timedOut && <Note>The pattern took longer than {TIMEOUT_MS / 1000}s (catastrophic backtracking?) and was stopped.</Note>}
      {res && !res.ok && <Note>{res.error}</Note>}

      <div className="grid min-h-0 flex-1 grid-cols-2 gap-3">
        <Pane label="Test text">
          <TextArea value={text} onChange={(e) => setText(e.target.value)} placeholder="Text to search…" />
        </Pane>
        <Pane
          label={replaceOn ? "Result" : "Matches"}
          actions={replaceOn && ok?.replaced != null ? <CopyButton text={ok.replaced} label="Copy" /> : null}
        >
          <div className="selectable min-h-0 flex-1 overflow-auto rounded-lg border border-line bg-surface-0 p-3 font-mono text-[12.5px] leading-relaxed">
            {replaceOn && ok?.replaced != null ? (
              <pre className="whitespace-pre-wrap break-words text-fg">{ok.replaced}</pre>
            ) : (
              <Highlighted text={text} matches={ok?.matches ?? []} />
            )}
          </div>
        </Pane>
      </div>

      {ok && ok.matches.length > 0 && ok.matches.some((m) => m.groups.length) && (
        <div className="max-h-40 shrink-0 overflow-auto rounded-lg border border-line bg-surface-1 text-[12px]">
          <table className="w-full">
            <thead className="sticky top-0 bg-surface-1 text-left text-fg-faint">
              <tr>
                <th className="px-3 py-1.5 font-medium">#</th>
                <th className="px-3 py-1.5 font-medium">Match</th>
                {ok.matches[0].groups.map((_, i) => (
                  <th key={i} className="px-3 py-1.5 font-medium">
                    {ok.matches[0].named ? Object.keys(ok.matches[0].named)[i] ?? `$${i + 1}` : `$${i + 1}`}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="selectable font-mono">
              {ok.matches.slice(0, 200).map((m, i) => (
                <tr key={i} className="border-t border-line/60">
                  <td className="px-3 py-1 text-fg-faint">{i + 1}</td>
                  <td className="px-3 py-1 text-fg">{m.text}</td>
                  {m.groups.map((g, j) => (
                    <td key={j} className={clsx("px-3 py-1", g === undefined ? "text-fg-faint" : "text-fg-muted")}>
                      {g ?? "—"}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function Highlighted({ text, matches }: { text: string; matches: { index: number; end: number }[] }) {
  if (!text) return <span className="text-fg-faint">Matches are highlighted here</span>;
  const parts: JSX.Element[] = [];
  let last = 0;
  matches.slice(0, 2000).forEach((m, i) => {
    if (m.index < last) return;
    parts.push(<Fragment key={`t${i}`}>{text.slice(last, m.index)}</Fragment>);
    parts.push(
      <mark key={`m${i}`} className={clsx("rounded-sm text-fg", i % 2 ? "bg-accent/35" : "bg-warn/40")}>
        {m.end === m.index ? "​" : text.slice(m.index, m.end)}
      </mark>,
    );
    last = m.end;
  });
  parts.push(<Fragment key="end">{text.slice(last)}</Fragment>);
  return <pre className="whitespace-pre-wrap break-words text-fg">{parts}</pre>;
}
