import { invoke } from "@/lib/tauri";
import type { CompareRequest, CompareResponse, Language, LoadedFile, SideInput } from "./types";

export const compareTexts = (request: CompareRequest) => invoke<CompareResponse>("compare_texts", { request });

export const readTextFile = (path: string) => invoke<LoadedFile>("read_text_file", { path });

export const detectLanguage = (left: SideInput, right: SideInput) =>
  invoke<Language>("detect_language_cmd", {
    left: { text: left.text, path: left.path },
    right: { text: right.text, path: right.path },
  });

export async function pickFile(): Promise<string | null> {
  const { open } = await import("@tauri-apps/plugin-dialog");
  const picked = await open({ multiple: false, directory: false, title: "Open file to compare" });
  return typeof picked === "string" ? picked : null;
}
