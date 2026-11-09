import { useEffect, useRef } from "react";
import { Compartment, EditorState, type Extension } from "@codemirror/state";
import {
  EditorView,
  drawSelection,
  highlightActiveLineGutter,
  highlightSpecialChars,
  keymap,
  lineNumbers,
  placeholder as placeholderExt,
} from "@codemirror/view";
import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import { bracketMatching, syntaxHighlighting } from "@codemirror/language";
import { highlightSelectionMatches, search, searchKeymap } from "@codemirror/search";
import { classHighlighter } from "@lezer/highlight";
import { loadLanguage } from "@/lib/languages";
import { useTheme } from "@/lib/theme";
import { PAD_Y, ROW_H } from "../diffDecorations";

const theme = EditorView.theme(
  {
    "&": { height: "100%", backgroundColor: "rgb(var(--surface-0))", color: "rgb(var(--fg))", fontSize: "12.5px" },
    "&.cm-focused": { outline: "none" },
    ".cm-scroller": { fontFamily: '"JetBrains Mono", "Cascadia Code", Consolas, monospace', lineHeight: `${ROW_H}px` },
    ".cm-content": { caretColor: "rgb(var(--accent))", padding: `${PAD_Y}px 0` },
    ".cm-line": { lineHeight: `${ROW_H}px`, padding: "0 8px" },
    ".cm-gutters": { backgroundColor: "rgb(var(--surface-0))", color: "rgb(var(--fg-faint))", border: "none" },
    ".cm-gutterElement": { lineHeight: `${ROW_H}px` },
    ".cm-activeLineGutter": { backgroundColor: "transparent", color: "rgb(var(--fg))" },
    ".cm-selectionBackground, &.cm-focused .cm-selectionBackground, ::selection": {
      backgroundColor: "rgb(var(--accent) / 0.3) !important",
    },
    ".cm-cursor": { borderLeftColor: "rgb(var(--accent))" },
    ".cm-placeholder": { color: "rgb(var(--fg-faint))" },
    ".cm-matchingBracket": { backgroundColor: "rgb(var(--accent) / 0.25)", outline: "none" },
    ".cm-selectionMatch": { backgroundColor: "rgb(var(--fg) / 0.1)" },
    ".cm-panels": { backgroundColor: "rgb(var(--surface-2))", color: "rgb(var(--fg))" },
    ".cm-searchMatch": { backgroundColor: "rgb(var(--chg) / 0.35)" },
  },
);

/** Alt+arrows are DevOmni shortcuts (next/prev change, copy block), so drop CodeMirror's. */
const keys = defaultKeymap.filter((b) => !/^Alt-Arrow/.test(b.key ?? ""));

interface Props {
  value: string;
  onChange: (value: string) => void;
  language: string | null;
  placeholder?: string;
  extensions?: Extension[];
  onView?: (view: EditorView | null) => void;
  onPaste?: () => void;
}

/**
 * CodeMirror 6 editor. Text is never transformed on input: paste keeps tabs,
 * spaces and indentation exactly; only explicit Format actions change it.
 */
export function CodeEditor({ value, onChange, language, placeholder, extensions, onView, onPaste }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  const langSlot = useRef(new Compartment());
  const darkSlot = useRef(new Compartment());
  const appTheme = useTheme((t) => t.theme);
  const cb = useRef({ onChange, onPaste, onView });
  cb.current = { onChange, onPaste, onView };

  useEffect(() => {
    const v = new EditorView({
      parent: host.current!,
      state: EditorState.create({
        doc: value,
        extensions: [
          lineNumbers(),
          highlightActiveLineGutter(),
          highlightSpecialChars(),
          history(),
          drawSelection(),
          bracketMatching(),
          highlightSelectionMatches(),
          search({ top: true }),
          syntaxHighlighting(classHighlighter),
          EditorState.tabSize.of(4),
          keymap.of([...keys, ...historyKeymap, ...searchKeymap, indentWithTab]),
          placeholderExt(placeholder ?? ""),
          theme,
          darkSlot.current.of(EditorView.darkTheme.of(useTheme.getState().theme === "dark")),
          langSlot.current.of([]),
          extensions ?? [],
          EditorView.domEventHandlers({
            paste: () => {
              // Let CodeMirror insert the text first, then notify.
              window.setTimeout(() => cb.current.onPaste?.(), 0);
              return false;
            },
          }),
          EditorView.updateListener.of((u) => {
            if (u.docChanged) cb.current.onChange(u.state.doc.toString());
          }),
        ],
      }),
    });
    view.current = v;
    cb.current.onView?.(v);
    return () => {
      cb.current.onView?.(null);
      v.destroy();
      view.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // External changes (open file, format, merge, undo): apply only the part that
  // changed, so cursor, scroll position and editor undo history are preserved.
  useEffect(() => {
    const v = view.current;
    if (!v) return;
    const cur = v.state.doc.toString();
    const next = value.replace(/\r\n?/g, "\n");
    if (cur === next) return;
    const max = Math.min(cur.length, next.length);
    let a = 0;
    while (a < max && cur.charCodeAt(a) === next.charCodeAt(a)) a++;
    let b = 0;
    while (b < max - a && cur.charCodeAt(cur.length - 1 - b) === next.charCodeAt(next.length - 1 - b)) b++;
    v.dispatch({ changes: { from: a, to: cur.length - b, insert: next.slice(a, next.length - b) } });
  }, [value]);

  // CodeMirror's built-in widgets (search panel, tooltips) pick light/dark defaults from this facet.
  useEffect(() => {
    view.current?.dispatch({ effects: darkSlot.current.reconfigure(EditorView.darkTheme.of(appTheme === "dark")) });
  }, [appTheme]);

  useEffect(() => {
    let cancelled = false;
    void loadLanguage(language).then((lang) => {
      if (!cancelled) view.current?.dispatch({ effects: langSlot.current.reconfigure(lang ? lang.extension : []) });
    });
    return () => {
      cancelled = true;
    };
  }, [language]);

  return <div ref={host} className="h-full min-w-0 overflow-hidden" />;
}
