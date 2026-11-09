import { useCallback, useEffect, useRef, useState } from "react";
import clsx from "clsx";
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  ChevronDown,
  Copy,
  Download,
  Eye,
  ExternalLink,
  FileText,
  FolderOpen,
  FolderOutput,
  Loader2,
  Palette,
  RefreshCw,
  Sparkles,
  Upload,
  X,
  XCircle,
} from "lucide-react";
import { errorMessage, isTauri } from "@/lib/tauri";
import { loadJSON, saveJSON } from "@/lib/storage";
import {
  aiClearKey,
  aiStatus,
  canPreview,
  converterCaps,
  convertDocument,
  installPandoc,
  type EngineProgress,
  extOf,
  fileName,
  isMarkdown,
  isPdf,
  openDocument,
  pickDocuments,
  pickFolder,
  pickTemplate,
  readPdf,
  saveMarkdown,
  type Caps,
  type ConvertReport,
  type Target,
} from "./api";
import { loadPdf, pdfToMarkdown, type PdfDoc } from "./pdf";
import { AiSetup, Modal, OcrDialog, PreviewDialog } from "./dialogs";

interface Options {
  target: Target;
  referenceDoc: string | null;
  outputDir: string | null;
}

interface PdfInfo {
  pages: number;
  emptyPages: number[];
  words: number;
}

interface Job {
  id: number;
  path: string;
  /** Output format, fixed when the job is queued. */
  to: Target;
  status: "queued" | "running" | "done" | "error";
  progress?: string;
  output?: string;
  report?: ConvertReport;
  pdf?: PdfInfo;
  error?: string;
  /** Bumped when the output file changes (AI OCR) so previews reload. */
  version: number;
  ocrDone?: boolean;
}

type Engine = { state: "checking" } | { state: "ready"; caps: Caps } | { state: "missing"; reason?: string };

const OPTS_KEY = "devomni.convert.options.v2";
let nextId = 1;

export default function ConvertView() {
  const rootRef = useRef<HTMLDivElement>(null);
  const [engine, setEngine] = useState<Engine>({ state: "checking" });
  const [opts, setOpts] = useState<Options>(() => loadJSON<Options>(OPTS_KEY, { target: "docx", referenceDoc: null, outputDir: null }));
  const [jobs, setJobs] = useState<Job[]>([]);
  const [dragging, setDragging] = useState(false);
  const [skipped, setSkipped] = useState<string[]>([]);
  const [preview, setPreview] = useState<number | null>(null);
  const [ocr, setOcr] = useState<number | null>(null);
  const [aiOpen, setAiOpen] = useState(false);
  const [aiReady, setAiReady] = useState(false);
  const docs = useRef(new Map<number, PdfDoc>());

  const caps = engine.state === "ready" ? engine.caps : null;
  const exts = caps?.inputs ?? [];

  const update = (patch: Partial<Options>) =>
    setOpts((o) => {
      const next = { ...o, ...patch };
      saveJSON(OPTS_KEY, next);
      return next;
    });

  const check = useCallback(() => {
    setEngine({ state: "checking" });
    converterCaps()
      .then((c) => setEngine(c.pandoc ? { state: "ready", caps: c } : { state: "missing" }))
      .catch((e) => setEngine({ state: "missing", reason: errorMessage(e) }));
    aiStatus()
      .then((s) => setAiReady(s.configured))
      .catch(() => setAiReady(false));
  }, []);
  useEffect(check, [check]);

  const optsRef = useRef(opts);
  optsRef.current = opts;

  const addFiles = useCallback(
    (paths: string[]) => {
      const ok: Job[] = [];
      const bad: string[] = [];
      for (const path of paths) {
        if (exts.includes(extOf(path))) {
          ok.push({ id: nextId++, path, to: isMarkdown(path) ? optsRef.current.target : "md", status: "queued", version: 0 });
        } else bad.push(fileName(path));
      }
      setSkipped(bad);
      if (ok.length) setJobs((j) => [...ok, ...j]);
    },
    [exts],
  );

  // One conversion at a time keeps the machine responsive.
  useEffect(() => {
    if (engine.state !== "ready" || jobs.some((j) => j.status === "running")) return;
    const next = [...jobs].reverse().find((j) => j.status === "queued");
    if (!next) return;
    const set = (patch: Partial<Job>) => setJobs((js) => js.map((j) => (j.id === next.id ? { ...j, ...patch } : j)));
    set({ status: "running" });
    const o = optsRef.current;

    if (isPdf(next.path)) {
      void (async () => {
        try {
          const doc = await loadPdf(await readPdf(next.path));
          docs.current.set(next.id, doc);
          const res = await pdfToMarkdown(doc, (p) => set({ progress: `Reading page ${p}/${doc.numPages}` }));
          const output = await saveMarkdown(next.path, o.outputDir, res.markdown);
          set({ status: "done", output, progress: undefined, pdf: { pages: res.pages, emptyPages: res.emptyPages, words: res.words } });
        } catch (e) {
          set({ status: "error", error: errorMessage(e), progress: undefined });
        }
      })();
      return;
    }
    convertDocument({ input: next.path, outputDir: o.outputDir, referenceDoc: o.referenceDoc, target: next.to })
      .then((report) => set({ status: "done", report, output: report.output }))
      .catch((e) => set({ status: "error", error: errorMessage(e) }));
  }, [jobs, engine]);

  // OS drag & drop (Tauri gives real paths; HTML5 drop does not).
  useEffect(() => {
    if (!isTauri()) return;
    let unlisten: (() => void) | undefined;
    let disposed = false;
    const visible = () => !!rootRef.current && rootRef.current.offsetParent !== null;
    void import("@tauri-apps/api/webview")
      .then(({ getCurrentWebview }) =>
        getCurrentWebview().onDragDropEvent((e) => {
          if (!visible()) return;
          const p = e.payload;
          if (p.type === "enter" || p.type === "over") setDragging(true);
          else if (p.type === "leave") setDragging(false);
          else if (p.type === "drop") {
            setDragging(false);
            addFiles(p.paths);
          }
        }),
      )
      .then((fn) => (disposed ? fn() : (unlisten = fn)));
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [addFiles]);

  const browse = () => void pickDocuments(exts).then(addFiles);
  const hasJobs = jobs.length > 0;
  const finished = jobs.filter((j) => j.status === "done" || j.status === "error").length;
  const previewJob = jobs.find((j) => j.id === preview);
  const ocrJob = jobs.find((j) => j.id === ocr);
  const targetInfo = caps?.targets.find((t) => t.id === opts.target);
  const templateUseful = ["docx", "pdf", "odt", "pptx"].includes(opts.target);

  return (
    <div ref={rootRef} className="relative flex h-full flex-col">
      <header className="flex h-11 shrink-0 items-center gap-2 border-b border-line bg-surface-1 px-4">
        <span className="text-[13px] font-semibold text-fg">Document converter</span>
        {engine.state === "checking" ? (
          <Loader2 size={13} className="animate-spin text-fg-faint" />
        ) : caps?.pandoc ? (
          <span className="text-[11px] text-fg-faint" title={caps.pandoc.path}>
            Pandoc {caps.pandoc.version}
            {caps.office ? ` · ${caps.office}` : ""}
          </span>
        ) : null}

        <div className="ml-auto flex items-center gap-1.5">
          {caps && (
            <label
              className="flex h-7 items-center gap-1.5 rounded-md border border-line bg-surface-2 pl-2 text-[11px] text-fg-muted"
              title="What Markdown files are converted to. Other documents always become Markdown."
            >
              Markdown →
              <select
                value={opts.target}
                onChange={(e) => update({ target: e.target.value as Target })}
                className="h-full cursor-pointer rounded-r-md bg-transparent pr-1 text-[11.5px] font-medium text-fg outline-none"
              >
                {caps.targets.map((t) => (
                  <option key={t.id} value={t.id} disabled={!t.available}>
                    {t.label}
                    {t.available ? "" : " — needs Word / LibreOffice"}
                  </option>
                ))}
              </select>
            </label>
          )}
          {templateUseful && (
            <PathChip
              icon={Palette}
              empty="Default style"
              value={opts.referenceDoc}
              title={`Style template (.${opts.target === "pdf" ? "docx" : targetInfo?.ext ?? "docx"}): the output copies its fonts, heading styles and margins`}
              onPick={() => void pickTemplate().then((p) => p && update({ referenceDoc: p }))}
              onClear={() => update({ referenceDoc: null })}
            />
          )}
          <PathChip
            icon={FolderOutput}
            empty="Next to source"
            value={opts.outputDir}
            title="Where converted files are saved. Existing files are never overwritten."
            onPick={() => void pickFolder().then((p) => p && update({ outputDir: p }))}
            onClear={() => update({ outputDir: null })}
          />
          <button
            onClick={() => setAiOpen(true)}
            title={aiReady ? "AI OCR connected (Google Gemini)" : "Set up AI OCR for scanned PDFs"}
            className={clsx(
              "flex h-7 items-center gap-1.5 rounded-md border px-2 text-[11px] transition-colors",
              aiReady ? "border-accent/40 bg-accent/10 text-fg" : "border-line bg-surface-2 text-fg-muted hover:text-fg",
            )}
          >
            <Sparkles size={13} className={aiReady ? "text-accent" : ""} />
            {aiReady ? "AI OCR" : "Set up AI OCR"}
          </button>
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto flex max-w-3xl flex-col gap-3 px-6 py-6">
          {engine.state === "missing" ? (
            <EngineMissing reason={engine.reason} onRetry={check} />
          ) : (
            <DropZone compact={hasJobs} active={dragging} onBrowse={browse} targetLabel={targetInfo?.label ?? "Word"} />
          )}

          {skipped.length > 0 && (
            <div className="flex items-center gap-2 rounded-lg bg-warn/10 px-3 py-2 text-xs text-fg-muted">
              <AlertTriangle size={14} className="shrink-0 text-warn" />
              <span className="min-w-0 flex-1 truncate">Not a supported document: {skipped.join(", ")}</span>
              <button className="text-fg-faint hover:text-fg" onClick={() => setSkipped([])} aria-label="Dismiss">
                <X size={14} />
              </button>
            </div>
          )}

          {hasJobs && (
            <>
              <div className="mt-2 flex items-center justify-between px-1 text-xs text-fg-faint">
                <span>
                  {finished}/{jobs.length} converted
                </span>
                <button
                  className="hover:text-fg disabled:opacity-40"
                  disabled={jobs.some((j) => j.status === "running")}
                  onClick={() => {
                    jobs.forEach((j) => j.status !== "queued" && docs.current.get(j.id)?.destroy());
                    setJobs((js) => js.filter((j) => j.status === "queued"));
                  }}
                >
                  Clear list
                </button>
              </div>
              <ul className="flex flex-col gap-2">
                {jobs.map((j) => (
                  <JobRow key={j.id} job={j} onPreview={() => setPreview(j.id)} onOcr={() => setOcr(j.id)} />
                ))}
              </ul>
            </>
          )}
        </div>
      </div>

      {previewJob?.output && (
        <PreviewDialog
          path={previewJob.output}
          version={previewJob.version}
          pdfSource={isPdf(previewJob.path) ? previewJob.path : undefined}
          onOcr={docs.current.has(previewJob.id) ? () => setOcr(previewJob.id) : undefined}
          onClose={() => setPreview(null)}
        />
      )}
      {ocrJob?.output && docs.current.get(ocrJob.id) && (
        <OcrDialog
          doc={docs.current.get(ocrJob.id)!}
          pdfPath={ocrJob.path}
          mdPath={ocrJob.output}
          suggested={ocrJob.pdf?.emptyPages ?? []}
          onClose={() => {
            setOcr(null);
            void aiStatus().then((s) => setAiReady(s.configured));
          }}
          onDone={() => setJobs((js) => js.map((j) => (j.id === ocrJob.id ? { ...j, version: j.version + 1, ocrDone: true } : j)))}
        />
      )}
      {aiOpen && (
        <Modal title="AI OCR" subtitle="Google Gemini — used only when you choose pages to OCR" onClose={() => setAiOpen(false)} size="md">
          <div className="overflow-y-auto p-5">
            {aiReady ? (
              <AiConnected
                onDisconnect={() => {
                  setAiReady(false);
                }}
              />
            ) : (
              <AiSetup
                onReady={() => {
                  setAiReady(true);
                  setAiOpen(false);
                }}
              />
            )}
          </div>
        </Modal>
      )}
    </div>
  );
}

// ── Pieces ──────────────────────────────────────────────────────────────────

function AiConnected({ onDisconnect }: { onDisconnect: () => void }) {
  return (
    <div className="flex flex-col items-center gap-3 py-4 text-center">
      <CheckCircle2 size={28} className="text-ok" />
      <div className="text-[13.5px] font-medium text-fg">Gemini is connected</div>
      <p className="max-w-sm text-[12px] text-fg-muted">
        Convert a PDF, open its preview and choose “Fix pages with AI OCR” — only the pages you pick are sent.
      </p>
      <button
        className="btn border border-line"
        onClick={() => void aiClearKey().then(onDisconnect)}
      >
        Remove API key
      </button>
    </div>
  );
}

function PathChip({
  icon: Icon,
  empty,
  value,
  title,
  onPick,
  onClear,
}: {
  icon: typeof Palette;
  empty: string;
  value: string | null;
  title: string;
  onPick: () => void;
  onClear: () => void;
}) {
  return (
    <div
      className={clsx(
        "flex h-7 max-w-[180px] items-center rounded-md border text-[11px] transition-colors",
        value ? "border-accent/40 bg-accent/10 text-fg" : "border-line bg-surface-2 text-fg-muted",
      )}
      title={value ? `${title}\n\n${value}` : title}
    >
      <button onClick={onPick} className="flex h-full min-w-0 items-center gap-1.5 px-2 hover:text-fg">
        <Icon size={13} className="shrink-0" />
        <span className="truncate">{value ? fileName(value) : empty}</span>
        {!value && <ChevronDown size={12} className="shrink-0 text-fg-faint" />}
      </button>
      {value && (
        <button onClick={onClear} className="flex h-full items-center pr-1.5 text-fg-faint hover:text-fg" aria-label="Reset">
          <X size={12} />
        </button>
      )}
    </div>
  );
}

const FORMATS_IN = ["DOCX", "DOC", "PDF", "PPTX", "XLSX", "ODT", "RTF", "HTML", "EPUB"];

function DropZone({ compact, active, onBrowse, targetLabel }: { compact: boolean; active: boolean; onBrowse: () => void; targetLabel: string }) {
  if (compact) {
    return (
      <button
        onClick={onBrowse}
        className={clsx(
          "flex h-12 items-center justify-center gap-2 rounded-xl border border-dashed text-xs transition-colors",
          active ? "border-accent bg-accent/10 text-fg" : "border-line text-fg-muted hover:border-fg-faint hover:text-fg",
        )}
      >
        <Upload size={14} />
        {active ? "Drop to convert" : "Drop more files or click to browse"}
      </button>
    );
  }
  return (
    <button
      onClick={onBrowse}
      className={clsx(
        "group mt-6 flex flex-col items-center justify-center gap-5 rounded-2xl border-2 border-dashed px-8 py-14 transition-colors",
        active ? "border-accent bg-accent/[0.07]" : "border-line hover:border-fg-faint hover:bg-surface-1",
      )}
    >
      <div className="flex items-center gap-3">
        <div className="flex max-w-[180px] flex-wrap justify-end gap-1">
          {FORMATS_IN.map((f) => (
            <span key={f} className="rounded border border-line bg-surface-2 px-1.5 py-0.5 text-[9.5px] font-bold tracking-wide text-fg-muted">
              {f}
            </span>
          ))}
        </div>
        <span className="flex flex-col items-center text-fg-faint">
          <ArrowRight size={16} />
          <ArrowRight size={16} className="rotate-180" />
        </span>
        <span className="rounded-md border border-accent/40 bg-accent/10 px-3 py-3 text-[11px] font-bold tracking-wide text-accent">MD</span>
      </div>
      <div className="text-center">
        <div className="text-sm font-medium text-fg">{active ? "Drop to convert" : "Drop documents here"}</div>
        <div className="mt-1 text-xs text-fg-muted">
          or <span className="text-accent group-hover:underline">browse</span> · documents become Markdown · Markdown becomes{" "}
          <span className="text-fg">{targetLabel}</span>
        </div>
      </div>
      <div className="text-[11px] text-fg-faint">Formatting, tables and images kept · every result checked · scanned PDFs: AI OCR</div>
    </button>
  );
}

function EngineMissing({ reason, onRetry }: { reason?: string; onRetry: () => void }) {
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<EngineProgress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showManual, setShowManual] = useState(false);
  const cmd = "winget install --id JohnMacFarlane.Pandoc";

  const download = () => {
    setBusy(true);
    setError(null);
    installPandoc(setProgress)
      .then(onRetry)
      .catch((e) => setError(errorMessage(e)))
      .finally(() => setBusy(false));
  };

  const pctDone = progress?.total ? Math.round((progress.downloaded / progress.total) * 100) : null;
  const mb = (n: number) => (n / 1_048_576).toFixed(1);

  return (
    <div className="mt-6 flex flex-col items-center rounded-2xl border border-line bg-surface-1 px-6 py-10 text-center">
      <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-accent/10 text-accent">
        <Download size={22} />
      </div>
      <div className="mt-4 text-[15px] font-semibold text-fg">One-time setup: conversion engine</div>
      <p className="mt-1.5 max-w-md text-[12.5px] leading-relaxed text-fg-muted">
        {reason ??
          "The converter uses Pandoc. It isn't included in the installer to keep DevOmni small — download it once (about 35 MB) and everything works offline."}
      </p>

      {busy ? (
        <div className="mt-5 w-full max-w-sm">
          <div className="h-2 overflow-hidden rounded-full bg-surface-3">
            <div
              className={clsx("h-full rounded-full bg-accent transition-all", pctDone === null && "w-1/3 animate-pulse")}
              style={pctDone !== null ? { width: `${pctDone}%` } : undefined}
            />
          </div>
          <div className="mt-2 text-[11.5px] tabular-nums text-fg-muted">
            {progress?.stage === "verify"
              ? "Verifying…"
              : progress?.stage === "install"
                ? "Installing…"
                : progress
                  ? `${mb(progress.downloaded)}${progress.total ? ` / ${mb(progress.total)}` : ""} MB`
                  : "Connecting…"}
          </div>
        </div>
      ) : (
        <button
          onClick={download}
          disabled={!!reason}
          className="mt-5 inline-flex h-9 items-center gap-2 rounded-lg bg-accent px-4 text-[13px] font-medium text-white hover:bg-accent/90 disabled:opacity-40"
        >
          <Download size={15} /> Download engine (~35 MB)
        </button>
      )}
      {error && <div className="mt-3 max-w-md text-[12px] text-err">{error}</div>}

      <div className="mt-6 flex items-center gap-3 text-[11.5px] text-fg-faint">
        <button className="hover:text-fg" onClick={() => setShowManual((v) => !v)}>
          Already have Pandoc / install it yourself?
        </button>
        <span>·</span>
        <button className="inline-flex items-center gap-1 hover:text-fg" onClick={onRetry}>
          <RefreshCw size={11} /> Check again
        </button>
      </div>
      {showManual && (
        <div className="mt-3 flex items-center gap-2 rounded-lg bg-surface-0 px-3 py-2 font-mono text-xs text-fg">
          <span className="selectable">{cmd}</span>
          <button className="text-fg-faint hover:text-fg" onClick={() => void navigator.clipboard.writeText(cmd)} title="Copy">
            <Copy size={13} />
          </button>
        </div>
      )}
    </div>
  );
}

const pct = (x: number) => (x >= 0.9995 ? "100%" : `${(Math.floor(x * 1000) / 10).toFixed(1)}%`);
const Dot = () => <span className="text-line">•</span>;

function JobRow({ job, onPreview, onOcr }: { job: Job; onPreview: () => void; onOcr: () => void }) {
  const [open, setOpen] = useState(false);
  const r = job.report;
  const pdf = job.pdf;
  const from = r?.from ?? extOf(job.path).toUpperCase().replace("MARKDOWN", "MD");
  const to = job.to === "latex" ? "TEX" : job.to.toUpperCase();
  const lossless = !!r && (!r.verified || (r.textKept >= 0.9995 && r.imagesOut >= r.imagesIn));
  const issues = r ? r.warnings.length + (r.verified && r.textKept < 0.9995 ? 1 : 0) : 0;
  const needsOcr = !!pdf && pdf.emptyPages.length > 0 && !job.ocrDone;

  return (
    <li className="rounded-xl border border-line bg-surface-1">
      <div className="flex items-center gap-3 px-3.5 py-3">
        <div className="flex h-9 w-9 shrink-0 flex-col items-center justify-center rounded-lg bg-surface-3 text-fg-muted">
          <FileText size={15} strokeWidth={1.75} />
          <span className="text-[7.5px] font-bold leading-none tracking-wide">{from.slice(0, 4)}</span>
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center gap-1.5 text-[13px]">
            <span className="truncate font-medium text-fg" title={job.path}>
              {fileName(job.path)}
            </span>
            {job.output && (
              <>
                <ArrowRight size={12} className="shrink-0 text-fg-faint" />
                <span className="truncate text-fg-muted" title={job.output}>
                  {fileName(job.output)}
                </span>
              </>
            )}
          </div>
          <div className="mt-0.5 flex items-center gap-1.5 text-[11px] text-fg-faint">
            <span className="font-medium">
              {from} → {to}
            </span>
            {job.status === "queued" && <span>· Waiting…</span>}
            {job.status === "running" && <span>· {job.progress ?? "Converting…"}</span>}
            {r && (
              <>
                <Dot />
                {r.verified ? (
                  <>
                    <span className={r.textKept >= 0.9995 ? "text-ok" : "text-warn"}>{pct(r.textKept)} text</span>
                    <Dot />
                    <span className={r.imagesOut >= r.imagesIn ? "text-ok" : "text-warn"}>
                      {r.imagesOut}/{r.imagesIn} images
                    </span>
                  </>
                ) : (
                  <span title="Pandoc can't read this format back reliably, so the result isn't measured">not verified</span>
                )}
                <Dot />
                <span>{(r.millis / 1000).toFixed(1)}s</span>
              </>
            )}
            {pdf && (
              <>
                <Dot />
                <span>
                  {pdf.pages} page{pdf.pages > 1 ? "s" : ""} · {pdf.words.toLocaleString()} words
                </span>
                {needsOcr && (
                  <>
                    <Dot />
                    <span className="text-warn">
                      {pdf.emptyPages.length} without text{pdf.emptyPages.length === pdf.pages ? " (scanned)" : ""}
                    </span>
                  </>
                )}
                {job.ocrDone && (
                  <>
                    <Dot />
                    <span className="text-ok">AI OCR applied</span>
                  </>
                )}
              </>
            )}
            {job.error && (
              <span className="truncate text-err" title={job.error}>
                · {job.error}
              </span>
            )}
          </div>
        </div>

        {job.status === "done" && job.output && (
          <div className="flex shrink-0 items-center gap-0.5">
            {issues > 0 && (
              <button className="btn h-7 px-2 text-warn" onClick={() => setOpen((o) => !o)} title="Show details">
                <AlertTriangle size={13} /> {issues}
              </button>
            )}
            {pdf && (
              <button
                onClick={onOcr}
                title="Re-read chosen pages with AI OCR"
                className={clsx(
                  "inline-flex h-7 items-center gap-1 rounded-md px-2 text-[11.5px] font-medium transition-colors",
                  needsOcr ? "bg-accent text-white hover:bg-accent/90" : "text-fg-muted hover:bg-surface-3 hover:text-fg",
                )}
              >
                <Sparkles size={13} /> OCR
              </button>
            )}
            {canPreview(job.output) && (
              <IconBtn title="Preview" onClick={onPreview}>
                <Eye size={14} />
              </IconBtn>
            )}
            <IconBtn title="Open" onClick={() => void openDocument(job.output!)}>
              <ExternalLink size={14} />
            </IconBtn>
            <IconBtn title="Show in folder" onClick={() => void openDocument(job.output!, true)}>
              <FolderOpen size={14} />
            </IconBtn>
          </div>
        )}

        <StatusIcon status={job.status} lossless={lossless && !needsOcr} />
      </div>

      {open && r && issues > 0 && (
        <ul className="selectable space-y-1 border-t border-line px-4 py-2.5 text-[11px] leading-relaxed text-fg-muted">
          {r.verified && r.textKept < 0.9995 && (
            <li>
              {pct(1 - r.textKept)} of {r.words.toLocaleString()} words differ
              {r.missingWords.length > 0 && <> (e.g. {r.missingWords.map((w) => `“${w}”`).join(", ")})</>}.
            </li>
          )}
          {r.warnings.map((w) => (
            <li key={w}>{w}</li>
          ))}
        </ul>
      )}
    </li>
  );
}

function IconBtn({ title, onClick, children }: { title: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      title={title}
      aria-label={title}
      onClick={onClick}
      className="flex h-7 w-7 items-center justify-center rounded-md text-fg-faint transition-colors hover:bg-surface-3 hover:text-fg"
    >
      {children}
    </button>
  );
}

function StatusIcon({ status, lossless }: { status: Job["status"]; lossless: boolean }) {
  const cls = "shrink-0";
  if (status === "queued") return <span className={clsx(cls, "h-4 w-4 rounded-full border-2 border-line")} />;
  if (status === "running") return <Loader2 size={16} className={clsx(cls, "animate-spin text-accent")} />;
  if (status === "error") return <XCircle size={16} className={clsx(cls, "text-err")} />;
  return lossless ? <CheckCircle2 size={16} className={clsx(cls, "text-ok")} /> : <AlertTriangle size={16} className={clsx(cls, "text-warn")} />;
}
