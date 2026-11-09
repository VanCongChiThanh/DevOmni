import { create } from "zustand";
import { errorMessage } from "@/lib/tauri";
import { loadJSON, saveJSON } from "@/lib/storage";
import { DEFAULT_FORMAT, formatCode, formatterLabel, type FormatSettings } from "@/lib/format";
import { compareTexts, detectLanguage, pickFile, readTextFile } from "./api";
import { hunkRanges, joinLines, replaceBlock } from "./merge";
import type { CompareResponse, DiffAlgorithm, Language, NormalizeOptions, Side } from "./types";

export interface SourceDoc {
  text: string;
  path: string | null;
  name: string | null;
  lossy: boolean;
}

const emptyDoc = (): SourceDoc => ({ text: "", path: null, name: null, lossy: false });

export const DEFAULT_OPTIONS: NormalizeOptions = {
  trimTrailingWhitespace: false,
  ignoreIndentation: false,
  collapseWhitespace: false,
  ignoreAllWhitespace: false,
  tabWidth: null,
  ignoreCase: false,
  ignoreBlankLines: false,
  stripComments: false,
  sortJsonKeys: false,
};

export const PRESETS: Record<"exact" | "whitespace" | "semantic", Partial<NormalizeOptions>> = {
  exact: { ...DEFAULT_OPTIONS },
  whitespace: {
    trimTrailingWhitespace: true, ignoreIndentation: true, collapseWhitespace: true,
    tabWidth: 4, ignoreBlankLines: true, ignoreAllWhitespace: false,
  },
  semantic: {
    trimTrailingWhitespace: true, ignoreIndentation: true, collapseWhitespace: true,
    tabWidth: 4, ignoreBlankLines: true, stripComments: true,
  },
};

const PREFS_KEY = "devomni.compare.prefs.v3";
export const PANEL_DEFAULT_W = 288;
export const PANEL_MIN_W = 240;
export const PANEL_MAX_W = 560;
interface Prefs {
  options: NormalizeOptions;
  algorithm: DiffAlgorithm;
  format: FormatSettings;
  autoFormat: boolean;
  syntaxColors: boolean;
  panelOpen: boolean;
  panelWidth: number;
}
const prefs = loadJSON<Prefs>(PREFS_KEY, {
  options: DEFAULT_OPTIONS,
  algorithm: "myers",
  format: DEFAULT_FORMAT,
  autoFormat: false,
  syntaxColors: true,
  panelOpen: true,
  panelWidth: PANEL_DEFAULT_W,
});

export type MergeDir = "toRight" | "toLeft";
type Snapshot = { left: string; right: string };

interface CompareState {
  left: SourceDoc;
  right: SourceDoc;
  options: NormalizeOptions;
  /** null = auto-detect */
  language: Language | null;
  detectedLanguage: Language | null;
  algorithm: DiffAlgorithm;

  format: FormatSettings;
  /** Format both sides in place when enabled, on file open and on paste. */
  autoFormat: boolean;
  syntaxColors: boolean;
  formatting: Record<Side, boolean>;

  result: CompareResponse | null;
  status: "idle" | "running" | "error";
  error: string | null;

  /** Bumped on every text change; `resultRev` is the rev the current result was computed from. */
  rev: number;
  resultRev: number;
  undoStack: Snapshot[];

  activeHunk: number;
  /** Bumped on every navigation request; the viewer scrolls when it changes. */
  navTick: number;

  setText: (side: Side, text: string) => void;
  openFile: (side: Side, path?: string) => Promise<void>;
  clear: (side: Side) => void;
  swap: () => void;
  setOption: <K extends keyof NormalizeOptions>(key: K, value: NormalizeOptions[K]) => void;
  applyPreset: (preset: keyof typeof PRESETS) => void;
  setLanguage: (language: Language | null) => void;
  setAlgorithm: (algorithm: DiffAlgorithm) => void;
  handlePaste: (side: Side) => void;
  setFormat: <K extends keyof FormatSettings>(key: K, value: FormatSettings[K]) => void;
  setAutoFormat: (on: boolean) => void;
  setSyntaxColors: (on: boolean) => void;
  /** Compare-options side panel (collapsible, resizable). */
  panelOpen: boolean;
  panelWidth: number;
  setPanelOpen: (open: boolean) => void;
  setPanelWidth: (width: number) => void;
  formatSide: (side: Side) => Promise<void>;
  formatBoth: () => Promise<void>;
  copyHunk: (index: number, dir: MergeDir) => void;
  copyAll: (dir: MergeDir) => void;
  undo: () => void;
  gotoHunk: (index: number) => void;
  nextHunk: (dir: 1 | -1) => void;
  run: () => Promise<void>;
}

export const effectiveLanguage = (s: CompareState): Language | null =>
  s.language ?? s.result?.language ?? s.detectedLanguage;

export const canMerge = (s: CompareState) => !!s.result && s.rev === s.resultRev && s.status !== "running";

let requestSeq = 0;
const UNDO_LIMIT = 100;

export const useCompareStore = create<CompareState>()((set, get) => {
  /** Apply a text-changing patch; optionally record an undo snapshot first. */
  const edit = (patch: Partial<CompareState>, undoable = false) =>
    set((s) => ({
      ...patch,
      rev: s.rev + 1,
      undoStack: undoable ? [...s.undoStack, { left: s.left.text, right: s.right.text }].slice(-UNDO_LIMIT) : s.undoStack,
    }));

  const sideText = (side: Side, text: string): Partial<CompareState> => ({ [side]: { ...get()[side], text } }) as Partial<CompareState>;

  const resolveLanguage = async (): Promise<Language | null> => {
    const s = get();
    return effectiveLanguage(s) ?? (await detectLanguage(s.left, s.right).catch(() => null));
  };

  return {
    left: emptyDoc(),
    right: emptyDoc(),
    options: { ...DEFAULT_OPTIONS, ...prefs.options },
    language: null,
    detectedLanguage: null,
    algorithm: prefs.algorithm,
    format: { ...DEFAULT_FORMAT, ...prefs.format },
    autoFormat: prefs.autoFormat,
    syntaxColors: prefs.syntaxColors,
    panelOpen: prefs.panelOpen,
    panelWidth: Math.min(PANEL_MAX_W, Math.max(PANEL_MIN_W, prefs.panelWidth || PANEL_DEFAULT_W)),
    formatting: { left: false, right: false },
    result: null,
    status: "idle",
    error: null,
    rev: 0,
    resultRev: -1,
    undoStack: [],
    activeHunk: -1,
    navTick: 0,

    setText: (side, text) => {
      if (get()[side].text !== text) edit(sideText(side, text));
    },

    openFile: async (side, path) => {
      try {
        const chosen = path ?? (await pickFile());
        if (!chosen) return;
        const file = await readTextFile(chosen);
        edit({ [side]: { text: file.text, path: file.path, name: file.name, lossy: file.lossy } } as Partial<CompareState>, true);
        if (get().autoFormat) void get().formatSide(side);
      } catch (e) {
        set({ status: "error", error: errorMessage(e) });
      }
    },

    clear: (side) => edit({ [side]: emptyDoc() } as Partial<CompareState>, true),

    swap: () => edit({ left: get().right, right: get().left }),

    setOption: (key, value) => set((s) => ({ options: { ...s.options, [key]: value } })),
    applyPreset: (preset) => set((s) => ({ options: { ...s.options, ...PRESETS[preset] } })),
    setLanguage: (language) => set({ language }),
    setAlgorithm: (algorithm) => set({ algorithm }),
    handlePaste: (side) => {
      if (get().autoFormat) void get().formatSide(side);
    },
    setFormat: (key, value) => set((s) => ({ format: { ...s.format, [key]: value } })),
    setAutoFormat: (autoFormat) => {
      set({ autoFormat });
      if (autoFormat) void get().formatBoth();
    },
    setSyntaxColors: (syntaxColors) => set({ syntaxColors }),
    setPanelOpen: (panelOpen) => set({ panelOpen }),
    setPanelWidth: (w) => set({ panelWidth: Math.min(PANEL_MAX_W, Math.max(PANEL_MIN_W, Math.round(w))) }),

    formatSide: async (side) => {
      const lang = await resolveLanguage();
      if (!get()[side].text.trim()) return;
      if (!lang || !formatterLabel(lang)) {
        set({ status: "error", error: `No formatter for ${lang ?? "plain text"} — pick a language in the toolbar` });
        return;
      }
      set((s) => ({ formatting: { ...s.formatting, [side]: true } }));
      try {
        const before = get()[side].text;
        const out = await formatCode(before, lang, get().format);
        if (out !== before && get()[side].text === before) edit(sideText(side, out), true);
      } catch (e) {
        set({ status: "error", error: `Format ${side} failed: ${errorMessage(e)}` });
      } finally {
        set((s) => ({ formatting: { ...s.formatting, [side]: false } }));
      }
    },

    formatBoth: async () => {
      await Promise.all([get().formatSide("left"), get().formatSide("right")]);
    },

    copyHunk: (index, dir) => {
      const s = get();
      if (!canMerge(s)) return;
      const hunk = s.result!.hunks[index];
      if (!hunk) return;
      const ranges = hunkRanges(s.result!.rows, hunk);
      const [from, to]: [Side, Side] = dir === "toRight" ? ["left", "right"] : ["right", "left"];
      const lines = replaceBlock(s.result![to].lines, ranges[to], s.result![from].lines, ranges[from]);
      edit({ ...sideText(to, joinLines(lines, s[to].text)), activeHunk: index }, true);
    },

    copyAll: (dir) => {
      const s = get();
      if (!s.result) return;
      const [from, to]: [Side, Side] = dir === "toRight" ? ["left", "right"] : ["right", "left"];
      edit(sideText(to, joinLines(s.result[from].lines, s[from].text)), true);
    },

    undo: () => {
      const s = get();
      const snap = s.undoStack[s.undoStack.length - 1];
      if (!snap) return;
      set({
        left: { ...s.left, text: snap.left },
        right: { ...s.right, text: snap.right },
        undoStack: s.undoStack.slice(0, -1),
        rev: s.rev + 1,
      });
    },

    gotoHunk: (index) => {
      const hunks = get().result?.hunks ?? [];
      if (!hunks.length) return;
      const i = Math.max(0, Math.min(hunks.length - 1, index));
      set((s) => ({ activeHunk: i, navTick: s.navTick + 1 }));
    },

    nextHunk: (dir) => {
      const { activeHunk, result } = get();
      const n = result?.hunks.length ?? 0;
      if (!n) return;
      get().gotoHunk(activeHunk < 0 ? (dir > 0 ? 0 : n - 1) : (activeHunk + dir + n) % n);
    },

    run: async () => {
      const id = ++requestSeq;
      const { left, right, options, language, algorithm, rev } = get();
      set({ status: "running" });
      try {
        const result = await compareTexts({
          left: { text: left.text, path: left.path },
          right: { text: right.text, path: right.path },
          options,
          language,
          algorithm,
        });
        if (id !== requestSeq) return; // superseded by a newer request
        set((s) => ({
          result,
          resultRev: rev,
          detectedLanguage: result.language,
          status: "idle",
          error: null,
          activeHunk: Math.min(s.activeHunk, result.hunks.length - 1),
        }));
      } catch (e) {
        if (id !== requestSeq) return;
        set({ status: "error", error: errorMessage(e) });
      }
    },
  };
});

// Persist preferences.
useCompareStore.subscribe((s, p) => {
  if (
    s.options !== p.options ||
    s.algorithm !== p.algorithm ||
    s.format !== p.format ||
    s.autoFormat !== p.autoFormat ||
    s.syntaxColors !== p.syntaxColors ||
    s.panelOpen !== p.panelOpen ||
    s.panelWidth !== p.panelWidth
  ) {
    saveJSON(PREFS_KEY, {
      options: s.options,
      algorithm: s.algorithm,
      format: s.format,
      autoFormat: s.autoFormat,
      syntaxColors: s.syntaxColors,
      panelOpen: s.panelOpen,
      panelWidth: s.panelWidth,
    } satisfies Prefs);
  }
});

/** Inputs that should trigger a recompute when they change. */
export const compareInputsChanged = (s: CompareState, p: CompareState) =>
  s.rev !== p.rev ||
  s.left.path !== p.left.path ||
  s.right.path !== p.right.path ||
  s.options !== p.options ||
  s.language !== p.language ||
  s.algorithm !== p.algorithm;
