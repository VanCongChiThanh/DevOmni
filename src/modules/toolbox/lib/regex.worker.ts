/// <reference lib="webworker" />
// Regex evaluation off the UI thread: a catastrophic pattern can only hang this
// worker, which the tool terminates after a timeout.

export interface RegexRequest {
  id: number;
  pattern: string;
  flags: string;
  text: string;
  replace: string | null;
}

export interface RegexMatch {
  index: number;
  end: number;
  text: string;
  groups: (string | undefined)[];
  named: Record<string, string | undefined> | null;
}

export type RegexResponse =
  | { id: number; ok: true; matches: RegexMatch[]; truncated: boolean; replaced: string | null }
  | { id: number; ok: false; error: string };

const MAX = 5000;

self.onmessage = (e: MessageEvent<RegexRequest>) => {
  const { id, pattern, flags, text, replace } = e.data;
  try {
    const re = new RegExp(pattern, flags.includes("g") ? flags : flags + "g");
    const matches: RegexMatch[] = [];
    let truncated = false;
    for (const m of text.matchAll(re)) {
      if (matches.length >= MAX) {
        truncated = true;
        break;
      }
      const index = m.index ?? 0;
      matches.push({ index, end: index + m[0].length, text: m[0], groups: m.slice(1), named: m.groups ? { ...m.groups } : null });
      if (!flags.includes("g")) break;
    }
    const replaced = replace === null ? null : text.replace(new RegExp(pattern, flags), replace);
    (self as unknown as Worker).postMessage({ id, ok: true, matches, truncated, replaced } satisfies RegexResponse);
  } catch (err) {
    (self as unknown as Worker).postMessage({ id, ok: false, error: (err as Error).message } satisfies RegexResponse);
  }
};
