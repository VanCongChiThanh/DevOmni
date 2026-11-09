import { useEffect, type RefObject } from "react";
import { isTauri } from "@/lib/tauri";
import { compareInputsChanged, useCompareStore } from "./store";

/** Recompute the diff (debounced) whenever texts, paths or options change. */
export function useAutoCompare() {
  useEffect(() => {
    let timer: number | undefined;
    const schedule = () => {
      window.clearTimeout(timer);
      const { left, right } = useCompareStore.getState();
      const size = left.text.length + right.text.length;
      timer = window.setTimeout(
        () => {
          const s = useCompareStore.getState();
          if (s.left.text || s.right.text) void s.run();
          else useCompareStore.setState({ result: null, error: null, status: "idle" });
        },
        size > 1_000_000 ? 400 : 120,
      );
    };
    const unsubscribe = useCompareStore.subscribe((s, prev) => {
      if (compareInputsChanged(s, prev)) schedule();
    });
    schedule();
    return () => {
      unsubscribe();
      window.clearTimeout(timer);
    };
  }, []);
}

/** The module stays mounted when another tab is active; only react when visible. */
const isVisible = (ref: RefObject<HTMLElement>) => !!ref.current && ref.current.offsetParent !== null;

/**
 * F7 / Shift+F7 or Alt+↓ / Alt+↑: next/prev change.
 * Alt+→ / Alt+←: copy the current change block right / left.
 * Ctrl+Z outside an editor: undo the last merge/format (inside, the editor's own undo).
 */
export function useCompareShortcuts(rootRef: RefObject<HTMLElement>) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!isVisible(rootRef)) return;
      const s = useCompareStore.getState();
      const inEditor = (e.target as HTMLElement | null)?.closest?.(".cm-editor, input, select, textarea");
      if (e.altKey && (e.key === "ArrowRight" || e.key === "ArrowLeft")) {
        if (s.activeHunk < 0) return;
        e.preventDefault();
        s.copyHunk(s.activeHunk, e.key === "ArrowRight" ? "toRight" : "toLeft");
      } else if (e.key === "F7" || (e.altKey && (e.key === "ArrowDown" || e.key === "ArrowUp"))) {
        e.preventDefault();
        s.nextHunk(e.shiftKey || e.key === "ArrowUp" ? -1 : 1);
      } else if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === "b") {
        e.preventDefault();
        s.setPanelOpen(!s.panelOpen);
      } else if (!inEditor && (e.ctrlKey || e.metaKey) && !e.shiftKey && e.key.toLowerCase() === "z") {
        e.preventDefault();
        s.undo();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [rootRef]);
}

/** OS drag-and-drop: drop on the left/right half, or drop two files at once. */
export function useFileDrop(rootRef: RefObject<HTMLElement>) {
  useEffect(() => {
    if (!isTauri()) return;
    let unlisten: (() => void) | undefined;
    let disposed = false;

    void import("@tauri-apps/api/webview")
      .then(({ getCurrentWebview }) =>
        getCurrentWebview().onDragDropEvent((event) => {
          if (event.payload.type !== "drop" || !isVisible(rootRef)) return;
          const { paths, position } = event.payload;
          if (!paths.length) return;
          const store = useCompareStore.getState();
          if (paths.length >= 2) {
            void store.openFile("left", paths[0]);
            void store.openFile("right", paths[1]);
            return;
          }
          const x = position.x / window.devicePixelRatio;
          const rect = rootRef.current!.getBoundingClientRect();
          void store.openFile(x < rect.left + rect.width / 2 ? "left" : "right", paths[0]);
        }),
      )
      .then((fn) => {
        if (disposed) fn();
        else unlisten = fn;
      });

    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [rootRef]);
}
