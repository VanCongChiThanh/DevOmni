import { useId, useRef, useState, type PointerEvent, type ReactNode } from "react";
import clsx from "clsx";
import * as Switch from "@radix-ui/react-switch";
import { formatterLabel, type FormatSettings } from "@/lib/format";
import { effectiveLanguage, PANEL_DEFAULT_W, PANEL_MAX_W, PANEL_MIN_W, useCompareStore, type PRESETS } from "../store";

/** Dragging the panel narrower than this hides it (like VS Code's sidebar). */
const COLLAPSE_AT = 160;
import type { DiffAlgorithm, NormalizeOptions } from "../types";

export function NormalizePanel() {
  const options = useCompareStore((s) => s.options);
  const setOption = useCompareStore((s) => s.setOption);
  const applyPreset = useCompareStore((s) => s.applyPreset);
  const algorithm = useCompareStore((s) => s.algorithm);
  const setAlgorithm = useCompareStore((s) => s.setAlgorithm);
  const language = useCompareStore(effectiveLanguage) ?? "plain";
  const format = useCompareStore((s) => s.format);
  const setFormat = useCompareStore((s) => s.setFormat);
  const engine = formatterLabel(language);
  const isSql = language === "sql" || language === "plsql";

  const bool = (key: keyof NormalizeOptions) => ({
    checked: !!options[key],
    onChange: (v: boolean) => setOption(key, v as never),
  });
  const wsDisabled = options.ignoreAllWhitespace;

  // Width follows the pointer locally while dragging; the store (and storage)
  // is only written once on release.
  const storedWidth = useCompareStore((s) => s.panelWidth);
  const setPanelWidth = useCompareStore((s) => s.setPanelWidth);
  const setPanelOpen = useCompareStore((s) => s.setPanelOpen);
  const [dragW, setDragW] = useState<number | null>(null);
  const drag = useRef<{ x: number; w: number } | null>(null);
  const width = dragW ?? storedWidth;

  const onDown = (e: PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { x: e.clientX, w: storedWidth };
    setDragW(storedWidth);
  };
  const onMove = (e: PointerEvent<HTMLDivElement>) => {
    if (!drag.current) return;
    const raw = drag.current.w + (drag.current.x - e.clientX);
    setDragW(raw < COLLAPSE_AT ? raw : Math.min(PANEL_MAX_W, Math.max(PANEL_MIN_W, raw)));
  };
  const onUp = () => {
    if (!drag.current) return;
    drag.current = null;
    const w = dragW ?? storedWidth;
    setDragW(null);
    if (w < COLLAPSE_AT) setPanelOpen(false);
    else setPanelWidth(w);
  };

  const collapsing = dragW !== null && dragW < COLLAPSE_AT;

  return (
    <aside
      className={clsx(
        "relative flex shrink-0 flex-col border-l border-line bg-surface-1 transition-opacity",
        collapsing && "opacity-40",
      )}
      style={{ width: Math.max(width, PANEL_MIN_W) }}
    >
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize compare options"
        title="Drag to resize · double-click to reset · drag to the edge to hide"
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={onUp}
        onDoubleClick={() => setPanelWidth(PANEL_DEFAULT_W)}
        className={clsx(
          "absolute -left-[3px] top-0 z-10 h-full w-[6px] cursor-col-resize transition-colors hover:bg-accent/40",
          dragW !== null && "bg-accent/60",
        )}
      />
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
      <div className="border-b border-line px-4 py-3">
        <div className="text-xs font-semibold uppercase tracking-wide text-fg-muted">Compare options</div>
        <div className="mt-0.5 text-[11px] text-fg-faint">Default is exact. These only change what counts as a difference, never your text.</div>
        <div className="mt-2.5 flex gap-1">
          {(
            [
              ["exact", "Exact"],
              ["whitespace", "No whitespace"],
              ["semantic", "Semantic"],
            ] as [keyof typeof PRESETS, string][]
          ).map(([id, label]) => (
            <button key={id} className="btn h-6 flex-auto justify-center whitespace-nowrap border border-line px-2 text-[11px]" onClick={() => applyPreset(id)}>
              {label}
            </button>
          ))}
        </div>
      </div>

      <Section title="Whitespace">
        <Toggle label="Trim trailing whitespace" disabled={wsDisabled} {...bool("trimTrailingWhitespace")} />
        <Toggle label="Ignore indentation" disabled={wsDisabled} {...bool("ignoreIndentation")} />
        <Toggle label="Collapse inner whitespace" hint="a   =  b  ≡  a = b" disabled={wsDisabled} {...bool("collapseWhitespace")} />
        <Toggle label="Ignore all whitespace" {...bool("ignoreAllWhitespace")} />
        <Toggle
          label="Tabs → spaces"
          hint="Expand tabs before comparing"
          checked={options.tabWidth !== null}
          onChange={(v) => setOption("tabWidth", v ? 4 : null)}
        >
          {options.tabWidth !== null && (
            <select className="select ml-2 h-6" value={options.tabWidth} onChange={(e) => setOption("tabWidth", Number(e.target.value))}>
              {[2, 4, 8].map((w) => (
                <option key={w} value={w}>
                  {w}
                </option>
              ))}
            </select>
          )}
        </Toggle>
        <Toggle label="Ignore blank lines" {...bool("ignoreBlankLines")} />
      </Section>

      <Section title="Syntax">
        <Toggle label="Ignore comments" hint={`Language-aware (${language})`} {...bool("stripComments")} />
        <Toggle label="Ignore case" {...bool("ignoreCase")} />
      </Section>

      <Section title="Format">
        <div className="mb-2 rounded-md bg-surface-2 px-2.5 py-2 text-[11px] leading-snug">
          <span className="text-fg-faint">Formatter for </span>
          <span className="font-medium text-fg">{language}</span>
          <span className="text-fg-faint">: </span>
          <span className={engine ? "text-accent" : "text-amber-400"}>{engine ?? "not available yet"}</span>
          <div className="mt-1 text-fg-faint">Built in, nothing to install. Used by Auto-format and the Format buttons.</div>
        </div>
        <Field label="Indent">
          <select
            className="select h-6"
            value={format.useTabs ? "tab" : format.indent}
            onChange={(e) =>
              e.target.value === "tab"
                ? setFormat("useTabs", true)
                : (setFormat("useTabs", false), setFormat("indent", Number(e.target.value) as FormatSettings["indent"]))
            }
          >
            <option value={2}>2 spaces</option>
            <option value={4}>4 spaces</option>
            <option value="tab">Tabs</option>
          </select>
        </Field>
        <Field label="Line width">
          <select className="select h-6" value={format.printWidth} onChange={(e) => setFormat("printWidth", Number(e.target.value) as FormatSettings["printWidth"])}>
            {[80, 100, 120].map((w) => (
              <option key={w} value={w}>
                {w}
              </option>
            ))}
          </select>
        </Field>
        <Toggle
          label="Sort JSON keys"
          hint={language === "json" ? "When formatting JSON" : "JSON only"}
          checked={format.sortJsonKeys}
          onChange={(v) => setFormat("sortJsonKeys", v)}
        />
        <Field label="SQL keywords" hint={isSql ? undefined : "SQL / PL/SQL only"}>
          <select className="select h-6" value={format.keywordCase} onChange={(e) => setFormat("keywordCase", e.target.value as FormatSettings["keywordCase"])}>
            <option value="upper">UPPER</option>
            <option value="lower">lower</option>
            <option value="preserve">Keep as is</option>
          </select>
        </Field>
      </Section>

      <Section title="Engine">
        <select className="select w-full" value={algorithm} onChange={(e) => setAlgorithm(e.target.value as DiffAlgorithm)}>
          <option value="myers">Myers (minimal diff)</option>
          <option value="patience">Patience (better for moved blocks)</option>
        </select>
      </Section>
      </div>
    </aside>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 py-1">
      <div className="min-w-0">
        <div className="text-xs text-fg">{label}</div>
        {hint && <div className="text-[11px] text-fg-faint">{hint}</div>}
      </div>
      {children}
    </div>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="border-b border-line px-4 py-3">
      <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-fg-faint">{title}</div>
      {children}
    </section>
  );
}

function Toggle({
  label,
  hint,
  checked,
  onChange,
  disabled,
  children,
}: {
  label: string;
  hint?: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
  children?: ReactNode;
}) {
  const id = useId();
  return (
    <div className={`flex items-center gap-3 py-1.5 ${disabled ? "opacity-40" : ""}`}>
      <label htmlFor={id} className="min-w-0 flex-1 cursor-pointer">
        <div className="text-xs text-fg">{label}</div>
        {hint && <div className="truncate text-[11px] text-fg-faint">{hint}</div>}
      </label>
      {children}
      <Switch.Root
        id={id}
        checked={checked}
        onCheckedChange={onChange}
        disabled={disabled}
        className="relative h-4 w-7 shrink-0 rounded-full bg-surface-3 outline-none transition-colors focus-visible:ring-2 focus-visible:ring-accent/50 data-[state=checked]:bg-accent"
      >
        <Switch.Thumb className="block h-3 w-3 translate-x-0.5 rounded-full bg-white shadow transition-transform data-[state=checked]:translate-x-[14px]" />
      </Switch.Root>
    </div>
  );
}
