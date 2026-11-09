import { lazy, type ComponentType, type LazyExoticComponent } from "react";
import { FileText, GitCompareArrows, Wrench, type LucideIcon } from "lucide-react";

/**
 * Plugin registry. A tool = one entry here + one folder under `src/modules/<id>/`
 * (+ optionally `src-tauri/src/commands/<id>.rs`). Modules are code-split with
 * React.lazy so startup only pays for the shell and the first visible tab.
 */
export interface ToolModule {
  id: string;
  title: string;
  description: string;
  icon: LucideIcon;
  status: "ready" | "planned";
  component: LazyExoticComponent<ComponentType>;
}

export const modules: ToolModule[] = [
  {
    id: "compare",
    title: "Code Compare",
    description: "Normalize, diff and merge code",
    icon: GitCompareArrows,
    status: "ready",
    component: lazy(() => import("./compare/CompareView")),
  },
  {
    id: "convert",
    title: "Markdown ⇄ Word",
    description: "Convert .md ⇄ .docx, keeping formatting and images",
    icon: FileText,
    status: "ready",
    component: lazy(() => import("./convert/ConvertView")),
  },
  {
    id: "toolbox",
    title: "Dev Toolbox",
    description: "JSON, JWT, Base64, Hash, Regex, UUID…",
    icon: Wrench,
    status: "ready",
    component: lazy(() => import("./toolbox/ToolboxView")),
  },
];
