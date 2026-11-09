import clsx from "clsx";
import * as Switch from "@radix-ui/react-switch";
import {
  ArrowLeftRight,
  ChevronDown,
  ChevronsLeft,
  ChevronsRight,
  ChevronUp,
  Loader2,
  Palette,
  PanelRightClose,
  PanelRightOpen,
  Undo2,
  Wand2,
} from "lucide-react";
import { formatterLabel } from "@/lib/format";
import { canMerge, effectiveLanguage, useCompareStore } from "../store";
import { LANGUAGES, type Language } from "../types";

export function Toolbar() {
  const s = useCompareStore();
  const lang = effectiveLanguage(s);
  const engine = lang ? formatterLabel(lang) : null;
  const hunkCount = s.result?.hunks.length ?? 0;
  const mergeOk = canMerge(s);
  const formattingAny = s.formatting.left || s.formatting.right;

  return (
    <header className="flex h-11 shrink-0 items-center gap-1.5 border-b border-line bg-surface-1 px-3">
      <select
        className="select"
        value={s.language ?? "auto"}
        onChange={(e) => s.setLanguage(e.target.value === "auto" ? null : (e.target.value as Language))}
        title="Language (auto-detected from file name or content)"
      >
        <option value="auto">Auto{s.language === null && lang ? ` (${lang})` : ""}</option>
        {LANGUAGES.map((l) => (
          <option key={l} value={l}>
            {l}
          </option>
        ))}
      </select>

      <Divider />

      {/* Formatting */}
      <label
        className="flex cursor-pointer items-center gap-1.5 rounded-md px-2 text-xs text-fg-muted hover:text-fg"
        title={
          engine
            ? `Format both sides with ${engine} now, and again whenever you open or paste code (Ctrl+Z to undo)`
            : "No formatter for this language"
        }
      >
        <Switch.Root
          checked={s.autoFormat}
          onCheckedChange={s.setAutoFormat}
          className="relative h-4 w-7 shrink-0 rounded-full bg-surface-3 transition-colors data-[state=checked]:bg-accent"
        >
          <Switch.Thumb className="block h-3 w-3 translate-x-0.5 rounded-full bg-white transition-transform data-[state=checked]:translate-x-[14px]" />
        </Switch.Root>
        Auto-format
      </label>
      <button className="btn" disabled={!engine || formattingAny} onClick={() => void s.formatBoth()} title={engine ? `Format both sources with ${engine}` : "No formatter for this language"}>
        {formattingAny ? <Loader2 size={14} className="animate-spin" /> : <Wand2 size={14} />} Format both
      </button>

      <Divider />

      {/* Merge */}
      <button className="btn px-2" disabled={!mergeOk || !hunkCount} onClick={() => s.copyAll("toRight")} title="Copy entire left side to the right">
        <ChevronsRight size={15} /> All
      </button>
      <button className="btn px-2" disabled={!mergeOk || !hunkCount} onClick={() => s.copyAll("toLeft")} title="Copy entire right side to the left">
        All <ChevronsLeft size={15} />
      </button>
      <button className="btn px-2" disabled={!s.undoStack.length} onClick={s.undo} title="Undo last merge / format (Ctrl+Z outside the editors)">
        <Undo2 size={14} />
      </button>
      <button className="btn px-2" onClick={s.swap} title="Swap left and right">
        <ArrowLeftRight size={14} />
      </button>

      <div className="flex-1" />

      <button
        className={clsx("btn px-2", s.syntaxColors && "text-fg")}
        onClick={() => s.setSyntaxColors(!s.syntaxColors)}
        title={s.syntaxColors ? "Syntax colors: on" : "Syntax colors: off"}
      >
        <Palette size={14} className={s.syntaxColors ? "text-accent" : ""} />
      </button>

      {s.status === "running" && <Loader2 size={14} className="animate-spin text-fg-faint" />}

      <div className="flex items-center gap-1">
        <span className="min-w-[64px] text-right text-xs tabular-nums text-fg-muted">
          {hunkCount ? `${s.activeHunk >= 0 ? s.activeHunk + 1 : "–"} / ${hunkCount}` : "no changes"}
        </span>
        <button className="btn px-1.5" disabled={!hunkCount} onClick={() => s.nextHunk(-1)} title="Previous change (Shift+F7 / Alt+↑)">
          <ChevronUp size={16} />
        </button>
        <button className="btn px-1.5" disabled={!hunkCount} onClick={() => s.nextHunk(1)} title="Next change (F7 / Alt+↓)">
          <ChevronDown size={16} />
        </button>
      </div>

      <Divider />
      <button
        className={clsx("btn px-2", s.panelOpen && "text-fg")}
        onClick={() => s.setPanelOpen(!s.panelOpen)}
        title={s.panelOpen ? "Hide compare options (Ctrl+B)" : "Show compare options (Ctrl+B)"}
        aria-pressed={s.panelOpen}
      >
        {s.panelOpen ? <PanelRightClose size={15} /> : <PanelRightOpen size={15} />}
      </button>
    </header>
  );
}

const Divider = () => <div className="mx-1 h-5 w-px bg-line" />;
