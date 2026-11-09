/**
 * Turns the Rust diff rows into CodeMirror decorations so the diff is shown
 * *inside* two editable editors (Beyond Compare / WinMerge style):
 *
 *  - line backgrounds per row kind,
 *  - inline word-level marks,
 *  - block "spacer" widgets where the other side has lines this side doesn't,
 *    so row N sits at the same height in both editors and scroll sync is 1:1.
 *
 * Every visual line is exactly ROW_H px (no wrapping), which keeps alignment exact.
 */
import { StateEffect, StateField, type Range, type Text } from "@codemirror/state";
import { Decoration, EditorView, WidgetType, type DecorationSet } from "@codemirror/view";
import type { Row, RowKind, Side } from "./types";

export const ROW_H = 20;
/** Top/bottom padding of .cm-content; the merge column offsets by the same amount. */
export const PAD_Y = 4;

export const setDiffDecorations = StateEffect.define<DecorationSet>();

export const diffField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(value, tr) {
    value = value.map(tr.changes); // stay roughly aligned while typing until the next diff arrives
    for (const e of tr.effects) if (e.is(setDiffDecorations)) value = e.value;
    return value;
  },
  provide: (f) => EditorView.decorations.from(f),
});

class Spacer extends WidgetType {
  constructor(readonly rows: number) {
    super();
  }
  eq(other: Spacer) {
    return other.rows === this.rows;
  }
  toDOM() {
    const el = document.createElement("div");
    el.className = "cm-diff-spacer";
    el.style.height = `${this.rows * ROW_H}px`;
    return el;
  }
  get estimatedHeight() {
    return this.rows * ROW_H;
  }
  ignoreEvent() {
    return true;
  }
}

const LINE_CLASS: Record<Side, Partial<Record<RowKind, string>>> = {
  left: { changed: "cm-diff-removed", deleted: "cm-diff-removed", similar: "cm-diff-similar", ignored: "cm-diff-ignored" },
  right: { changed: "cm-diff-added", inserted: "cm-diff-added", similar: "cm-diff-similar", ignored: "cm-diff-ignored" },
};
const MARK: Record<Side, Decoration> = {
  left: Decoration.mark({ class: "mark-del" }),
  right: Decoration.mark({ class: "mark-ins" }),
};
const lineDecos = new Map<string, Decoration>();
const lineDeco = (cls: string) => {
  let d = lineDecos.get(cls);
  if (!d) lineDecos.set(cls, (d = Decoration.line({ class: cls })));
  return d;
};

interface SideBuild {
  ranges: Range<Decoration>[];
  fillers: number;
  trailing: number;
}

function buildSide(doc: Text, rows: Row[], side: Side): SideBuild {
  const ranges: Range<Decoration>[] = [];
  const spansKey = side === "left" ? "leftSpans" : "rightSpans";
  let pending = 0;
  let fillers = 0;
  for (const row of rows) {
    const n = row[side];
    if (n === undefined) {
      pending++;
      continue;
    }
    if (n >= doc.lines) break; // doc changed since this diff; next diff will fix it
    const line = doc.line(n + 1);
    if (pending) {
      ranges.push(Decoration.widget({ widget: new Spacer(pending), block: true, side: -1 }).range(line.from));
      fillers += pending;
      pending = 0;
    }
    const cls = LINE_CLASS[side][row.kind];
    if (cls) ranges.push(lineDeco(cls).range(line.from));
    for (const [s, e] of row[spansKey] ?? []) {
      const from = line.from + s;
      const to = Math.min(line.from + e, line.to);
      if (to > from) ranges.push(MARK[side].range(from, to));
    }
  }
  return { ranges, fillers, trailing: pending };
}

/** Decorations for both editors, padded so both have the same visual height. */
export function buildDiffDecorations(left: Text, right: Text, rows: Row[]): Record<Side, DecorationSet> {
  const L = buildSide(left, rows, "left");
  const R = buildSide(right, rows, "right");
  let endL = L.trailing;
  let endR = R.trailing;
  const visL = left.lines + L.fillers + endL;
  const visR = right.lines + R.fillers + endR;
  if (visL < visR) endL += visR - visL;
  else endR += visL - visR;
  if (endL) L.ranges.push(Decoration.widget({ widget: new Spacer(endL), block: true, side: 1 }).range(left.length));
  if (endR) R.ranges.push(Decoration.widget({ widget: new Spacer(endR), block: true, side: 1 }).range(right.length));
  return { left: Decoration.set(L.ranges, true), right: Decoration.set(R.ranges, true) };
}
