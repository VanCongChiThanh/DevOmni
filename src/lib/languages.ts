/**
 * CodeMirror language loaders, shared by the editor and the diff highlighter.
 * Each grammar is a separate lazy chunk; startup loads none of them.
 */
import type { Language as CMLanguage, StreamParser } from "@codemirror/language";

type Loader = () => Promise<CMLanguage>;

const legacy =
  (load: () => Promise<{ mode: StreamParser<unknown> }>): Loader =>
  async () => {
    const [{ StreamLanguage }, { mode }] = await Promise.all([import("@codemirror/language"), load()]);
    return StreamLanguage.define(mode);
  };

const LOADERS: Record<string, Loader> = {
  javascript: () => import("@codemirror/lang-javascript").then((m) => m.javascriptLanguage),
  typescript: () => import("@codemirror/lang-javascript").then((m) => m.typescriptLanguage),
  json: () => import("@codemirror/lang-json").then((m) => m.jsonLanguage),
  sql: () => import("@codemirror/lang-sql").then((m) => m.StandardSQL.language),
  plsql: () => import("@codemirror/lang-sql").then((m) => m.PLSQL.language),
  python: () => import("@codemirror/lang-python").then((m) => m.pythonLanguage),
  rust: () => import("@codemirror/lang-rust").then((m) => m.rustLanguage),
  c: () => import("@codemirror/lang-cpp").then((m) => m.cppLanguage),
  cpp: () => import("@codemirror/lang-cpp").then((m) => m.cppLanguage),
  java: () => import("@codemirror/lang-java").then((m) => m.javaLanguage),
  go: () => import("@codemirror/lang-go").then((m) => m.goLanguage),
  php: () => import("@codemirror/lang-php").then((m) => m.php({ plain: true }).language),
  html: () => import("@codemirror/lang-html").then((m) => m.htmlLanguage),
  css: () => import("@codemirror/lang-css").then((m) => m.cssLanguage),
  scss: () => import("@codemirror/lang-css").then((m) => m.cssLanguage),
  xml: () => import("@codemirror/lang-xml").then((m) => m.xmlLanguage),
  markdown: () => import("@codemirror/lang-markdown").then((m) => m.markdownLanguage),
  yaml: () => import("@codemirror/lang-yaml").then((m) => m.yamlLanguage),
  shell: legacy(() => import("@codemirror/legacy-modes/mode/shell").then((m) => ({ mode: m.shell }))),
  toml: legacy(() => import("@codemirror/legacy-modes/mode/toml").then((m) => ({ mode: m.toml }))),
  ruby: legacy(() => import("@codemirror/legacy-modes/mode/ruby").then((m) => ({ mode: m.ruby }))),
  swift: legacy(() => import("@codemirror/legacy-modes/mode/swift").then((m) => ({ mode: m.swift }))),
  kotlin: legacy(() => import("@codemirror/legacy-modes/mode/clike").then((m) => ({ mode: m.kotlin }))),
  csharp: legacy(() => import("@codemirror/legacy-modes/mode/clike").then((m) => ({ mode: m.csharp }))),
};

const cache = new Map<string, Promise<CMLanguage | null>>();

export function loadLanguage(id: string | null | undefined): Promise<CMLanguage | null> {
  if (!id || !LOADERS[id]) return Promise.resolve(null);
  let p = cache.get(id);
  if (!p) {
    p = LOADERS[id]().catch(() => null);
    cache.set(id, p);
  }
  return p;
}
