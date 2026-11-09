import { useEffect, useState, type ReactNode, type TextareaHTMLAttributes } from "react";
import clsx from "clsx";
import * as Switch from "@radix-ui/react-switch";
import { AlertCircle, Check, Copy } from "lucide-react";

export function CopyButton({ text, className, label }: { text: string; className?: string; label?: string }) {
  const [done, setDone] = useState(false);
  useEffect(() => {
    if (!done) return;
    const t = window.setTimeout(() => setDone(false), 1200);
    return () => window.clearTimeout(t);
  }, [done]);
  return (
    <button
      type="button"
      disabled={!text}
      title={done ? "Copied" : "Copy"}
      aria-label="Copy"
      onClick={() => void navigator.clipboard.writeText(text).then(() => setDone(true))}
      className={clsx(
        "inline-flex h-6 shrink-0 items-center gap-1 rounded-md px-1.5 text-[11px] text-fg-faint transition-colors hover:bg-surface-3 hover:text-fg disabled:pointer-events-none disabled:opacity-30",
        done && "text-ok",
        className,
      )}
    >
      {done ? <Check size={13} /> : <Copy size={13} />}
      {label}
    </button>
  );
}

/** Labeled box: header row (label + actions) and a body that fills the space. */
export function Pane({
  label,
  actions,
  children,
  className,
}: {
  label: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={clsx("flex min-h-0 min-w-0 flex-col", className)}>
      <div className="flex h-7 shrink-0 items-center gap-1 px-0.5">
        <span className="text-[11px] font-semibold uppercase tracking-wide text-fg-faint">{label}</span>
        <div className="ml-auto flex items-center gap-0.5">{actions}</div>
      </div>
      {children}
    </section>
  );
}

export function TextArea({ className, ...props }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      spellCheck={false}
      autoComplete="off"
      autoCorrect="off"
      className={clsx(
        "selectable min-h-0 w-full flex-1 resize-none rounded-lg border border-line bg-surface-0 p-3 font-mono text-[12.5px] leading-relaxed text-fg outline-none placeholder:text-fg-faint focus:border-accent/60",
        className,
      )}
      {...props}
    />
  );
}

export function Input({ className, ...props }: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      spellCheck={false}
      autoComplete="off"
      className={clsx(
        "selectable h-8 min-w-0 rounded-md border border-line bg-surface-0 px-2.5 text-[12.5px] text-fg outline-none placeholder:text-fg-faint focus:border-accent/60",
        className,
      )}
      {...props}
    />
  );
}

export function Segmented<T extends string>({
  value,
  onChange,
  options,
}: {
  value: T;
  onChange: (v: T) => void;
  options: readonly (readonly [T, string])[];
}) {
  return (
    <div className="inline-flex h-7 items-center rounded-md border border-line bg-surface-2 p-0.5">
      {options.map(([id, label]) => (
        <button
          key={id}
          type="button"
          onClick={() => onChange(id)}
          className={clsx(
            "h-full whitespace-nowrap rounded px-2.5 text-[11.5px] font-medium transition-colors",
            value === id ? "bg-surface-0 text-fg shadow-sm" : "text-fg-muted hover:text-fg",
          )}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

export function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <label className="inline-flex cursor-pointer items-center gap-1.5 text-[11.5px] text-fg-muted hover:text-fg">
      <Switch.Root
        checked={checked}
        onCheckedChange={onChange}
        className="relative h-4 w-7 shrink-0 rounded-full bg-surface-3 transition-colors data-[state=checked]:bg-accent"
      >
        <Switch.Thumb className="block h-3 w-3 translate-x-0.5 rounded-full bg-white shadow transition-transform data-[state=checked]:translate-x-[14px]" />
      </Switch.Root>
      {label}
    </label>
  );
}

/** One result row: label, monospace value, copy. */
export function Row({ label, value, hint, tone }: { label: string; value: string; hint?: string; tone?: "ok" | "warn" | "err" }) {
  return (
    <div className="group flex min-h-[34px] items-center gap-3 border-b border-line/60 px-1 py-1.5 last:border-0">
      <div className="w-36 shrink-0 text-[12px] text-fg-muted">{label}</div>
      <div
        className={clsx(
          "selectable min-w-0 flex-1 whitespace-pre-wrap break-all font-mono text-[12.5px]",
          tone === "ok" ? "text-ok" : tone === "warn" ? "text-warn" : tone === "err" ? "text-err" : "text-fg",
        )}
      >
        {value || <span className="text-fg-faint">—</span>}
        {hint && <span className="ml-2 font-sans text-[11px] text-fg-faint">{hint}</span>}
      </div>
      <CopyButton text={value} className="opacity-0 group-hover:opacity-100 focus:opacity-100" />
    </div>
  );
}

export function Card({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={clsx("rounded-lg border border-line bg-surface-1 px-3 py-1", className)}>{children}</div>;
}

export function Note({ tone = "err", children }: { tone?: "err" | "warn" | "info"; children: ReactNode }) {
  return (
    <div
      className={clsx(
        "flex items-start gap-2 rounded-md px-2.5 py-1.5 text-[11.5px]",
        tone === "err" ? "bg-err/10 text-err" : tone === "warn" ? "bg-warn/10 text-fg-muted" : "bg-surface-2 text-fg-muted",
      )}
    >
      <AlertCircle size={13} className={clsx("mt-px shrink-0", tone === "warn" && "text-warn")} />
      <span className="selectable min-w-0">{children}</span>
    </div>
  );
}

export const Bar = ({ children }: { children: ReactNode }) => (
  <div className="flex shrink-0 flex-wrap items-center gap-2">{children}</div>
);
