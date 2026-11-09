import type { Hunk, Row } from "./types";

/** [start, end) display-line range per side covered by a change block. */
export interface HunkRanges {
  left: [number, number];
  right: [number, number];
}

/**
 * Line ranges a hunk occupies on each side. A side with no lines in the hunk
 * (pure insertion/deletion) gets an empty range at the insertion point: right
 * after the nearest preceding row that has a line on that side.
 */
export function hunkRanges(rows: Row[], hunk: Hunk): HunkRanges {
  const side = (key: "left" | "right"): [number, number] => {
    let start = -1;
    let end = -1;
    for (let i = hunk.start; i < hunk.end; i++) {
      const v = rows[i][key];
      if (v !== undefined) {
        if (start < 0) start = v;
        end = v + 1;
      }
    }
    if (start >= 0) return [start, end];
    for (let i = hunk.start - 1; i >= 0; i--) {
      const v = rows[i][key];
      if (v !== undefined) return [v + 1, v + 1];
    }
    return [0, 0];
  };
  return { left: side("left"), right: side("right") };
}

/** Replace `target[range]` with `source[range]`. */
export function replaceBlock(target: string[], t: [number, number], source: string[], s: [number, number]): string[] {
  return [...target.slice(0, t[0]), ...source.slice(s[0], s[1]), ...target.slice(t[1])];
}

/** Join lines keeping the original text's line ending style and trailing newline. */
export function joinLines(lines: string[], original: string): string {
  const eol = original.includes("\r\n") ? "\r\n" : "\n";
  const trailing = /\n$/.test(original);
  return lines.join(eol) + (trailing && lines.length ? eol : "");
}
