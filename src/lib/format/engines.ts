/**
 * Formatter dispatch (runs inside the format worker). Every engine is bundled —
 * nothing to install — and lazy-loaded the first time its language is formatted.
 */
import type { FormatSettings } from "./types";

type Engine = (text: string, s: FormatSettings) => Promise<string>;

const prettier = (parser: string, plugins: () => Promise<unknown[]>): Engine => async (text, s) => {
  const [{ format }, loaded] = await Promise.all([import("prettier/standalone"), plugins()]);
  return format(text, {
    parser,
    plugins: loaded as never,
    tabWidth: s.indent,
    useTabs: s.useTabs,
    printWidth: s.printWidth,
  });
};

const estree = () => import("prettier/plugins/estree");
const babel = () => import("prettier/plugins/babel");

const clang = (filename: string): Engine => async (text, s) => {
  const m = await import("@wasm-fmt/clang-format/vite");
  await m.default();
  const style = `{BasedOnStyle: Google, IndentWidth: ${s.indent}, ColumnLimit: ${s.printWidth}, UseTab: ${s.useTabs ? "Always" : "Never"}}`;
  return m.format(text, filename, style);
};

const oracle = (dialect: "plsql" | "sql"): Engine => async (text, s) => {
  const { formatOracle } = await import("./plsql");
  return formatOracle(text, { ...s, dialect });
};

function sortKeys(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(sortKeys);
  if (v && typeof v === "object") {
    const o = v as Record<string, unknown>;
    return Object.fromEntries(Object.keys(o).sort().map((k) => [k, sortKeys(o[k])]));
  }
  return v;
}

export const ENGINES: Record<string, { label: string; run: Engine }> = {
  plsql: { label: "DevOmni PL/SQL + sql-formatter", run: oracle("plsql") },
  sql: { label: "sql-formatter", run: oracle("sql") },
  javascript: { label: "Prettier", run: prettier("babel", () => Promise.all([babel(), estree()])) },
  typescript: {
    label: "Prettier",
    run: prettier("typescript", () => Promise.all([import("prettier/plugins/typescript"), estree()])),
  },
  json: {
    label: "Prettier",
    run: async (text, s) => {
      const input = s.sortJsonKeys ? JSON.stringify(sortKeys(JSON.parse(text))) : text;
      return prettier("json", () => Promise.all([babel(), estree()]))(input, s);
    },
  },
  css: { label: "Prettier", run: prettier("css", () => Promise.all([import("prettier/plugins/postcss")])) },
  scss: { label: "Prettier", run: prettier("scss", () => Promise.all([import("prettier/plugins/postcss")])) },
  html: {
    label: "Prettier",
    run: prettier("html", () =>
      Promise.all([import("prettier/plugins/html"), import("prettier/plugins/postcss"), babel(), estree()]),
    ),
  },
  markdown: { label: "Prettier", run: prettier("markdown", () => Promise.all([import("prettier/plugins/markdown")])) },
  yaml: { label: "Prettier", run: prettier("yaml", () => Promise.all([import("prettier/plugins/yaml")])) },
  c: { label: "clang-format", run: clang("main.c") },
  cpp: { label: "clang-format", run: clang("main.cpp") },
  java: { label: "clang-format", run: clang("main.java") },
  csharp: { label: "clang-format", run: clang("main.cs") },
  go: {
    label: "gofmt",
    run: async (text) => {
      const m = await import("@wasm-fmt/gofmt/vite");
      await m.default();
      return m.format(text);
    },
  },
  python: {
    label: "Ruff",
    run: async (text, s) => {
      const m = await import("@wasm-fmt/ruff_fmt/vite");
      await m.default();
      return m.format(text, null, {
        indent_style: s.useTabs ? "tab" : "space",
        indent_width: s.indent === 2 ? 4 : s.indent, // PEP 8: 4 spaces
        line_width: s.printWidth,
      });
    },
  },
};
