import { useMemo, useState, type ComponentType } from "react";
import clsx from "clsx";
import {
  Binary,
  Braces,
  CaseSensitive,
  Clock,
  Fingerprint,
  Hash,
  KeyRound,
  Regex,
  Search,
  Shuffle,
  type LucideIcon,
} from "lucide-react";
import JsonTool from "./tools/JsonTool";
import JwtTool from "./tools/JwtTool";
import EncodeTool from "./tools/EncodeTool";
import HashTool from "./tools/HashTool";
import TimeTool from "./tools/TimeTool";
import UuidTool from "./tools/UuidTool";
import RegexTool from "./tools/RegexTool";
import CaseTool from "./tools/CaseTool";
import BaseTool from "./tools/BaseTool";

interface Tool {
  id: string;
  name: string;
  hint: string;
  icon: LucideIcon;
  keywords: string;
  component: ComponentType;
}

const TOOLS: Tool[] = [
  { id: "json", name: "JSON", hint: "Format, minify, validate", icon: Braces, keywords: "pretty beautify minify validate sort", component: JsonTool },
  { id: "jwt", name: "JWT", hint: "Decode & verify tokens", icon: KeyRound, keywords: "token bearer decode verify signature", component: JwtTool },
  { id: "encode", name: "Encode / Decode", hint: "Base64, URL, HTML, Hex", icon: Binary, keywords: "base64 url html entity hex escape", component: EncodeTool },
  { id: "hash", name: "Hash", hint: "MD5, SHA, HMAC", icon: Fingerprint, keywords: "md5 sha1 sha256 sha512 hmac checksum", component: HashTool },
  { id: "time", name: "Timestamp", hint: "Unix ⇄ date", icon: Clock, keywords: "unix epoch date time iso oracle", component: TimeTool },
  { id: "uuid", name: "UUID & Random", hint: "UUID v4/v7, passwords", icon: Shuffle, keywords: "guid uuid random password generate", component: UuidTool },
  { id: "regex", name: "Regex", hint: "Test & replace", icon: Regex, keywords: "regular expression match replace", component: RegexTool },
  { id: "case", name: "Case", hint: "camel, snake, CONSTANT…", icon: CaseSensitive, keywords: "camel snake kebab pascal upper lower slug diacritics", component: CaseTool },
  { id: "base", name: "Number base", hint: "Dec, Hex, Oct, Bin", icon: Hash, keywords: "hex binary octal decimal radix", component: BaseTool },
];

const KEY = "devomni.toolbox.tool";

export default function ToolboxView() {
  const [active, setActive] = useState(() => {
    try {
      return localStorage.getItem(KEY) ?? "json";
    } catch {
      return "json";
    }
  });
  // Visited tools stay mounted so their input survives switching (never persisted:
  // tokens and secrets pasted here don't touch disk).
  const [visited, setVisited] = useState<Set<string>>(() => new Set([active]));
  const [query, setQuery] = useState("");

  const open = (id: string) => {
    setActive(id);
    setVisited((v) => (v.has(id) ? v : new Set(v).add(id)));
    try {
      localStorage.setItem(KEY, id);
    } catch {
      /* ignore */
    }
  };

  const list = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? TOOLS.filter((t) => `${t.name} ${t.hint} ${t.keywords}`.toLowerCase().includes(q)) : TOOLS;
  }, [query]);
  const current = TOOLS.find((t) => t.id === active) ?? TOOLS[0];

  return (
    <div className="flex h-full">
      <nav className="flex w-56 shrink-0 flex-col border-r border-line bg-surface-1">
        <div className="p-2.5">
          <div className="flex h-8 items-center gap-2 rounded-md border border-line bg-surface-0 px-2 focus-within:border-accent/60">
            <Search size={13} className="text-fg-faint" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && list[0] && open(list[0].id)}
              placeholder="Find a tool…"
              className="selectable min-w-0 flex-1 bg-transparent text-[12.5px] text-fg outline-none placeholder:text-fg-faint"
            />
          </div>
        </div>
        <ul className="flex-1 overflow-y-auto px-1.5 pb-2">
          {list.map((t) => (
            <li key={t.id}>
              <button
                onClick={() => open(t.id)}
                className={clsx(
                  "flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left transition-colors",
                  t.id === current.id ? "bg-surface-3 text-fg" : "text-fg-muted hover:bg-surface-2 hover:text-fg",
                )}
              >
                <t.icon size={15} strokeWidth={1.75} className={t.id === current.id ? "text-accent" : ""} />
                <span className="min-w-0">
                  <span className="block truncate text-[12.5px] font-medium">{t.name}</span>
                  <span className="block truncate text-[11px] text-fg-faint">{t.hint}</span>
                </span>
              </button>
            </li>
          ))}
          {!list.length && <li className="px-2 py-3 text-[12px] text-fg-faint">No tool matches “{query}”</li>}
        </ul>
      </nav>

      <main className="relative min-w-0 flex-1">
        {TOOLS.filter((t) => visited.has(t.id)).map((t) => (
          <section key={t.id} className={clsx("absolute inset-0 flex flex-col px-6 py-5", t.id !== current.id && "hidden")}>
            <header className="mb-4 flex items-baseline gap-2">
              <h1 className="text-[15px] font-semibold text-fg">{t.name}</h1>
              <span className="text-[12px] text-fg-faint">{t.hint}</span>
            </header>
            <div className="min-h-0 flex-1">
              <t.component />
            </div>
          </section>
        ))}
      </main>
    </div>
  );
}
