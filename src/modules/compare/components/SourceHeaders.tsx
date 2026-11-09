import { AlertTriangle, FileCode2, FolderOpen, Loader2, Wand2, X } from "lucide-react";
import { formatterLabel } from "@/lib/format";
import { effectiveLanguage, useCompareStore } from "../store";
import type { Side } from "../types";
import { MERGE_COL_W } from "./MergeView";
import { MINIMAP_W } from "./Minimap";

export function SourceHeaders() {
  return (
    <div
      className="grid shrink-0 border-b border-line bg-surface-1"
      style={{ gridTemplateColumns: `minmax(0,1fr) ${MERGE_COL_W}px minmax(0,1fr) ${MINIMAP_W}px` }}
    >
      <SideHeader side="left" />
      <div className="border-x border-line" />
      <SideHeader side="right" />
      <div />
    </div>
  );
}

function SideHeader({ side }: { side: Side }) {
  const doc = useCompareStore((s) => s[side]);
  const out = useCompareStore((s) => s.result?.[side]);
  const formatting = useCompareStore((s) => s.formatting[side]);
  const lang = useCompareStore(effectiveLanguage);
  const { openFile, clear, formatSide } = useCompareStore.getState();
  const engine = lang ? formatterLabel(lang) : null;

  const warnings = out?.notes.filter((n) => n.level === "warn").map((n) => n.message) ?? [];

  return (
    <div className="flex h-9 min-w-0 items-center gap-2 px-3">
      <FileCode2 size={14} className="shrink-0 text-fg-faint" />
      <span className="truncate text-xs font-medium text-fg" title={doc.path ?? undefined}>
        {doc.name ?? (side === "left" ? "Left — untitled" : "Right — untitled")}
      </span>
      {out && <span className="shrink-0 text-[11px] text-fg-faint">{out.lines.length} lines</span>}

      {doc.lossy && (
        <span className="shrink-0 rounded bg-amber-500/15 px-1.5 py-0.5 text-[10px] text-amber-400" title="File was not valid UTF-8; invalid bytes were replaced">
          lossy decode
        </span>
      )}
      {warnings.length > 0 && (
        <span className="flex shrink-0 items-center gap-1 text-[11px] text-amber-400" title={warnings.join("\n")}>
          <AlertTriangle size={12} /> {warnings.length}
        </span>
      )}

      <div className="flex-1" />
      <button
        className="btn h-6 px-1.5"
        disabled={!engine || !doc.text || formatting}
        onClick={() => void formatSide(side)}
        title={engine ? `Format this side with ${engine} (undo with Ctrl+Z)` : "No formatter for this language"}
      >
        {formatting ? <Loader2 size={13} className="animate-spin" /> : <Wand2 size={13} />} Format
      </button>
      <button className="btn h-6 px-1.5" onClick={() => void openFile(side)} title="Open file…">
        <FolderOpen size={13} /> Open
      </button>
      {(doc.text || doc.path) && (
        <button className="btn h-6 px-1.5" onClick={() => clear(side)} title="Clear">
          <X size={13} />
        </button>
      )}
    </div>
  );
}
