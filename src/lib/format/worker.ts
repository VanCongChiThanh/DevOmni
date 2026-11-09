/// <reference lib="webworker" />
import { ENGINES } from "./engines";
import type { FormatRequest, FormatResponse } from "./types";

self.onmessage = async (e: MessageEvent<FormatRequest>) => {
  const { id, text, language, settings } = e.data;
  let res: FormatResponse;
  try {
    const engine = ENGINES[language];
    if (!engine) throw new Error(`No formatter for ${language}`);
    res = { id, ok: true, text: await engine.run(text, settings) };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res = { id, ok: false, error: msg.split("\n").slice(0, 3).join(" ") };
  }
  (self as unknown as Worker).postMessage(res);
};
