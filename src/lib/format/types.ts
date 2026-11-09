export interface FormatSettings {
  indent: 2 | 4;
  useTabs: boolean;
  printWidth: 80 | 100 | 120;
  keywordCase: "upper" | "lower" | "preserve";
  sortJsonKeys: boolean;
}

export const DEFAULT_FORMAT: FormatSettings = {
  indent: 2,
  useTabs: false,
  printWidth: 100,
  keywordCase: "upper",
  sortJsonKeys: false,
};

export interface FormatRequest {
  id: number;
  text: string;
  language: string;
  settings: FormatSettings;
}

export type FormatResponse = { id: number; ok: true; text: string } | { id: number; ok: false; error: string };
