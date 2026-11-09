import { Suspense, useState } from "react";
import * as Tooltip from "@radix-ui/react-tooltip";
import clsx from "clsx";
import { Monitor, Moon, Sun } from "lucide-react";
import { modules } from "@/modules/registry";
import { useTheme } from "@/lib/theme";

export function App() {
  const [active, setActive] = useState(modules[0].id);
  // Keep visited modules mounted so switching tabs preserves their state.
  const [visited, setVisited] = useState<Set<string>>(() => new Set([modules[0].id]));

  const open = (id: string) => {
    setActive(id);
    setVisited((v) => (v.has(id) ? v : new Set(v).add(id)));
  };

  return (
    <Tooltip.Provider delayDuration={300}>
      <div className="flex h-full overflow-hidden">
        <nav className="flex w-12 shrink-0 flex-col items-center gap-1 border-r border-line bg-surface-1 py-2">
          <div className="mb-2 flex h-8 w-8 items-center justify-center rounded-lg bg-accent/15 text-[11px] font-bold text-accent">
            DO
          </div>
          {modules.map((m) => (
            <Tooltip.Root key={m.id}>
              <Tooltip.Trigger asChild>
                <button
                  onClick={() => open(m.id)}
                  aria-label={m.title}
                  className={clsx(
                    "flex h-9 w-9 items-center justify-center rounded-lg transition-colors",
                    active === m.id ? "bg-surface-3 text-fg" : "text-fg-faint hover:bg-surface-2 hover:text-fg-muted",
                  )}
                >
                  <m.icon size={18} strokeWidth={1.75} />
                </button>
              </Tooltip.Trigger>
              <Tooltip.Portal>
                <Tooltip.Content
                  side="right"
                  sideOffset={8}
                  className="rounded-md border border-line bg-surface-2 px-2.5 py-1.5 text-xs shadow-lg"
                >
                  <div className="font-medium text-fg">{m.title}</div>
                  <div className="text-fg-muted">{m.description}</div>
                </Tooltip.Content>
              </Tooltip.Portal>
            </Tooltip.Root>
          ))}
          <ThemeToggle />
        </nav>

        <main className="relative min-w-0 flex-1 overflow-hidden">
          {modules
            .filter((m) => visited.has(m.id))
            .map((m) => (
              <section key={m.id} className={clsx("absolute inset-0 overflow-hidden", active !== m.id && "hidden")}>
                <Suspense fallback={null}>
                  <m.component />
                </Suspense>
              </section>
            ))}
        </main>
      </div>
    </Tooltip.Provider>
  );
}

const THEME_META = {
  system: { icon: Monitor, label: "Theme: System" },
  light: { icon: Sun, label: "Theme: Light" },
  dark: { icon: Moon, label: "Theme: Dark" },
} as const;

function ThemeToggle() {
  const { pref, cycle } = useTheme();
  const { icon: Icon, label } = THEME_META[pref];
  return (
    <Tooltip.Root>
      <Tooltip.Trigger asChild>
        <button
          onClick={cycle}
          aria-label={label}
          className="mt-auto flex h-9 w-9 items-center justify-center rounded-lg text-fg-faint transition-colors hover:bg-surface-2 hover:text-fg-muted"
        >
          <Icon size={17} strokeWidth={1.75} />
        </button>
      </Tooltip.Trigger>
      <Tooltip.Portal>
        <Tooltip.Content
          side="right"
          sideOffset={8}
          className="rounded-md border border-line bg-surface-2 px-2.5 py-1.5 text-xs text-fg shadow-lg"
        >
          {label} <span className="text-fg-faint">· click to switch</span>
        </Tooltip.Content>
      </Tooltip.Portal>
    </Tooltip.Root>
  );
}
