import { invoke as tauriInvoke, type InvokeArgs } from "@tauri-apps/api/core";

/** True when running inside the Tauri webview (false in a plain browser tab). */
export const isTauri = (): boolean => typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

/** Typed invoke with a readable error when the UI is opened outside Tauri. */
export async function invoke<T>(cmd: string, args?: InvokeArgs): Promise<T> {
  if (!isTauri()) {
    throw new Error(`"${cmd}" needs the Rust backend — run the app with \`npm run tauri dev\`.`);
  }
  return tauriInvoke<T>(cmd, args);
}

export const errorMessage = (e: unknown): string =>
  e instanceof Error ? e.message : typeof e === "string" ? e : JSON.stringify(e);
