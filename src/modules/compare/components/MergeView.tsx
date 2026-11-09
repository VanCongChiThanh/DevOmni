import { useEffect, useRef, useState } from "react";
import type { EditorView } from "@codemirror/view";
import { ArrowLeft, ArrowRight } from "lucide-react";
import clsx from "clsx";
import { buildDiffDecorations, diffField, PAD_Y, ROW_H, setDiffDecorations } from "../diffDecorations";
import { canMerge, effectiveLanguage, useCompareStore } from "../store";
import type { Hunk, Side } from "../types";
import { CodeEditor } from "./CodeEditor";
import { Minimap } from "./Minimap";

export const MERGE_COL_W = 44;
const EXTENSIONS = [diffField];

/**
 * One view for editing, comparing and merging: both panes are live editors,
 * the diff is drawn inside them, and →/← copy blocks across. No mode switch.
 */
export function MergeView() {
  const [views, setViews] = useState<Record<Side, EditorView | null>>({ left: null, right: null });
  const result = useCompareStore((s) => s.result);
  const resultIsCurrent = useCompareStore((s) => s.rev === s.resultRev);
  const activeHunk = useCompareStore((s) => s.activeHunk);
  const navTick = useCompareStore((s) => s.navTick);
  const mergeEnabled = useCompareStore(canMerge);
  const bandsRef = useRef<HTMLDivElement>(null);

  // Draw the diff into both editors once it matches what they contain.
  useEffect(() => {
    const { left, right } = views;
    if (!left || !right) return;
    if (!result) {
      left.dispatch({ effects: setDiffDecorations.of(buildDiffDecorations(left.state.doc, right.state.doc, []).left) });
      right.dispatch({ effects: setDiffDecorations.of(buildDiffDecorations(left.state.doc, right.state.doc, []).right) });
      return;
    }
    if (!resultIsCurrent) return; // user is still typing; decorations are being mapped through edits
    const decos = buildDiffDecorations(left.state.doc, right.state.doc, result.rows);
    left.dispatch({ effects: setDiffDecorations.of(decos.left) });
    right.dispatch({ effects: setDiffDecorations.of(decos.right) });
  }, [views, result, resultIsCurrent]);

  // Vertical scroll sync (1:1 thanks to spacer alignment) + merge column follow.
  useEffect(() => {
    const { left, right } = views;
    if (!left || !right) return;
    const a = left.scrollDOM;
    const b = right.scrollDOM;
    const follow = (src: HTMLElement, dst: HTMLElement) => () => {
      if (Math.abs(dst.scrollTop - src.scrollTop) > 1) dst.scrollTop = src.scrollTop;
      if (bandsRef.current) bandsRef.current.style.transform = `translateY(${-src.scrollTop}px)`;
    };
    const fa = follow(a, b);
    const fb = follow(b, a);
    a.addEventListener("scroll", fa, { passive: true });
    b.addEventListener("scroll", fb, { passive: true });
    return () => {
      a.removeEventListener("scroll", fa);
      b.removeEventListener("scroll", fb);
    };
  }, [views]);

  // Jump to the active change on navigation.
  useEffect(() => {
    const h = result?.hunks[activeHunk];
    const scroller = views.left?.scrollDOM;
    if (!h || !scroller) return;
    scroller.scrollTop = PAD_Y + h.start * ROW_H - scroller.clientHeight / 2 + ROW_H;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [navTick]);

  return (
    <div className="flex h-full overflow-hidden">
      <div className="min-w-0 flex-1 overflow-hidden">
        <SideEditor side="left" onView={(v) => setViews((s) => ({ ...s, left: v }))} />
      </div>
      <MergeColumn hunks={resultIsCurrent ? result?.hunks ?? [] : []} activeHunk={activeHunk} enabled={mergeEnabled} bandsRef={bandsRef} />
      <div className="min-w-0 flex-1 overflow-hidden">
        <SideEditor side="right" onView={(v) => setViews((s) => ({ ...s, right: v }))} />
      </div>
      <Minimap rows={result?.rows ?? []} hunks={result?.hunks ?? []} scroller={views.left?.scrollDOM ?? null} />
    </div>
  );
}

function SideEditor({ side, onView }: { side: Side; onView: (v: EditorView | null) => void }) {
  const text = useCompareStore((s) => s[side].text);
  const language = useCompareStore(effectiveLanguage);
  const { setText, handlePaste } = useCompareStore.getState();
  return (
    <CodeEditor
      value={text}
      onChange={(v) => setText(side, v)}
      onPaste={() => handlePaste(side)}
      onView={onView}
      language={language}
      extensions={EXTENSIONS}
      placeholder={`Paste the ${side} version here, press Open, or drop a file onto this half…`}
    />
  );
}

/** Column between the panes: one band per change block with →/← buttons. */
function MergeColumn(p: { hunks: Hunk[]; activeHunk: number; enabled: boolean; bandsRef: React.RefObject<HTMLDivElement> }) {
  const copy = (i: number, dir: "toRight" | "toLeft") => () => useCompareStore.getState().copyHunk(i, dir);
  const select = (i: number) => () => useCompareStore.setState({ activeHunk: i });
  return (
    <div className="relative shrink-0 overflow-hidden border-x border-line bg-surface-1" style={{ width: MERGE_COL_W }}>
      <div ref={p.bandsRef} className="absolute inset-x-0 top-0 will-change-transform">
        {p.hunks.map((h, i) => (
          <div
            key={`${h.start}-${i}`}
            onClick={select(i)}
            className={clsx("merge-band", i === p.activeHunk && "active")}
            style={{ top: PAD_Y + h.start * ROW_H, height: Math.max(1, h.end - h.start) * ROW_H }}
          >
            <button className="merge-btn" disabled={!p.enabled} onClick={copy(i, "toRight")} title="Copy this block to the right (Alt+→)">
              <ArrowRight size={13} strokeWidth={2.5} />
            </button>
            <button className="merge-btn" disabled={!p.enabled} onClick={copy(i, "toLeft")} title="Copy this block to the left (Alt+←)">
              <ArrowLeft size={13} strokeWidth={2.5} />
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
