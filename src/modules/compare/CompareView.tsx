import { useRef } from "react";
import { useCompareStore } from "./store";
import { useAutoCompare, useCompareShortcuts, useFileDrop } from "./hooks";
import { Toolbar } from "./components/Toolbar";
import { SourceHeaders } from "./components/SourceHeaders";
import { MergeView } from "./components/MergeView";
import { NormalizePanel } from "./components/NormalizePanel";
import { StatusBar } from "./components/StatusBar";

export default function CompareView() {
  const rootRef = useRef<HTMLDivElement>(null);
  const syntaxColors = useCompareStore((s) => s.syntaxColors);
  const panelOpen = useCompareStore((s) => s.panelOpen);

  useAutoCompare();
  useCompareShortcuts(rootRef);
  useFileDrop(rootRef);

  return (
    <div ref={rootRef} className={`flex h-full flex-col ${syntaxColors ? "syntax-on" : "syntax-off"}`}>
      <Toolbar />
      <div className="flex min-h-0 flex-1 overflow-hidden">
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          <SourceHeaders />
          <div className="relative min-h-0 flex-1 overflow-hidden"><MergeView /></div>
          <StatusBar />
        </div>
        {panelOpen && <NormalizePanel />}
      </div>
    </div>
  );
}
