import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import clsx from "clsx";
import {
  CheckCircle2,
  ExternalLink,
  KeyRound,
  Loader2,
  RotateCcw,
  ScanText,
  Sparkles,
  X,
  XCircle,
} from "lucide-react";
import { errorMessage } from "@/lib/tauri";
import { useTheme } from "@/lib/theme";
import { loadJSON, saveJSON } from "@/lib/storage";
import {
  aiClearKey,
  aiModels,
  aiOcrPage,
  aiSetKey,
  aiStatus,
  fileName,
  openAiStudio,
  openDocument,
  previewDocument,
  readMarkdown,
  updateMarkdown,
  type AiModel,
} from "./api";
import { renderForOcr, renderThumb, replacePages, type PdfDoc } from "./pdf";

// ── Modal shell ─────────────────────────────────────────────────────────────

export function Modal({
  title,
  subtitle,
  onClose,
  children,
  footer,
  actions,
  size = "lg",
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  actions?: ReactNode;
  size?: "md" | "lg";
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-6 backdrop-blur-[2px]" onMouseDown={onClose}>
      <div
        role="dialog"
        aria-modal
        onMouseDown={(e) => e.stopPropagation()}
        className={clsx(
          "flex max-h-full w-full flex-col overflow-hidden rounded-xl border border-line bg-surface-1 shadow-2xl",
          size === "lg" ? "h-full max-w-6xl" : "max-w-lg",
        )}
      >
        <header className="flex shrink-0 items-center gap-3 border-b border-line px-4 py-3">
          <div className="min-w-0">
            <div className="truncate text-[13.5px] font-semibold text-fg">{title}</div>
            {subtitle && <div className="truncate text-[11.5px] text-fg-faint">{subtitle}</div>}
          </div>
          <div className="ml-auto flex items-center gap-1">{actions}</div>
          <button onClick={onClose} className="flex h-7 w-7 items-center justify-center rounded-md text-fg-faint hover:bg-surface-3 hover:text-fg" aria-label="Close">
            <X size={16} />
          </button>
        </header>
        <div className="min-h-0 flex-1 overflow-hidden">{children}</div>
        {footer && <footer className="shrink-0 border-t border-line px-4 py-3">{footer}</footer>}
      </div>
    </div>
  );
}

function Seg<T extends string>({ value, onChange, options }: { value: T; onChange: (v: T) => void; options: [T, string][] }) {
  return (
    <div className="inline-flex h-7 items-center rounded-md border border-line bg-surface-2 p-0.5">
      {options.map(([id, label]) => (
        <button
          key={id}
          onClick={() => onChange(id)}
          className={clsx(
            "h-full rounded px-2.5 text-[11.5px] font-medium",
            value === id ? "bg-surface-0 text-fg shadow-sm" : "text-fg-muted hover:text-fg",
          )}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

// ── Preview ─────────────────────────────────────────────────────────────────

const previewCss = (dark: boolean) => `
:root { color-scheme: ${dark ? "dark" : "light"}; }
body { margin: 0; padding: 32px 40px 64px; background: ${dark ? "#111418" : "#fff"}; color: ${dark ? "#dee2e8" : "#1b1f24"};
  font: 14.5px/1.65 "Segoe UI", Inter, system-ui, sans-serif; }
body > * { max-width: 880px; margin-left: auto; margin-right: auto; }
h1, h2, h3, h4 { line-height: 1.3; margin: 1.6em auto .6em; }
h1 { font-size: 1.75em; border-bottom: 1px solid ${dark ? "#2c323c" : "#e3e6ea"}; padding-bottom: .3em; }
h2 { font-size: 1.4em; } h3 { font-size: 1.15em; }
a { color: ${dark ? "#7ea2ff" : "#2f5fe0"}; }
img { max-width: 100%; height: auto; border-radius: 4px; }
table { border-collapse: collapse; display: block; overflow-x: auto; max-width: 100%; margin: 1em auto; font-size: 13px; }
th, td { border: 1px solid ${dark ? "#2c323c" : "#d7dbe0"}; padding: 6px 10px; vertical-align: top; text-align: left; }
th { background: ${dark ? "#1a1e24" : "#f5f6f8"}; }
code { font: 12.5px "JetBrains Mono", Consolas, monospace; background: ${dark ? "#1d2229" : "#f2f3f5"}; padding: .1em .35em; border-radius: 4px; }
pre { background: ${dark ? "#1d2229" : "#f5f6f8"}; padding: 12px 14px; border-radius: 8px; overflow: auto; }
pre code { background: none; padding: 0; }
blockquote { margin-left: 0; padding-left: 1em; border-left: 3px solid ${dark ? "#2c323c" : "#d7dbe0"}; color: ${dark ? "#9aa3ae" : "#5b6470"}; }
hr { border: 0; border-top: 1px solid ${dark ? "#2c323c" : "#e3e6ea"}; }
`;

export function PreviewDialog({
  path,
  pdfSource,
  onClose,
  onOcr,
  version,
}: {
  path: string;
  /** Set when this Markdown came from a PDF: offers AI OCR. */
  pdfSource?: string;
  onClose: () => void;
  onOcr?: () => void;
  /** Bump to reload after the file changed (e.g. OCR). */
  version: number;
}) {
  const dark = useTheme((t) => t.theme === "dark");
  const [mode, setMode] = useState<"rendered" | "source">("rendered");
  const [html, setHtml] = useState<string | null>(null);
  const [source, setSource] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const md = /\.(md|markdown)$/i.test(path);

  useEffect(() => {
    setError(null);
    setHtml(null);
    previewDocument(path)
      .then(setHtml)
      .catch((e) => setError(errorMessage(e)));
    if (md) readMarkdown(path).then(setSource).catch(() => setSource(null));
  }, [path, version, md]);

  const srcDoc = useMemo(
    () => (html ? html.replace("</head>", `<style>${previewCss(dark)}</style></head>`) : ""),
    [html, dark],
  );

  return (
    <Modal
      title={fileName(path)}
      subtitle={pdfSource ? `From ${fileName(pdfSource)} · text layer` : "Preview"}
      onClose={onClose}
      actions={
        <>
          {md && (
            <Seg
              value={mode}
              onChange={setMode}
              options={[
                ["rendered", "Preview"],
                ["source", "Markdown"],
              ]}
            />
          )}
          <button className="btn" onClick={() => void openDocument(path)} title="Open in default app">
            <ExternalLink size={13} /> Open
          </button>
        </>
      }
      footer={
        pdfSource && onOcr ? (
          <div className="flex items-center gap-3">
            <ScanText size={16} className="shrink-0 text-fg-faint" />
            <div className="min-w-0 flex-1 text-[12px] text-fg-muted">
              Read from the PDF's text layer. Text garbled, missing, or a scanned document?
            </div>
            <button
              onClick={onOcr}
              className="inline-flex h-8 items-center gap-1.5 rounded-md bg-accent px-3 text-[12.5px] font-medium text-white hover:bg-accent/90"
            >
              <Sparkles size={14} /> Fix pages with AI OCR…
            </button>
          </div>
        ) : undefined
      }
    >
      {error ? (
        <div className="p-6 text-[12.5px] text-err">{error}</div>
      ) : mode === "source" && md ? (
        <pre className="selectable h-full overflow-auto whitespace-pre-wrap break-words bg-surface-0 p-5 font-mono text-[12.5px] leading-relaxed text-fg">
          {source ?? "…"}
        </pre>
      ) : html === null ? (
        <div className="flex h-full items-center justify-center text-fg-faint">
          <Loader2 size={18} className="animate-spin" />
        </div>
      ) : (
        <iframe title="Preview" sandbox="" srcDoc={srcDoc} className="h-full w-full border-0 bg-surface-0" />
      )}
    </Modal>
  );
}

// ── AI key setup ────────────────────────────────────────────────────────────

export function AiSetup({ onReady }: { onReady: (models: AiModel[]) => void }) {
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = () => {
    setBusy(true);
    setError(null);
    aiSetKey(key)
      .then((models) => {
        setKey("");
        onReady(models);
      })
      .catch((e) => setError(errorMessage(e)))
      .finally(() => setBusy(false));
  };

  return (
    <div className="mx-auto flex max-w-md flex-col gap-4 py-2">
      <div className="flex items-center gap-2 text-[14px] font-semibold text-fg">
        <Sparkles size={16} className="text-accent" /> Connect Google Gemini (free)
      </div>
      <ol className="flex flex-col gap-3 text-[12.5px] text-fg-muted">
        <li className="flex gap-3">
          <Step n={1} />
          <div className="flex-1">
            Sign in with your Google account and create a free API key.
            <button className="btn mt-1.5 border border-line" onClick={() => void openAiStudio()}>
              <ExternalLink size={13} /> Open Google AI Studio
            </button>
          </div>
        </li>
        <li className="flex gap-3">
          <Step n={2} />
          <div className="flex flex-1 flex-col gap-1.5">
            Paste the key here:
            <div className="flex gap-1.5">
              <input
                type="password"
                value={key}
                onChange={(e) => setKey(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && key.trim() && save()}
                placeholder="AIza…"
                spellCheck={false}
                className="selectable h-8 min-w-0 flex-1 rounded-md border border-line bg-surface-0 px-2.5 font-mono text-[12.5px] text-fg outline-none focus:border-accent/60"
                autoFocus
              />
              <button
                disabled={!key.trim() || busy}
                onClick={save}
                className="inline-flex h-8 items-center gap-1.5 rounded-md bg-accent px-3 text-[12.5px] font-medium text-white hover:bg-accent/90 disabled:opacity-40"
              >
                {busy ? <Loader2 size={13} className="animate-spin" /> : <KeyRound size={13} />} Connect
              </button>
            </div>
            {error && <div className="text-[12px] text-err">{error}</div>}
          </div>
        </li>
      </ol>
      <p className="rounded-md bg-surface-2 px-3 py-2 text-[11.5px] leading-relaxed text-fg-faint">
        The key is checked, then stored in your system's credential manager — never in the app's files. Only the pages
        you select are sent to Google for OCR.
      </p>
    </div>
  );
}

const Step = ({ n }: { n: number }) => (
  <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-accent/15 text-[11px] font-semibold text-accent">{n}</span>
);

// ── OCR page picker ─────────────────────────────────────────────────────────

type PageState = "idle" | "queued" | "running" | "done" | "error";
const MODEL_KEY = "devomni.convert.aiModel";

/** "1-3, 5, 8-" → page numbers within 1..max */
function parseRange(s: string, max: number): number[] {
  const out = new Set<number>();
  for (const part of s.split(/[,;\s]+/).filter(Boolean)) {
    const m = /^(\d+)?\s*-\s*(\d+)?$/.exec(part);
    if (m) {
      const a = Math.max(1, Number(m[1] ?? 1));
      const b = Math.min(max, Number(m[2] ?? max));
      for (let i = a; i <= b; i++) out.add(i);
    } else if (/^\d+$/.test(part) && +part >= 1 && +part <= max) out.add(+part);
  }
  return [...out].sort((a, b) => a - b);
}

export function OcrDialog({
  doc,
  pdfPath,
  mdPath,
  suggested,
  onClose,
  onDone,
}: {
  doc: PdfDoc;
  pdfPath: string;
  mdPath: string;
  /** Pages to preselect (no text layer). */
  suggested: number[];
  onClose: () => void;
  onDone: () => void;
}) {
  const total = doc.numPages;
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [models, setModels] = useState<AiModel[]>([]);
  const [model, setModel] = useState(() => loadJSON<{ id: string }>(MODEL_KEY, { id: "" }).id);
  const [selected, setSelected] = useState<Set<number>>(() => new Set(suggested.length ? suggested : total === 1 ? [1] : []));
  const [range, setRange] = useState("");
  const [states, setStates] = useState<Map<number, PageState>>(new Map());
  const [errors, setErrors] = useState<Map<number, string>>(new Map());
  const [running, setRunning] = useState(false);
  const [finished, setFinished] = useState(false);
  const cancel = useRef(false);
  const anchor = useRef<number | null>(null);

  const useModels = useCallback((list: AiModel[]) => {
    setModels(list);
    setConfigured(true);
    setModel((cur) => (list.some((m) => m.id === cur) ? cur : list[0]?.id ?? ""));
  }, []);

  useEffect(() => {
    aiStatus()
      .then(({ configured }) => {
        setConfigured(configured);
        if (configured) aiModels().then(useModels).catch(() => setModels([]));
      })
      .catch(() => setConfigured(false));
  }, [useModels]);

  useEffect(() => saveJSON(MODEL_KEY, { id: model }), [model]);

  const toggle = (n: number, shift: boolean) => {
    if (running) return;
    setSelected((cur) => {
      const next = new Set(cur);
      if (shift && anchor.current !== null) {
        const [a, b] = [Math.min(anchor.current, n), Math.max(anchor.current, n)];
        const on = !cur.has(n);
        for (let i = a; i <= b; i++) on ? next.add(i) : next.delete(i);
      } else {
        next.has(n) ? next.delete(n) : next.add(n);
      }
      anchor.current = n;
      return next;
    });
  };

  const run = async (pages: number[]) => {
    cancel.current = false;
    setRunning(true);
    setFinished(false);
    setErrors(new Map());
    setStates(new Map(pages.map((p) => [p, "queued" as PageState])));
    const results = new Map<number, string>();
    for (const p of pages) {
      if (cancel.current) break;
      setStates((s) => new Map(s).set(p, "running"));
      try {
        const img = await renderForOcr(doc, p);
        results.set(p, await aiOcrPage(img.data, img.mime, model));
        setStates((s) => new Map(s).set(p, "done"));
      } catch (e) {
        setErrors((m) => new Map(m).set(p, errorMessage(e)));
        setStates((s) => new Map(s).set(p, "error"));
      }
    }
    if (results.size) {
      // Merge into the current file (re-read: it's the source of truth).
      const current = await readMarkdown(mdPath);
      await updateMarkdown(mdPath, replacePages(current, results));
      onDone();
    }
    setRunning(false);
    setFinished(true);
  };

  const pages = [...selected].sort((a, b) => a - b);
  const doneCount = [...states.values()].filter((s) => s === "done").length;
  const failed = [...states.entries()].filter(([, s]) => s === "error").map(([p]) => p);

  if (configured === false) {
    return (
      <Modal title="AI OCR" subtitle={fileName(pdfPath)} onClose={onClose} size="md">
        <div className="overflow-y-auto p-5">
          <AiSetup onReady={useModels} />
        </div>
      </Modal>
    );
  }

  return (
    <Modal
      title="AI OCR — choose pages"
      subtitle={`${fileName(pdfPath)} · ${total} page${total > 1 ? "s" : ""}`}
      onClose={() => {
        cancel.current = true;
        onClose();
      }}
      actions={
        configured && (
          <label className="flex items-center gap-1.5 text-[11.5px] text-fg-muted">
            Model
            <select value={model} onChange={(e) => setModel(e.target.value)} disabled={running} className="select max-w-[220px]">
              {models.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.label}
                </option>
              ))}
            </select>
          </label>
        )
      }
      footer={
        <div className="flex items-center gap-3">
          {running ? (
            <>
              <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-surface-3">
                <div className="h-full bg-accent transition-all" style={{ width: `${(doneCount / Math.max(1, states.size)) * 100}%` }} />
              </div>
              <span className="text-[12px] tabular-nums text-fg-muted">
                {doneCount}/{states.size} pages
              </span>
              <button className="btn border border-line" onClick={() => (cancel.current = true)}>
                Stop
              </button>
            </>
          ) : finished ? (
            <>
              <span className="flex flex-1 items-center gap-1.5 text-[12.5px]">
                {failed.length ? (
                  <span className="text-warn">
                    {doneCount} page{doneCount === 1 ? "" : "s"} updated, {failed.length} failed.
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1.5 text-ok">
                    <CheckCircle2 size={14} /> {doneCount} page{doneCount === 1 ? "" : "s"} updated in {fileName(mdPath)}
                  </span>
                )}
              </span>
              {failed.length > 0 && (
                <button className="btn border border-line" onClick={() => void run(failed)}>
                  <RotateCcw size={13} /> Retry failed
                </button>
              )}
              <button className="inline-flex h-8 items-center rounded-md bg-accent px-3 text-[12.5px] font-medium text-white hover:bg-accent/90" onClick={onClose}>
                Done
              </button>
            </>
          ) : (
            <>
              <span className="flex-1 text-[11.5px] text-fg-faint">
                {pages.length ? `${pages.length} page${pages.length > 1 ? "s" : ""} will be sent to Google Gemini and replace their text.` : "Click pages to select · Shift+click for a range"}
              </span>
              <button
                disabled={!pages.length || !model}
                onClick={() => void run(pages)}
                className="inline-flex h-8 items-center gap-1.5 rounded-md bg-accent px-3 text-[12.5px] font-medium text-white hover:bg-accent/90 disabled:opacity-40"
              >
                <Sparkles size={14} /> Run OCR on {pages.length || "…"} page{pages.length === 1 ? "" : "s"}
              </button>
            </>
          )}
        </div>
      }
    >
      <div className="flex h-full flex-col">
        <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-line px-4 py-2">
          <button className="btn border border-line" disabled={running} onClick={() => setSelected(new Set(Array.from({ length: total }, (_, i) => i + 1)))}>
            All
          </button>
          <button className="btn border border-line" disabled={running} onClick={() => setSelected(new Set())}>
            None
          </button>
          {suggested.length > 0 && (
            <button className="btn border border-line" disabled={running} onClick={() => setSelected(new Set(suggested))} title="Pages without a text layer">
              Scanned pages ({suggested.length})
            </button>
          )}
          <input
            value={range}
            disabled={running}
            onChange={(e) => setRange(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && setSelected(new Set(parseRange(range, total)))}
            placeholder="Pages, e.g. 1-3, 7"
            className="selectable h-7 w-40 rounded-md border border-line bg-surface-0 px-2 text-[12px] text-fg outline-none focus:border-accent/60"
          />
          <button className="btn" disabled={running || !range.trim()} onClick={() => setSelected(new Set(parseRange(range, total)))}>
            Select
          </button>
          {configured && (
            <button
              className="btn ml-auto text-fg-faint"
              disabled={running}
              onClick={() => void aiClearKey().then(() => setConfigured(false))}
              title="Remove the stored Gemini API key"
            >
              Disconnect key
            </button>
          )}
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          <div className="grid grid-cols-[repeat(auto-fill,minmax(130px,1fr))] gap-3">
            {Array.from({ length: total }, (_, i) => i + 1).map((n) => (
              <Thumb
                key={n}
                doc={doc}
                n={n}
                selected={selected.has(n)}
                scanned={suggested.includes(n)}
                state={states.get(n) ?? "idle"}
                error={errors.get(n)}
                onClick={(shift) => toggle(n, shift)}
              />
            ))}
          </div>
        </div>
      </div>
    </Modal>
  );
}

function Thumb({
  doc,
  n,
  selected,
  scanned,
  state,
  error,
  onClick,
}: {
  doc: PdfDoc;
  n: number;
  selected: boolean;
  scanned: boolean;
  state: PageState;
  error?: string;
  onClick: (shift: boolean) => void;
}) {
  const ref = useRef<HTMLButtonElement>(null);
  const [src, setSrc] = useState<string | null>(null);
  // Render only when scrolled into view: a 300-page PDF stays fast.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          io.disconnect();
          renderThumb(doc, n).then(setSrc).catch(() => setSrc(""));
        }
      },
      { rootMargin: "200px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [doc, n]);

  return (
    <button
      ref={ref}
      onClick={(e) => onClick(e.shiftKey)}
      title={error ?? `Page ${n}`}
      className={clsx(
        "group relative flex flex-col items-center gap-1.5 rounded-lg border-2 p-1.5 text-[11px] transition-colors",
        selected ? "border-accent bg-accent/[0.06]" : "border-transparent hover:border-line",
      )}
    >
      <div className="relative flex aspect-[1/1.414] w-full items-center justify-center overflow-hidden rounded bg-white shadow-sm ring-1 ring-line">
        {src ? <img src={src} alt={`Page ${n}`} className="h-full w-full object-contain" /> : <Loader2 size={14} className="animate-spin text-fg-faint" />}
        {state !== "idle" && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/30">
            {state === "running" ? (
              <Loader2 size={22} className="animate-spin text-white" />
            ) : state === "done" ? (
              <CheckCircle2 size={24} className="text-white drop-shadow" />
            ) : state === "error" ? (
              <XCircle size={24} className="text-white drop-shadow" />
            ) : (
              <span className="rounded bg-black/50 px-1.5 py-0.5 text-[10px] text-white">queued</span>
            )}
          </div>
        )}
        <span
          className={clsx(
            "absolute left-1.5 top-1.5 flex h-4 w-4 items-center justify-center rounded border text-white",
            selected ? "border-accent bg-accent" : "border-black/30 bg-white/80",
          )}
        >
          {selected && <CheckCircle2 size={12} />}
        </span>
      </div>
      <span className={clsx("flex items-center gap-1", selected ? "font-medium text-fg" : "text-fg-muted")}>
        {n}
        {scanned && <span className="rounded bg-warn/15 px-1 text-[9.5px] text-warn">scan</span>}
      </span>
    </button>
  );
}
