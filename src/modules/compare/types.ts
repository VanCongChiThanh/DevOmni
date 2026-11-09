// Mirrors the serde types in crates/devomni-core. Keep in sync.
// (Later: generate with `ts-rs` / `specta` to make drift impossible.)

export type Language =
  | "plain" | "javascript" | "typescript" | "json" | "rust" | "c" | "cpp" | "csharp"
  | "java" | "go" | "kotlin" | "swift" | "php" | "python" | "ruby" | "shell" | "yaml"
  | "toml" | "sql" | "plsql" | "html" | "xml" | "css" | "scss" | "markdown";

export const LANGUAGES: Language[] = [
  "plain", "javascript", "typescript", "json", "rust", "c", "cpp", "csharp", "java", "go",
  "kotlin", "swift", "php", "python", "ruby", "shell", "yaml", "toml", "sql", "plsql", "html", "xml",
  "css", "scss", "markdown",
];

export type DiffAlgorithm = "myers" | "patience";

export interface NormalizeOptions {
  trimTrailingWhitespace: boolean;
  ignoreIndentation: boolean;
  collapseWhitespace: boolean;
  ignoreAllWhitespace: boolean;
  tabWidth: number | null;
  ignoreCase: boolean;
  ignoreBlankLines: boolean;
  stripComments: boolean;
  sortJsonKeys: boolean;
}

export interface SideInput {
  text: string;
  path: string | null;
}

export interface CompareRequest {
  left: SideInput;
  right: SideInput;
  options: NormalizeOptions;
  language: Language | null;
  algorithm: DiffAlgorithm;
}

export type RowKind = "equal" | "similar" | "changed" | "deleted" | "inserted" | "ignored";
/** [start, end) in UTF-16 code units */
export type Span = [number, number];

export interface Row {
  kind: RowKind;
  left?: number;
  right?: number;
  leftSpans?: Span[];
  rightSpans?: Span[];
}

export interface Hunk {
  start: number;
  end: number;
}

export interface DiffStats {
  added: number;
  removed: number;
  changed: number;
  hunks: number;
}

export interface Note {
  level: "info" | "warn";
  message: string;
}

export interface SideOutput {
  lines: string[];
  rewritten: boolean;
  notes: Note[];
  comparedLines: number;
}

export interface CompareResponse {
  language: Language;
  left: SideOutput;
  right: SideOutput;
  rows: Row[];
  hunks: Hunk[];
  stats: DiffStats;
  timedOut: boolean;
  elapsedMs: number;
}

export interface LoadedFile {
  path: string;
  name: string;
  text: string;
  language: Language;
  size: number;
  lossy: boolean;
}

export type Side = "left" | "right";
