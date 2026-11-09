import { Channel } from "@tauri-apps/api/core";
import { invoke } from "@/lib/tauri";

export type Target = "md" | "docx" | "pdf" | "odt" | "rtf" | "html" | "epub" | "pptx" | "latex";

export interface PandocInfo {
  path: string;
  version: string;
  bundled: boolean;
}

export interface TargetInfo {
  id: Target;
  label: string;
  ext: string;
  available: boolean;
}

export interface Caps {
  pandoc: PandocInfo | null;
  office: string | null;
  inputs: string[];
  targets: TargetInfo[];
}

export interface ConvertRequest {
  input: string;
  outputDir: string | null;
  referenceDoc: string | null;
  target: Target | null;
}

/** Mirror of `devomni_core::convert::ConvertReport`. */
export interface ConvertReport {
  input: string;
  output: string;
  from: string;
  to: Target;
  mediaDir: string | null;
  words: number;
  textKept: number;
  missingWords: string[];
  imagesIn: number;
  imagesOut: number;
  verified: boolean;
  warnings: string[];
  millis: number;
}

export interface AiModel {
  id: string;
  label: string;
}

export const converterCaps = () => invoke<Caps>("converter_caps");

export interface EngineProgress {
  downloaded: number;
  total: number | null;
  stage: "download" | "verify" | "install";
}
/** Download Pandoc once into the app's data folder (keeps the installer small). */
export function installPandoc(onProgress: (p: EngineProgress) => void) {
  const channel = new Channel<EngineProgress>();
  channel.onmessage = onProgress;
  return invoke<string>("install_pandoc", { onProgress: channel });
}
export const convertDocument = (request: ConvertRequest) => invoke<ConvertReport>("convert_document", { request });
export const openDocument = (path: string, reveal = false) => invoke<void>("open_document", { path, reveal });
export const readPdf = (path: string) => invoke<ArrayBuffer>("read_pdf", { path });
export const saveMarkdown = (input: string, outputDir: string | null, content: string) =>
  invoke<string>("save_markdown", { input, outputDir, content });
export const updateMarkdown = (path: string, content: string) => invoke<void>("update_markdown", { path, content });
export const readMarkdown = (path: string) => invoke<string>("read_markdown", { path });
export const previewDocument = (path: string) => invoke<string>("preview_document", { path });

export const aiStatus = () => invoke<{ configured: boolean }>("ai_status");
export const aiSetKey = (key: string) => invoke<AiModel[]>("ai_set_key", { key });
export const aiClearKey = () => invoke<void>("ai_clear_key");
export const aiModels = () => invoke<AiModel[]>("ai_models");
export const aiOcrPage = (image: string, mime: string, model: string) => invoke<string>("ai_ocr_page", { image, mime, model });
export const openAiStudio = () => invoke<void>("open_ai_studio");

export const fileName = (path: string) => path.split(/[\\/]/).pop() ?? path;
export const extOf = (path: string) => (/\.([^.\\/]+)$/.exec(path)?.[1] ?? "").toLowerCase();
export const isMarkdown = (path: string) => /^(md|markdown|mdown|mkdn?)$/.test(extOf(path));
export const isPdf = (path: string) => extOf(path) === "pdf";
/** Outputs Pandoc can render for the preview pane. */
export const canPreview = (path: string) => /^(md|markdown|docx|odt|html?|epub|pptx|rtf)$/.test(extOf(path));

export async function pickDocuments(extensions: string[]): Promise<string[]> {
  const { open } = await import("@tauri-apps/plugin-dialog");
  const picked = await open({
    multiple: true,
    title: "Choose documents",
    filters: [{ name: "Documents", extensions }],
  });
  return Array.isArray(picked) ? picked : picked ? [picked] : [];
}

export async function pickTemplate(): Promise<string | null> {
  const { open } = await import("@tauri-apps/plugin-dialog");
  const picked = await open({
    multiple: false,
    title: "Style template",
    filters: [{ name: "Word / OpenDocument / PowerPoint", extensions: ["docx", "odt", "pptx"] }],
  });
  return typeof picked === "string" ? picked : null;
}

export async function pickFolder(): Promise<string | null> {
  const { open } = await import("@tauri-apps/plugin-dialog");
  const picked = await open({ directory: true, multiple: false, title: "Save converted files to" });
  return typeof picked === "string" ? picked : null;
}
