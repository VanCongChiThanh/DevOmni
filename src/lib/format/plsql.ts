/**
 * Oracle SQL / PL/SQL formatter.
 *
 * sql-formatter is good at SQL statements but flattens PL/SQL blocks (no
 * BEGIN/END, IF, LOOP, EXCEPTION indentation). So this formatter:
 *
 *  1. tokenizes the script (strings, q'[...]' quotes, comments, `/` terminators),
 *  2. splits it into units: plain SQL statements, SQL*Plus commands, and PL/SQL
 *     blocks (CREATE PACKAGE/PROCEDURE/FUNCTION/TRIGGER/TYPE BODY, DECLARE, BEGIN),
 *  3. formats plain SQL with sql-formatter,
 *  4. lays out PL/SQL blocks itself with a frame stack, delegating each embedded
 *     DML statement (SELECT/INSERT/UPDATE/DELETE/MERGE) to sql-formatter and
 *     indenting the result to the block level.
 *
 * Anything it can't parse is emitted unchanged rather than mangled.
 */
import { format as sqlFormat } from "sql-formatter";

export interface SqlStyle {
  indent: number;
  useTabs: boolean;
  printWidth: number;
  keywordCase: "upper" | "lower" | "preserve";
  /** sql-formatter dialect for plain SQL */
  dialect: "plsql" | "sql";
}

// ── Tokenizer ────────────────────────────────────────────────────────────────

type TokType = "ws" | "nl" | "lcomment" | "bcomment" | "string" | "qident" | "word" | "number" | "op" | "slash";
interface Tok {
  t: TokType;
  v: string;
  /** uppercase value for words */
  u: string;
}

const MULTI_OPS = [":=", "=>", "||", "<=", ">=", "<>", "!=", "~=", "^=", "..", "**", "<<", ">>"];
const isWordStart = (c: string) => /[A-Za-z_À-￿]/.test(c);
const isWordChar = (c: string) => /[\w$#À-￿]/.test(c);

export function tokenize(src: string): Tok[] {
  const out: Tok[] = [];
  const push = (t: TokType, v: string) => out.push({ t, v, u: t === "word" ? v.toUpperCase() : v });
  const n = src.length;
  let i = 0;
  let lineHasCode = false;

  while (i < n) {
    const c = src[i];
    if (c === "\n") {
      push("nl", "\n");
      lineHasCode = false;
      i++;
      continue;
    }
    if (c === " " || c === "\t" || c === "\r" || c === "\f") {
      let j = i;
      while (j < n && (src[j] === " " || src[j] === "\t" || src[j] === "\r" || src[j] === "\f")) j++;
      push("ws", src.slice(i, j));
      i = j;
      continue;
    }
    if (c === "-" && src[i + 1] === "-") {
      let j = src.indexOf("\n", i);
      if (j < 0) j = n;
      push("lcomment", src.slice(i, j).replace(/\s+$/, ""));
      i = j;
      continue;
    }
    if (c === "/" && src[i + 1] === "*") {
      const end = src.indexOf("*/", i + 2);
      const j = end < 0 ? n : end + 2;
      push("bcomment", src.slice(i, j));
      lineHasCode = true;
      i = j;
      continue;
    }
    // SQL*Plus / PL/SQL block terminator: a line containing only "/"
    if (c === "/" && !lineHasCode) {
      let j = i + 1;
      while (j < n && (src[j] === " " || src[j] === "\t" || src[j] === "\r")) j++;
      if (j >= n || src[j] === "\n") {
        push("slash", "/");
        i = j;
        continue;
      }
    }
    lineHasCode = true;
    // Alternative quoting: q'[ ... ]', nq'{ ... }'
    if ((c === "q" || c === "Q") && src[i + 1] === "'" && i + 2 < n && (i === 0 || !isWordChar(src[i - 1]))) {
      const open = src[i + 2];
      const close = ({ "[": "]", "{": "}", "(": ")", "<": ">" } as Record<string, string>)[open] ?? open;
      const end = src.indexOf(close + "'", i + 3);
      const j = end < 0 ? n : end + 2;
      push("string", src.slice(i, j));
      i = j;
      continue;
    }
    if (c === "'") {
      let j = i + 1;
      while (j < n) {
        if (src[j] === "'") {
          if (src[j + 1] === "'") {
            j += 2;
            continue;
          }
          j++;
          break;
        }
        j++;
      }
      push("string", src.slice(i, j));
      i = j;
      continue;
    }
    if (c === '"') {
      const end = src.indexOf('"', i + 1);
      const j = end < 0 ? n : end + 1;
      push("qident", src.slice(i, j));
      i = j;
      continue;
    }
    if (isWordStart(c)) {
      let j = i + 1;
      while (j < n && isWordChar(src[j])) j++;
      push("word", src.slice(i, j));
      i = j;
      continue;
    }
    if (/\d/.test(c) || (c === "." && /\d/.test(src[i + 1] ?? ""))) {
      let j = i;
      while (j < n && /\d/.test(src[j])) j++;
      if (src[j] === "." && /\d/.test(src[j + 1] ?? "")) {
        j++;
        while (j < n && /\d/.test(src[j])) j++;
      }
      if (/[eE]/.test(src[j] ?? "") && /[\d+-]/.test(src[j + 1] ?? "")) {
        j += 2;
        while (j < n && /\d/.test(src[j])) j++;
      }
      if (/[fFdD]/.test(src[j] ?? "") && !isWordChar(src[j + 1] ?? "")) j++;
      push("number", src.slice(i, j));
      i = j;
      continue;
    }
    const op = MULTI_OPS.find((o) => src.startsWith(o, i));
    if (op) {
      push("op", op);
      i += op.length;
      continue;
    }
    push("op", c);
    i++;
  }
  return out;
}

const isTrivia = (t: Tok) => t.t === "ws" || t.t === "nl";
const isSignificant = (t: Tok) => !isTrivia(t) && t.t !== "lcomment" && t.t !== "bcomment";

// ── Keywords & casing ────────────────────────────────────────────────────────

const KEYWORDS = new Set(
  `ALL ALTER AND ANY AS ASC AT AUTHID AFTER BEFORE BEGIN BETWEEN BODY BULK BY CASE CHECK CLOSE COLLECT
  COMMENT COMMIT CONSTANT CONSTRAINT CONTINUE CREATE CROSS CURRENT_USER CURSOR DECLARE DEFAULT DEFINER DELETE
  DESC DETERMINISTIC DISTINCT DROP EACH EDITIONABLE ELSE ELSIF END EXCEPTION EXCEPTION_INIT EXECUTE EXISTS EXIT
  FETCH FOR FORALL FOREIGN FROM FULL FUNCTION GOTO GRANT GROUP HAVING IF IMMEDIATE IN INDEX INNER INSERT
  INSTEAD INTERSECT INTO IS JOIN KEY LEFT LIKE LIMIT LOOP MERGE MINUS NOCOPY NONEDITIONABLE NOT NULL OF ON OPEN
  OR ORDER OTHERS OUT OUTER PACKAGE PARALLEL_ENABLE PIPE PIPELINED PRAGMA PRIMARY PROCEDURE RAISE RECORD
  REFERENCES REFERENCING REPLACE RESULT_CACHE RETURN RETURNING REVERSE REVOKE RIGHT ROLLBACK ROW ROWTYPE SAVEPOINT
  SELECT SET SUBTYPE TABLE THEN TO TRIGGER TRUNCATE TYPE UNION UNIQUE UPDATE USING VALUES VIEW WHEN WHERE
  WHILE WITH AUTONOMOUS_TRANSACTION SERIALLY_REUSABLE
  NUMBER INTEGER INT PLS_INTEGER BINARY_INTEGER SIMPLE_INTEGER VARCHAR2 VARCHAR NVARCHAR2 CHAR NCHAR CLOB NCLOB
  BLOB DATE TIMESTAMP BOOLEAN RAW LONG FLOAT DECIMAL ROWID SYS_REFCURSOR XMLTYPE
  TRUE FALSE SYSDATE SYSTIMESTAMP ROWNUM SQL SQLERRM SQLCODE ROWCOUNT FOUND NOTFOUND ISOPEN BULK_ROWCOUNT
  NO_DATA_FOUND TOO_MANY_ROWS DUP_VAL_ON_INDEX VALUE_ERROR ZERO_DIVIDE INVALID_NUMBER CURSOR_ALREADY_OPEN`.split(/\s+/),
);

/** Keywords after which "(" keeps a space: `IN (`, `VALUES (`, `AND (` ... */
const SPACE_BEFORE_PAREN = new Set(
  "IN AND OR NOT EXISTS VALUES THEN ELSE WHEN RETURN IS AS FROM JOIN ON WHERE SELECT BY INTO USING LOOP IF ELSIF WHILE CASE ALL ANY SOME UNION MINUS INTERSECT".split(
    " ",
  ),
);

function caseWord(t: Tok, kc: SqlStyle["keywordCase"]): string {
  if (t.t !== "word" || kc === "preserve" || !KEYWORDS.has(t.u)) return t.v;
  return kc === "upper" ? t.u : t.v.toLowerCase();
}

// ── Unit splitting ───────────────────────────────────────────────────────────

type Unit = { kind: "sql" | "plsql" | "raw"; toks: Tok[]; slash: boolean };

const SQLPLUS = new Set(
  "SET PROMPT SPOOL DEFINE UNDEFINE WHENEVER REM REMARK CONNECT CONN SHOW COLUMN COL TTITLE BTITLE BREAK COMPUTE START PAUSE ACCEPT VARIABLE VAR PRINT EXEC".split(
    " ",
  ),
);

function firstWords(toks: Tok[], from: number, count: number): string[] {
  const words: string[] = [];
  for (let i = from; i < toks.length && words.length < count; i++) {
    const t = toks[i];
    if (!isSignificant(t)) continue;
    if (t.t !== "word") break;
    words.push(t.u);
  }
  return words;
}

function isPlsqlStart(words: string[]): boolean {
  if (words[0] === "DECLARE" || words[0] === "BEGIN") return true;
  if (words[0] !== "CREATE") return false;
  let k = 1;
  if (words[k] === "OR" && words[k + 1] === "REPLACE") k += 2;
  if (words[k] === "EDITIONABLE" || words[k] === "NONEDITIONABLE") k++;
  const w = words[k];
  return w === "PROCEDURE" || w === "FUNCTION" || w === "PACKAGE" || w === "TRIGGER" || (w === "TYPE" && words[k + 1] === "BODY");
}

/** Tracks PL/SQL block nesting so a block ends at its final `END;` even without `/`. */
class BlockTracker {
  private stack: ("decl" | "block" | "case")[] = [];
  private header = false;
  private skipNext = false;
  private paren = 0;
  started = false;

  /** Feed one significant token; returns true when the block is complete. */
  feed(t: Tok, prev: Tok | undefined, next: Tok | undefined): boolean {
    if (t.v === "(") this.paren++;
    else if (t.v === ")") this.paren = Math.max(0, this.paren - 1);
    if (t.t === "op" && t.v === ";" && this.paren === 0) {
      this.header = false;
      return this.started && this.stack.length === 0;
    }
    if (t.t !== "word" || this.paren > 0) return false;
    if (this.skipNext) {
      this.skipNext = false;
      return false;
    }
    if (prev?.v === "%" || prev?.v === ".") return false; // %TYPE, pkg.end?
    switch (t.u) {
      case "PROCEDURE":
      case "FUNCTION":
      case "PACKAGE":
        this.header = true;
        break;
      case "TYPE":
        if (next?.u === "BODY") this.header = true;
        break;
      case "IS":
      case "AS":
        if (this.header) {
          this.header = false;
          this.stack.push("decl");
          this.started = true;
        }
        break;
      case "DECLARE":
        this.stack.push("decl");
        this.started = true;
        break;
      case "BEGIN":
        if (this.stack[this.stack.length - 1] === "decl") this.stack[this.stack.length - 1] = "block";
        else this.stack.push("block");
        this.started = true;
        break;
      case "CASE":
        this.stack.push("case");
        break;
      case "END":
        // END IF / END LOOP close constructs that were never pushed.
        if (next && (next.u === "IF" || next.u === "LOOP")) {
          this.skipNext = true;
          break;
        }
        this.stack.pop();
        if (next?.u === "CASE") this.skipNext = true;
        break;
    }
    return false;
  }
}

function splitUnits(toks: Tok[]): Unit[] {
  const units: Unit[] = [];
  let i = 0;
  const n = toks.length;
  const nextSig = (from: number) => {
    for (let k = from; k < n; k++) if (isSignificant(toks[k])) return k;
    return -1;
  };

  while (i < n) {
    // Leading trivia/comments belong to the next unit.
    const start = i;
    const first = nextSig(i);
    if (first < 0) {
      // trailing comments only
      const rest = toks.slice(start);
      if (rest.some((t) => !isTrivia(t))) units.push({ kind: "raw", toks: rest, slash: false });
      break;
    }
    const words = firstWords(toks, first, 6);
    const t0 = toks[first];

    if (t0.t === "slash") {
      // stray terminator
      i = first + 1;
      continue;
    }

    if ((t0.t === "word" && SQLPLUS.has(t0.u)) || t0.v === "@") {
      // SQL*Plus command: rest of the line, verbatim
      let j = first;
      while (j < n && toks[j].t !== "nl") j++;
      units.push({ kind: "raw", toks: toks.slice(start, j), slash: false });
      i = j;
      continue;
    }

    if (isPlsqlStart(words)) {
      const tracker = new BlockTracker();
      let j = first;
      let prev: Tok | undefined;
      let slash = false;
      let done = false;
      while (j < n) {
        const t = toks[j];
        if (t.t === "slash") {
          slash = true;
          j++;
          break;
        }
        if (isSignificant(t)) {
          const nk = nextSig(j + 1);
          done = tracker.feed(t, prev, nk >= 0 ? toks[nk] : undefined);
          prev = t;
        }
        j++;
        if (done) break;
      }
      const body = toks.slice(start, slash ? j - 1 : j);
      if (done) {
        // optional "/" right after the final END;
        const k = nextSig(j);
        if (k >= 0 && toks[k].t === "slash") {
          slash = true;
          j = k + 1;
        }
      }
      units.push({ kind: "plsql", toks: body, slash });
      i = j;
      continue;
    }

    // Plain SQL statement: until ";" at paren depth 0, or "/".
    let j = first;
    let paren = 0;
    let slash = false;
    while (j < n) {
      const t = toks[j];
      if (t.t === "slash") {
        slash = true;
        break;
      }
      if (t.v === "(") paren++;
      else if (t.v === ")") paren = Math.max(0, paren - 1);
      j++;
      if (t.t === "op" && t.v === ";" && paren === 0) break;
    }
    // keep a trailing comment on the same line with its statement
    let k = j;
    while (k < n && toks[k].t === "ws") k++;
    if (k < n && toks[k].t === "lcomment") j = k + 1;
    units.push({ kind: "sql", toks: toks.slice(start, j), slash });
    i = slash ? j + 1 : j;
  }
  return units;
}

// ── Rendering helpers ────────────────────────────────────────────────────────

const raw = (toks: Tok[]) => toks.map((t) => t.v).join("");

function trimTrivia(toks: Tok[]): Tok[] {
  let a = 0;
  let b = toks.length;
  while (a < b && isTrivia(toks[a])) a++;
  while (b > a && isTrivia(toks[b - 1])) b--;
  return toks.slice(a, b);
}

function needSpace(a: Tok, b: Tok, before: Tok | undefined): boolean {
  if (b.v === "," || b.v === ";" || b.v === ")" || b.v === "%" || b.v === "." || b.v === ".." || b.v === "@") return false;
  if (a.v === "(" || a.v === "." || a.v === "%" || a.v === "@" || a.v === "..") return false;
  if (a.v === ":" && (b.t === "word" || b.t === "number")) return false; // :bind
  if (b.v === "(") return a.t === "word" ? SPACE_BEFORE_PAREN.has(a.u) || !/^[\w$#]/.test(a.v) : a.t !== "op" || a.v === ")" ? false : true;
  if ((a.v === "-" || a.v === "+") && (!before || (before.t === "op" && before.v !== ")") || (before.t === "word" && KEYWORDS.has(before.u))))
    return false; // unary sign
  return true;
}

/** Join tokens on one line with normalized spacing; line comments force a break. */
function joinTokens(toks: Tok[], style: SqlStyle, contIndent: string): string {
  let out = "";
  let prev: Tok | undefined;
  let before: Tok | undefined;
  for (const t of toks) {
    if (isTrivia(t)) continue;
    if (prev) {
      if (prev.t === "lcomment") out += "\n" + contIndent;
      else if (needSpace(prev, t, before)) out += " ";
    }
    out += caseWord(t, style.keywordCase);
    before = prev;
    prev = t;
  }
  return out;
}

function sqlFmt(text: string, style: SqlStyle, dialect: "plsql" | "sql"): string {
  return sqlFormat(text, {
    language: dialect,
    tabWidth: style.indent,
    useTabs: style.useTabs,
    keywordCase: style.keywordCase,
    dataTypeCase: style.keywordCase,
    functionCase: "preserve",
    identifierCase: "preserve",
    linesBetweenQueries: 1,
  });
}

// ── PL/SQL block layout ──────────────────────────────────────────────────────

interface Chunk {
  toks: Tok[];
  blankBefore: boolean;
  /** chunk ended on IS/AS of a program header */
  header: boolean;
}

const DML = new Set(["SELECT", "INSERT", "UPDATE", "DELETE", "MERGE", "WITH"]);

/** Split a PL/SQL unit into logical lines (statements and block keywords). */
function chunkBlock(toks: Tok[]): Chunk[] {
  const chunks: Chunk[] = [];
  let cur: Tok[] = [];
  let nlRun = 0;
  let blankPending = false;
  let paren = 0;
  let caseExpr = 0;
  let header = false;
  let sawNewline = true; // newline seen since the last chunk ended

  const sig = () => cur.filter(isSignificant);
  const firstU = () => sig()[0]?.u;
  const flush = (isHeader = false) => {
    if (cur.some((t) => !isTrivia(t))) chunks.push({ toks: trimTrivia(cur), blankBefore: blankPending, header: isHeader });
    cur = [];
    blankPending = false;
    sawNewline = false;
  };

  for (let i = 0; i < toks.length; i++) {
    const t = toks[i];
    if (t.t === "nl") {
      nlRun++;
      sawNewline = true;
      if (cur.length && sig().length === 0 && cur.every((x) => isTrivia(x))) cur = [];
      if (cur.length) cur.push(t);
      continue;
    }
    if (t.t === "ws") {
      if (cur.length) cur.push(t);
      continue;
    }
    const atStart = sig().length === 0;
    if (nlRun >= 2 && atStart && cur.every(isTrivia)) blankPending = chunks.length > 0;
    nlRun = 0;

    // Trailing comment on the same line as the previous statement: keep it there.
    if (t.t === "lcomment" && atStart && !sawNewline && chunks.length) {
      chunks[chunks.length - 1].toks.push({ t: "ws", v: " ", u: " " }, t);
      continue;
    }
    // Standalone comment line
    if ((t.t === "lcomment" || t.t === "bcomment") && atStart) {
      cur.push(t);
      if (t.t === "lcomment") flush();
      continue;
    }

    const prevSig = sig()[sig().length - 1];
    const u = t.t === "word" && prevSig?.v !== "%" && prevSig?.v !== "." ? t.u : "";

    // Words that always start a new logical line
    if ((u === "BEGIN" || u === "DECLARE") && !atStart) flush();
    if (u === "WHEN" && paren === 0 && caseExpr === 0 && firstU() === "CASE") flush();

    const startNow = sig().length === 0;
    cur.push(t);
    if (t.t === "lcomment") continue; // stays inside the statement

    if (t.v === "(") paren++;
    else if (t.v === ")") paren = Math.max(0, paren - 1);

    if (startNow) {
      if (u === "PROCEDURE" || u === "FUNCTION" || u === "PACKAGE" || u === "CREATE") header = u !== "CREATE";
      if (u === "BEGIN" || u === "DECLARE" || u === "ELSE" || (u === "EXCEPTION" && nextIs(toks, i, ";") === false)) {
        flush();
        continue;
      }
      if (t.v === "<<") continue;
    } else if (u === "CASE") {
      caseExpr++;
    } else if (u === "END" && caseExpr > 0) {
      caseExpr--;
      continue;
    }

    if (t.v === ">>" && firstU() === undefined && cur.find(isSignificant)?.v === "<<") {
      flush();
      continue;
    }
    if (u === "PROCEDURE" || u === "FUNCTION" || u === "PACKAGE" || (u === "TYPE" && nextWordU(toks, i) === "BODY")) {
      if (firstU() === "CREATE" || firstU() === u || firstU() === "TYPE") header = true;
    }
    if (paren > 0) continue;
    if (t.v === ";") {
      header = false;
      caseExpr = 0;
      flush();
      continue;
    }
    if (caseExpr > 0) continue;
    if ((u === "IS" || u === "AS") && header) {
      header = false;
      flush(true);
      continue;
    }
    if (u === "THEN" && firstU() !== "END") {
      flush();
      continue;
    }
    if (u === "LOOP" && prevSig?.u !== "END") {
      flush();
      continue;
    }
  }
  flush();
  return chunks;
}

function nextIs(toks: Tok[], i: number, v: string): boolean {
  for (let k = i + 1; k < toks.length; k++) if (isSignificant(toks[k])) return toks[k].v === v;
  return false;
}
function nextWordU(toks: Tok[], i: number): string | undefined {
  for (let k = i + 1; k < toks.length; k++) if (isSignificant(toks[k])) return toks[k].t === "word" ? toks[k].u : undefined;
  return undefined;
}

type FrameT = "decl" | "body" | "exc" | "excWhen" | "if" | "loop" | "case" | "caseWhen";
interface Frame {
  t: FrameT;
  base: number;
}

function formatBlock(toks: Tok[], style: SqlStyle): string {
  const pad = (level: number) => (style.useTabs ? "\t".repeat(level) : " ".repeat(level * style.indent));
  const lines: string[] = [];
  const stack: Frame[] = [];
  const top = () => stack[stack.length - 1];
  const level = () => (top() ? top().base + 1 : 0);
  const popUntil = (...types: FrameT[]): Frame | undefined => {
    const idx = [...stack].reverse().findIndex((f) => types.includes(f.t));
    if (idx < 0) return undefined;
    const at = stack.length - 1 - idx;
    const f = stack[at];
    stack.length = at;
    return f;
  };

  const unit = pad(1);
  const emit = (text: string, lvl: number) => {
    for (const l of text.split("\n")) lines.push(l.trim() ? pad(lvl) + l : "");
  };

  for (const chunk of chunkBlock(toks)) {
    const sig = chunk.toks.filter(isSignificant);
    const fw = sig[0]?.t === "word" ? sig[0].u : sig[0]?.v ?? "";
    const lw = sig[sig.length - 1]?.u ?? "";
    if (chunk.blankBefore) lines.push("");

    // Pure comment chunk
    if (!sig.length) {
      emit(chunk.toks.filter((t) => !isTrivia(t)).map((t) => t.v).join(" "), level());
      continue;
    }

    if (chunk.header) {
      const b = level();
      emit(renderHeader(chunk.toks, style, unit), b);
      stack.push({ t: "decl", base: b });
      continue;
    }

    switch (fw) {
      case "DECLARE": {
        const b = level();
        emit(caseWord(sig[0], style.keywordCase), b);
        stack.push({ t: "decl", base: b });
        continue;
      }
      case "BEGIN": {
        const kw = caseWord(sig[0], style.keywordCase);
        if (top()?.t === "decl") {
          const f = stack.pop()!;
          emit(kw, f.base);
          stack.push({ t: "body", base: f.base });
        } else {
          const b = level();
          emit(kw, b);
          stack.push({ t: "body", base: b });
        }
        continue;
      }
      case "EXCEPTION":
        if (sig.length === 1) {
          const f = popUntil("body", "exc");
          const b = f ? f.base : level();
          emit(caseWord(sig[0], style.keywordCase), b);
          stack.push({ t: "exc", base: b });
          continue;
        }
        break;
      case "WHEN": {
        const t = top()?.t;
        if (t === "exc" || t === "excWhen") {
          if (t === "excWhen") stack.pop();
          const b = top()!.base + 1;
          emit(joinTokens(chunk.toks, style, unit), b);
          stack.push({ t: "excWhen", base: b });
          continue;
        }
        if (t === "case" || t === "caseWhen") {
          if (t === "caseWhen") stack.pop();
          const b = top()!.base + 1;
          emit(joinTokens(chunk.toks, style, unit), b);
          stack.push({ t: "caseWhen", base: b });
          continue;
        }
        break;
      }
      case "ELSE":
      case "ELSIF": {
        const t = top()?.t;
        if (fw === "ELSE" && (t === "caseWhen" || t === "case")) {
          if (t === "caseWhen") stack.pop();
          const b = top()!.base + 1;
          emit(joinTokens(chunk.toks, style, unit), b);
          stack.push({ t: "caseWhen", base: b });
          continue;
        }
        const f = popUntil("if");
        if (f) {
          stack.push(f);
          emit(joinTokens(chunk.toks, style, unit), f.base);
          continue;
        }
        break;
      }
      case "IF":
        if (lw === "THEN") {
          const b = level();
          emit(joinTokens(chunk.toks, style, unit), b);
          stack.push({ t: "if", base: b });
          continue;
        }
        break;
      case "CASE":
        if (lw !== ";") {
          const b = level();
          emit(joinTokens(chunk.toks, style, unit), b);
          stack.push({ t: "case", base: b });
          continue;
        }
        break;
      case "END": {
        const second = sig[1]?.u;
        let f: Frame | undefined;
        if (second === "IF") f = popUntil("if");
        else if (second === "LOOP") f = popUntil("loop");
        else if (second === "CASE") f = popUntil("case");
        else f = popUntil("exc", "body", "decl");
        emit(joinTokens(chunk.toks, style, ""), f ? f.base : level());
        continue;
      }
    }

    if (lw === "LOOP") {
      const b = level();
      emit(joinTokens(chunk.toks, style, unit), b);
      stack.push({ t: "loop", base: b });
      continue;
    }

    emit(renderStatement(chunk.toks, sig, style, unit), level());
  }
  return lines.join("\n");
}

/** Program header; long parameter lists go one per line. */
function renderHeader(toks: Tok[], style: SqlStyle, inner: string): string {
  const one = joinTokens(toks, style, inner);
  if (one.length <= style.printWidth || !toks.some((t) => t.v === "(")) return one;
  const sig = toks.filter((t) => !isTrivia(t));
  const open = sig.findIndex((t) => t.v === "(");
  let depth = 0;
  let close = -1;
  for (let k = open; k < sig.length; k++) {
    if (sig[k].v === "(") depth++;
    else if (sig[k].v === ")" && --depth === 0) {
      close = k;
      break;
    }
  }
  if (close < 0) return one;
  const params: Tok[][] = [[]];
  depth = 0;
  for (let k = open + 1; k < close; k++) {
    const t = sig[k];
    if (t.v === "(") depth++;
    if (t.v === ")") depth--;
    if (t.v === "," && depth === 0) params.push([]);
    else params[params.length - 1].push(t);
  }
  const head = joinTokens(sig.slice(0, open), style, inner);
  const tail = joinTokens(sig.slice(close + 1), style, inner);
  return `${head} (\n${params.map((p) => inner.replace(/^.*?(\s*)$/, "$1") + joinTokens(p, style, inner)).join(",\n")}\n) ${tail}`.replace(
    /\n(?=[^\n])/g,
    (m) => m,
  );
}

function renderStatement(toks: Tok[], sig: Tok[], style: SqlStyle, inner: string): string {
  const fw = sig[0]?.t === "word" ? sig[0].u : "";

  // Embedded DML → sql-formatter
  if (DML.has(fw)) {
    try {
      return sqlFmt(raw(toks), style, "plsql");
    } catch {
      return joinTokens(toks, style, inner);
    }
  }

  // CURSOR c IS <select>;  OPEN c FOR <select>;  ... RETURN/INTO (select)
  const selAt = sig.findIndex((t, k) => k > 0 && (t.u === "SELECT" || t.u === "WITH") && (sig[k - 1].u === "IS" || sig[k - 1].u === "FOR" || sig[k - 1].u === "AS"));
  if ((fw === "CURSOR" || fw === "OPEN") && selAt > 0) {
    const tokIdx = toks.indexOf(sig[selAt]);
    try {
      const head = joinTokens(toks.slice(0, tokIdx), style, inner);
      const body = sqlFmt(raw(toks.slice(tokIdx)), style, "plsql");
      return head + "\n" + body.split("\n").map((l) => (l ? style.useTabs ? "\t" + l : " ".repeat(style.indent) + l : l)).join("\n");
    } catch {
      /* fall through */
    }
  }

  // Trigger header: one clause per line
  if (fw === "CREATE" && sig.some((t) => t.u === "TRIGGER")) {
    const parts: Tok[][] = [[]];
    let depth = 0;
    for (const t of toks) {
      if (t.v === "(") depth++;
      if (t.v === ")") depth--;
      if (depth === 0 && t.t === "word" && ["BEFORE", "AFTER", "INSTEAD", "ON", "REFERENCING", "WHEN"].includes(t.u)) parts.push([]);
      if (depth === 0 && t.t === "word" && t.u === "FOR" && parts[parts.length - 1].some((x) => x.u === "ON")) parts.push([]);
      parts[parts.length - 1].push(t);
    }
    return parts
      .filter((p) => p.some(isSignificant))
      .map((p, k) => (k ? inner : "") + joinTokens(p, style, inner))
      .join("\n");
  }

  return joinTokens(toks, style, inner);
}

// ── Entry point ──────────────────────────────────────────────────────────────

export function formatOracle(src: string, style: SqlStyle): string {
  const text = src.replace(/\r\n?/g, "\n");
  const units = splitUnits(tokenize(text));
  const out: string[] = [];
  let sqlBuf: Tok[] = [];

  const flushSql = () => {
    const body = raw(sqlBuf).trim();
    sqlBuf = [];
    if (!body) return;
    try {
      out.push(sqlFmt(body, style, style.dialect));
    } catch {
      out.push(body); // unparseable: keep exactly as written
    }
  };

  for (const u of units) {
    if (u.kind === "sql") {
      sqlBuf.push(...u.toks, { t: "nl", v: "\n", u: "\n" });
      if (u.slash) {
        flushSql();
        out.push("/");
      }
      continue;
    }
    flushSql();
    if (u.kind === "raw") {
      out.push(raw(trimTrivia(u.toks)).replace(/[ \t]+$/gm, ""));
    } else {
      out.push(formatBlock(u.toks, style) + (u.slash ? "\n/" : ""));
    }
  }
  flushSql();

  // Join units: blank line between, but keep "/" glued to its statement.
  return out.join("\n\n").replace(/\n\n\/(?=\n|$)/g, "\n/").trimEnd() + "\n";
}
