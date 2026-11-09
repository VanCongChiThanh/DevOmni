import { AlertTriangle } from "lucide-react";
import { useCompareStore } from "../store";

export function StatusBar() {
  const result = useCompareStore((s) => s.result);
  const error = useCompareStore((s) => (s.status === "error" ? s.error : null));

  return (
    <footer className="flex h-6 shrink-0 items-center gap-4 border-t border-line bg-surface-1 px-3 text-[11px] text-fg-muted">
      {error ? (
        <span className="flex min-w-0 items-center gap-1.5 truncate text-red-400" title={error}>
          <AlertTriangle size={12} className="shrink-0" /> {error}
        </span>
      ) : result ? (
        <>
          <span className="tabular-nums">
            <span className="text-green-400">+{result.stats.added}</span>{" "}
            <span className="text-red-400">−{result.stats.removed}</span>{" "}
            <span className="text-amber-400">~{result.stats.changed}</span>
          </span>
          <span>{result.stats.hunks} change blocks</span>
          {result.timedOut && (
            <span className="flex items-center gap-1 text-amber-400" title="Diff deadline reached; result is valid but may not be minimal">
              <AlertTriangle size={12} /> approximate
            </span>
          )}
        </>
      ) : (
        <span>Ready</span>
      )}
      <div className="flex-1" />
      {result && (
        <>
          <span>
            compared {result.left.comparedLines}/{result.left.lines.length} ↔ {result.right.comparedLines}/{result.right.lines.length} lines
          </span>
          <span>{result.language}</span>
          <span className="tabular-nums">{result.elapsedMs.toFixed(1)} ms</span>
        </>
      )}
    </footer>
  );
}
