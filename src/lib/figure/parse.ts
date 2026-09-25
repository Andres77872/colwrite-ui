import type {
  DiagnosticSeverity,
  FigureDiagnostic,
  JsonArrayNode,
  JsonMember,
  JsonNode,
  JsonNumberNode,
  JsonObjectNode,
  JsonStringNode,
  JsonValue,
  ParseResult,
} from './types';

/**
 * The lenient JSON reader behind structured figures.
 *
 * A figure's source is written by hand and by language models, so the reader
 * forgives what both commonly get wrong — comments, trailing commas, single
 * quotes, bare keys, a Markdown fence, a missing comma at a line break, and
 * LaTeX backslashes that are not JSON escapes — and reports each forgiveness
 * that changes meaning as a diagnostic. Every AST node keeps [start, end)
 * offsets into the ORIGINAL text, so the editor can select the offending span
 * and the inspector can rewrite one value in place.
 */

/** Deepest nesting read; a real figure is a handful of levels deep, so more is a runaway. */
const MAX_DEPTH = 200;

const TAB = 0x09;
const LF = 0x0a;
const CR = 0x0d;
const SPACE = 0x20;
const DQUOTE = 0x22;
const DOLLAR = 0x24;
const SQUOTE = 0x27;
const STAR = 0x2a;
const PLUS = 0x2b;
const COMMA = 0x2c;
const MINUS = 0x2d;
const DOT = 0x2e;
const SLASH = 0x2f;
const COLON = 0x3a;
const LBRACKET = 0x5b;
const BACKSLASH = 0x5c;
const RBRACKET = 0x5d;
const LBRACE = 0x7b;
const RBRACE = 0x7d;

/** JSON's one-letter control escapes, and the control character each decodes to. */
const CONTROL_ESCAPES: Record<string, string> = { b: '\b', f: '\f', n: '\n', r: '\r', t: '\t' };

/**
 * The escape letter a raw control character came from. An upstream JSON layer
 * that decoded `"$\times$"` left a TAB before `imes`; inside maths the reader
 * puts the backslash and letter back.
 */
const CONTROL_LETTERS: Record<number, string> = { 0x08: 'b', 0x0c: 'f', 0x0a: 'n', 0x0d: 'r', 0x09: 't' };

const STRICT_NUMBER = /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?$/;
const UNITS = /^(?:px|pt|em|rem|cm|mm|in|ex)$/i;

function isBreak(c: number): boolean {
  return c === LF || c === CR || c === 0x2028 || c === 0x2029;
}

function isWhitespace(c: number): boolean {
  return (
    c === SPACE || c === TAB || c === LF || c === CR || c === 0x0b || c === 0x0c ||
    c === 0xa0 || c === 0xfeff || c === 0x2028 || c === 0x2029
  );
}

function isDigit(c: number): boolean {
  return c >= 0x30 && c <= 0x39;
}

function isAsciiLetter(c: number): boolean {
  const lower = c | 0x20;
  return lower >= 0x61 && lower <= 0x7a;
}

/** First character of a bare key or word: `[A-Za-z_$]`. */
function isIdentStart(c: number): boolean {
  return isAsciiLetter(c) || c === 0x5f || c === DOLLAR;
}

/** Later characters of a bare key: `[\w$-]`. */
function isIdentPart(c: number): boolean {
  return isIdentStart(c) || isDigit(c) || c === MINUS;
}

function isKeyStart(c: number): boolean {
  return c === DQUOTE || c === SQUOTE || isIdentStart(c);
}

function isValueStart(c: number): boolean {
  return (
    c === LBRACE || c === LBRACKET || c === DQUOTE || c === SQUOTE || isDigit(c) ||
    c === MINUS || c === PLUS || c === DOT || isIdentStart(c)
  );
}

function isStructural(c: number): boolean {
  return c === COMMA || c === COLON || c === LBRACE || c === RBRACE || c === LBRACKET || c === RBRACKET;
}

/** `parent.key`, or `parent["odd key"]` when the key is not an identifier. */
function memberPath(parent: string, key: string): string {
  if (/^[A-Za-z_$][\w$]*$/.test(key)) return parent ? `${parent}.${key}` : key;
  return `${parent}[${JSON.stringify(key)}]`;
}

function severityRank(severity: DiagnosticSeverity): number {
  return severity === 'error' ? 0 : severity === 'warning' ? 1 : 2;
}

function makeDiagnostic(
  source: string,
  severity: DiagnosticSeverity,
  code: string,
  message: string,
  range: [number, number],
  path?: string,
): FigureDiagnostic {
  const { line, column } = lineColumn(source, range[0]);
  const diagnostic: FigureDiagnostic = { severity, code, message, range, line, column };
  if (path) diagnostic.path = path;
  return diagnostic;
}

/**
 * Follows maths through DECODED string text, one character at a time, for the
 * LaTeX-aware escape rules. An unescaped `$` opens or closes inline maths;
 * `\$` is a literal dollar; `$$…$$` is one display span (counting single
 * dollars would read `$$\frac{a}{b}$$` as outside maths and decode `\f`).
 * The printer in `edit.ts` runs the same tracker, so what it writes reads
 * back identically.
 */
export class MathTracker {
  private mode: 'text' | 'inline' | 'display' = 'text';
  /** What the previous character did, when it was an unescaped `$`. */
  private dollar: 'opened' | 'closed-display' | null = null;
  /** Whether the text so far ends in an unpaired backslash. */
  private escaped = false;

  get inMath(): boolean {
    return this.mode !== 'text';
  }

  push(c: number): void {
    if (c === BACKSLASH) {
      this.escaped = !this.escaped;
      this.dollar = null;
      return;
    }
    if (c !== DOLLAR || this.escaped) {
      this.escaped = false;
      this.dollar = null;
      return;
    }
    if (this.mode === 'inline' && this.dollar === 'opened') {
      this.mode = 'display';
      this.dollar = null;
    } else if (this.dollar === 'closed-display') {
      this.dollar = null;
    } else if (this.mode === 'text') {
      this.mode = 'inline';
      this.dollar = 'opened';
    } else if (this.mode === 'inline') {
      this.mode = 'text';
      this.dollar = null;
    } else {
      this.mode = 'text';
      this.dollar = 'closed-display';
    }
  }
}

class ParseFailure extends Error {
  readonly diagnostic: FigureDiagnostic;

  constructor(diagnostic: FigureDiagnostic) {
    super(diagnostic.message);
    this.diagnostic = diagnostic;
  }
}

/**
 * Where the JSON sits in `source`: after a BOM and an opening Markdown fence
 * line, before its closing fence line. Nothing is sliced off, so every
 * offset the reader produces still indexes the original text.
 */
function contentWindow(source: string): { start: number; end: number; afterFence: number | null } {
  const start = source.charCodeAt(0) === 0xfeff ? 1 : 0;
  const open = /[ \t\r\n]*(`{3,}|~{3,})([^\n]*)(?:\n|$)/y;
  open.lastIndex = start;
  const match = open.exec(source);
  // A backtick fence's info string may not contain a backtick (CommonMark).
  if (!match || (match[1][0] === '`' && match[2].includes('`'))) {
    return { start, end: source.length, afterFence: null };
  }
  const fence = match[1];
  const contentStart = open.lastIndex;
  const close = new RegExp(`^[ \\t]*${fence[0] === '`' ? '`' : '~'}{${fence.length},}[ \\t]*\\r?$`, 'gm');
  close.lastIndex = contentStart;
  const closing = close.exec(source);
  // An unclosed fence (a truncated reply) reads to the end.
  if (!closing) return { start: contentStart, end: source.length, afterFence: null };
  const rest = closing.index + closing[0].length;
  const stray = source.slice(rest).search(/\S/);
  return { start: contentStart, end: closing.index, afterFence: stray < 0 ? null : rest + stray };
}

class Reader {
  readonly src: string;
  readonly end: number;
  pos: number;
  readonly diagnostics: FigureDiagnostic[] = [];
  /** Whether the last `skipTrivia` crossed a line break; gates missing-comma recovery. */
  crossedLine = false;
  /** The last string read and the first raw line break kept in it, for the missing-quote hint. */
  lastString: { start: number; lineBreak: number | null } | null = null;

  constructor(src: string, start: number, end: number) {
    this.src = src;
    this.pos = start;
    this.end = end;
  }

  /** Char code at `at`, or -1 past the window (never reads into a closing fence). */
  code(at: number): number {
    return at < this.end ? this.src.charCodeAt(at) : -1;
  }

  report(severity: DiagnosticSeverity, code: string, message: string, range: [number, number], path?: string) {
    this.diagnostics.push(makeDiagnostic(this.src, severity, code, message, range, path));
  }

  fail(message: string, range: [number, number], path?: string): never {
    throw new ParseFailure(makeDiagnostic(this.src, 'error', 'json.syntax', message, range, path));
  }

  lineOf(offset: number): number {
    return lineColumn(this.src, offset).line;
  }

  /** End of the token at `at`: a whole word or number, else one character. */
  tokenEnd(at: number): number {
    if (at >= this.end) return this.end;
    let i = at;
    while (i < this.end && (isIdentPart(this.src.charCodeAt(i)) || this.src.charCodeAt(i) === DOT)) i++;
    return i > at ? i : at + 1;
  }

  /** How an error names what it found at `at`. */
  found(at: number): string {
    if (at >= this.end) return 'the end of the input';
    const end = this.tokenEnd(at);
    const text = this.src.slice(at, Math.min(end, at + 24));
    return end - at > 1 || isIdentPart(this.src.charCodeAt(at)) ? `\`${text}\`` : `'${text}'`;
  }

  /** Skips whitespace and `//` / `/* *\/` comments. */
  skipTrivia(): void {
    this.crossedLine = false;
    while (this.pos < this.end) {
      const c = this.src.charCodeAt(this.pos);
      if (isWhitespace(c)) {
        if (isBreak(c)) this.crossedLine = true;
        this.pos++;
        continue;
      }
      if (c === SLASH) {
        const next = this.code(this.pos + 1);
        if (next === SLASH) {
          this.pos += 2;
          while (this.pos < this.end && !isBreak(this.src.charCodeAt(this.pos))) this.pos++;
          continue;
        }
        if (next === STAR) {
          const close = this.src.indexOf('*/', this.pos + 2);
          if (close < 0 || close + 2 > this.end) {
            this.fail('Unterminated comment: add the closing */.', [this.pos, this.end]);
          }
          for (let i = this.pos; i < close; i++) {
            if (isBreak(this.src.charCodeAt(i))) {
              this.crossedLine = true;
              break;
            }
          }
          this.pos = close + 2;
          continue;
        }
      }
      return;
    }
  }

  parseValue(path: string, depth: number): JsonNode {
    const c = this.code(this.pos);
    if (c === LBRACE) return this.parseObject(path, depth);
    if (c === LBRACKET) return this.parseArray(path, depth);
    if (c === DQUOTE || c === SQUOTE) return this.parseString(path);
    if (isDigit(c) || c === MINUS || c === PLUS || c === DOT) return this.parseNumber(path);
    if (isIdentStart(c)) return this.parseWord(path);
    if (c < 0) this.fail('Unexpected end of input; expected a value.', [this.end, this.end], path);
    this.fail(`Expected a value, found ${this.found(this.pos)}.`, [this.pos, this.pos + 1], path);
  }

  parseObject(path: string, depth: number): JsonObjectNode {
    const start = this.pos;
    if (depth >= MAX_DEPTH) this.fail(`Nesting is deeper than ${MAX_DEPTH} levels.`, [start, start + 1], path);
    this.pos++;
    const members: JsonMember[] = [];
    const seen = new Set<string>();
    this.skipTrivia();
    for (;;) {
      const c = this.code(this.pos);
      if (c === RBRACE) break;
      if (c < 0) this.failUnclosed('object', start, path);
      const key = this.parseKey(path);
      this.skipTrivia();
      if (this.code(this.pos) !== COLON) {
        this.fail(
          `Expected ':' after the key "${key.key}", found ${this.found(this.pos)}.`,
          [this.pos, this.tokenEnd(this.pos)],
          path,
        );
      }
      this.pos++;
      this.skipTrivia();
      const childPath = memberPath(path, key.key);
      const value = this.parseValue(childPath, depth + 1);
      const member: JsonMember = { ...key, value, start: key.keyStart, end: value.end };
      if (seen.has(key.key)) {
        this.report(
          'warning',
          'json.duplicate-key',
          `Duplicate key "${key.key}"; the last one wins.`,
          [key.keyStart, key.keyEnd],
          childPath,
        );
      }
      seen.add(key.key);
      members.push(member);
      this.skipTrivia();
      const next = this.code(this.pos);
      if (next === COMMA) {
        this.pos++;
        this.skipTrivia();
        continue;
      }
      if (next === RBRACE) break;
      if (next < 0) this.failUnclosed('object', start, path);
      if (this.crossedLine && isKeyStart(next)) {
        this.report(
          'warning',
          'json.missing-comma',
          "Missing ',' between members; read as if it were there.",
          [value.end, value.end],
          path,
        );
        continue;
      }
      this.failAfter(value, '}', path);
    }
    this.pos++;
    return { kind: 'object', start, end: this.pos, members };
  }

  parseArray(path: string, depth: number): JsonArrayNode {
    const start = this.pos;
    if (depth >= MAX_DEPTH) this.fail(`Nesting is deeper than ${MAX_DEPTH} levels.`, [start, start + 1], path);
    this.pos++;
    const items: JsonNode[] = [];
    this.skipTrivia();
    for (;;) {
      const c = this.code(this.pos);
      if (c === RBRACKET) break;
      if (c < 0) this.failUnclosed('array', start, path);
      const item = this.parseValue(`${path}[${items.length}]`, depth + 1);
      items.push(item);
      this.skipTrivia();
      const next = this.code(this.pos);
      if (next === COMMA) {
        this.pos++;
        this.skipTrivia();
        continue;
      }
      if (next === RBRACKET) break;
      if (next < 0) this.failUnclosed('array', start, path);
      if (this.crossedLine && isValueStart(next)) {
        this.report(
          'warning',
          'json.missing-comma',
          "Missing ',' between items; read as if it were there.",
          [item.end, item.end],
          path,
        );
        continue;
      }
      this.failAfter(item, ']', path);
    }
    this.pos++;
    return { kind: 'array', start, end: this.pos, items };
  }

  failUnclosed(what: 'object' | 'array', start: number, path: string): never {
    const close = what === 'object' ? '}' : ']';
    this.fail(
      `Unexpected end of input; the ${what} that starts on line ${this.lineOf(start)} is not closed with '${close}'.`,
      [this.end, this.end],
      path,
    );
  }

  /** The error after a member or item, with a hint for the mistakes models make most. */
  failAfter(prev: JsonNode, close: '}' | ']', path: string): never {
    const at = this.pos;
    const c = this.code(at);
    let message =
      close === '}'
        ? `Expected ',' or '}' after a member, found ${this.found(at)}.`
        : `Expected ',' or ']' after an item, found ${this.found(at)}.`;
    const lineBreak =
      prev.kind === 'string' && this.lastString?.start === prev.start ? this.lastString.lineBreak : null;
    if (lineBreak !== null) {
      message += ` The string that starts on line ${this.lineOf(prev.start)} runs over several lines; is its closing quote missing?`;
    } else if (prev.kind === 'string' && !this.crossedLine && !isStructural(c) && c !== DQUOTE && c !== SQUOTE) {
      message += ' If a quote belongs to the text, escape quotes inside strings as \\".';
    } else if (close === '}' ? isKeyStart(c) : isValueStart(c)) {
      message += " Is a ',' missing?";
    }
    this.fail(message, [at, this.tokenEnd(at)], path);
  }

  parseKey(path: string): { key: string; keyStart: number; keyEnd: number } {
    const c = this.code(this.pos);
    if (c === DQUOTE || c === SQUOTE) {
      const node = this.parseString(path);
      return { key: node.value, keyStart: node.start, keyEnd: node.end };
    }
    if (isIdentStart(c)) {
      const keyStart = this.pos;
      while (this.pos < this.end && isIdentPart(this.src.charCodeAt(this.pos))) this.pos++;
      return { key: this.src.slice(keyStart, this.pos), keyStart, keyEnd: this.pos };
    }
    this.fail(
      `Expected a property name or '}', found ${this.found(this.pos)}.`,
      [this.pos, this.tokenEnd(this.pos)],
      path,
    );
  }

  /**
   * A double- or single-quoted string, decoded with the LaTeX-aware rules:
   * maths state follows the DECODED text (`MathTracker`), `\b \f \n \r \t`
   * stay LaTeX inside maths before a letter,
   * any other non-JSON escape keeps its backslash, and raw control
   * characters an upstream decoder produced are restored inside maths.
   */
  parseString(path: string): JsonStringNode {
    const src = this.src;
    const start = this.pos;
    const quote = src.charCodeAt(start);
    let pos = start + 1;
    let out = '';
    const math = new MathTracker();
    let latexNoted = false;
    let rawNoted = false;
    let lineBreak: number | null = null;

    const emit = (ch: string) => {
      out += ch;
      math.push(ch.charCodeAt(0));
    };
    const unterminated = (): never =>
      this.fail(
        `Unterminated string: the ${quote === DQUOTE ? '"' : "'"} opened here is never closed.`,
        [start, this.end],
        path,
      );

    for (;;) {
      if (pos >= this.end) unterminated();
      const c = src.charCodeAt(pos);
      if (c === quote) {
        pos++;
        break;
      }
      if (c === BACKSLASH) {
        if (pos + 1 >= this.end) unterminated();
        const e = src[pos + 1];
        if (e === '"' || e === "'" || e === '\\' || e === '/') {
          emit(e);
          pos += 2;
          continue;
        }
        if (e === 'u' && pos + 6 <= this.end && /^[0-9a-fA-F]{4}$/.test(src.slice(pos + 2, pos + 6))) {
          emit(String.fromCharCode(parseInt(src.slice(pos + 2, pos + 6), 16)));
          pos += 6;
          continue;
        }
        if ('bfnrt'.includes(e)) {
          if (math.inMath && isAsciiLetter(this.code(pos + 2))) {
            // `\beta`, `\frac`, `\nabla`, `\rho`, `\times`: keep the backslash;
            // the letter is read next as itself.
            emit('\\');
            pos += 1;
            continue;
          }
          emit(CONTROL_ESCAPES[e]);
          pos += 2;
          continue;
        }
        // Not a JSON escape (`\alpha`, `\mathbf`, `\$`): keep the backslash
        // and read what follows as itself.
        if (!latexNoted) {
          latexNoted = true;
          let seqEnd = pos + 1;
          while (seqEnd < this.end && isAsciiLetter(src.charCodeAt(seqEnd))) seqEnd++;
          if (seqEnd === pos + 1) seqEnd = Math.min(pos + 2, this.end);
          const seq = src.slice(pos, seqEnd);
          this.report(
            'info',
            'json.latex-escape',
            `\`${seq}\` is not a JSON escape; kept as LaTeX (strict JSON writes \`\\${seq}\`).`,
            [pos, seqEnd],
            path,
          );
        }
        emit('\\');
        pos += 1;
        continue;
      }
      if (c < SPACE) {
        const letter = CONTROL_LETTERS[c];
        if (letter && math.inMath && isAsciiLetter(this.code(pos + 1))) {
          emit('\\');
          emit(letter);
          pos += 1;
          continue;
        }
        if (isBreak(c) && lineBreak === null) lineBreak = pos;
        if (!rawNoted) {
          rawNoted = true;
          const what =
            c === TAB
              ? 'A raw tab inside a string was kept; strict JSON writes it as \\t.'
              : c === LF || c === CR
                ? 'A raw line break inside a string was kept; strict JSON writes it as \\n.'
                : `A raw control character (U+${c.toString(16).toUpperCase().padStart(4, '0')}) inside a string was kept; strict JSON escapes it.`;
          this.report('warning', 'json.raw-control', what, [pos, pos + 1], path);
        }
        emit(src[pos]);
        pos += 1;
        continue;
      }
      emit(src[pos]);
      pos += 1;
    }
    this.pos = pos;
    this.lastString = { start, lineBreak };
    return { kind: 'string', start, end: pos, value: out };
  }

  parseNumber(path: string): JsonNode {
    const src = this.src;
    const start = this.pos;
    let pos = start;
    if (src.charCodeAt(pos) === MINUS || src.charCodeAt(pos) === PLUS) pos++;
    if (isIdentStart(this.code(pos))) {
      this.pos = pos;
      return this.parseWord(path, start);
    }
    const intStart = pos;
    while (isDigit(this.code(pos))) pos++;
    const intDigits = pos - intStart;
    let fracDigits = 0;
    if (this.code(pos) === DOT) {
      pos++;
      const fracStart = pos;
      while (isDigit(this.code(pos))) pos++;
      fracDigits = pos - fracStart;
    }
    let valid = intDigits + fracDigits > 0;
    const e = this.code(pos);
    if (valid && (e === 0x65 || e === 0x45)) {
      pos++;
      if (this.code(pos) === PLUS || this.code(pos) === MINUS) pos++;
      const expStart = pos;
      while (isDigit(this.code(pos))) pos++;
      if (pos === expStart) valid = false;
    }
    // `120px`, `0x1F`, `1.2.3`: the token runs on past the number.
    let tail = pos;
    while (tail < this.end && (isIdentPart(src.charCodeAt(tail)) || src.charCodeAt(tail) === DOT)) tail++;
    const text = src.slice(start, tail);
    if (!valid || tail > pos) {
      const unit = src.slice(pos, tail);
      const hint = valid && UNITS.test(unit) ? ' Sizes are plain numbers in px, without a unit.' : '';
      this.fail(`Invalid number \`${text}\`.${hint}`, [start, Math.max(tail, start + 1)], path);
    }
    const value = Number(text);
    if (!Number.isFinite(value)) {
      this.fail(`The number \`${text}\` is too large.`, [start, pos], path);
    }
    if (!STRICT_NUMBER.test(text)) {
      this.report(
        'warning',
        'json.number-format',
        `\`${text}\` is not a strict JSON number; read as ${JSON.stringify(value)}.`,
        [start, pos],
        path,
      );
    }
    this.pos = pos;
    const node: JsonNumberNode = { kind: 'number', start, end: pos, value };
    return node;
  }

  /** A bare word: `true`, `false`, `null`, or an error that says what to write instead. */
  parseWord(path: string, start = this.pos): JsonNode {
    let pos = this.pos;
    while (pos < this.end && isIdentPart(this.src.charCodeAt(pos))) pos++;
    const word = this.src.slice(start, pos);
    const signed = start !== this.pos;
    const bare = signed ? word.slice(1) : word;
    const range: [number, number] = [start, pos];
    if (!signed) {
      if (word === 'true' || word === 'false') {
        this.pos = pos;
        return { kind: 'boolean', start, end: pos, value: word === 'true' };
      }
      if (word === 'null') {
        this.pos = pos;
        return { kind: 'null', start, end: pos };
      }
    }
    if (bare === 'NaN' || bare === 'Infinity') {
      this.fail('NaN and Infinity are not valid JSON numbers; use a finite number.', range, path);
    }
    if (signed) this.fail(`Invalid number \`${word}\`.`, range, path);
    if (/^(?:true|false|null)$/i.test(word)) {
      this.fail(`Unexpected \`${word}\`; JSON writes true, false and null in lowercase.`, range, path);
    }
    if (word === 'undefined') this.fail('`undefined` is not a JSON value; use null or leave the key out.', range, path);
    this.fail(`Unexpected \`${word}\`; text values must be quoted, e.g. "${word}".`, range, path);
  }
}

/** Own-property assignment that also stores a `__proto__` key as data, as `JSON.parse` does. */
function setOwn(target: { [key: string]: JsonValue }, key: string, value: JsonValue): void {
  if (key === '__proto__') {
    Object.defineProperty(target, key, { value, enumerable: true, writable: true, configurable: true });
  } else {
    target[key] = value;
  }
}

function toValue(node: JsonNode): JsonValue {
  switch (node.kind) {
    case 'object': {
      const out: { [key: string]: JsonValue } = {};
      for (const member of node.members) setOwn(out, member.key, toValue(member.value));
      return out;
    }
    case 'array':
      return node.items.map(toValue);
    case 'null':
      return null;
    default:
      return node.value;
  }
}

/**
 * Reads a figure's JSON source leniently.
 *
 * Returns the AST (ranges into `source`), its plain value (duplicate keys:
 * last wins) and diagnostics, errors first then by position. A fatal syntax
 * error returns no AST and exactly one `json.syntax` error, so the problems
 * list shows the one thing to fix.
 */
export function parseFigureSource(source: string): ParseResult {
  const window = contentWindow(source);
  const reader = new Reader(source, window.start, window.end);
  try {
    reader.skipTrivia();
    if (reader.pos >= window.end) {
      reader.fail('The source is empty; expected a JSON object.', [reader.pos, reader.pos]);
    }
    const ast = reader.parseValue('', 0);
    reader.skipTrivia();
    if (reader.pos < window.end) {
      const c = reader.code(reader.pos);
      reader.fail(
        c === RBRACE || c === RBRACKET
          ? `Unexpected '${String.fromCharCode(c)}' after the end of the JSON value; the brackets are unbalanced.`
          : 'Unexpected text after the end of the JSON value.',
        [reader.pos, window.end],
      );
    }
    if (window.afterFence !== null) {
      reader.fail('Unexpected text after the closing Markdown fence.', [window.afterFence, source.length]);
    }
    const diagnostics = reader.diagnostics
      .map((diagnostic, index) => ({ diagnostic, index }))
      .sort(
        (a, b) =>
          severityRank(a.diagnostic.severity) - severityRank(b.diagnostic.severity) ||
          (a.diagnostic.range?.[0] ?? 0) - (b.diagnostic.range?.[0] ?? 0) ||
          a.index - b.index,
      )
      .map(({ diagnostic }) => diagnostic);
    return { ast, value: toValue(ast), diagnostics };
  } catch (error) {
    if (error instanceof ParseFailure) return { ast: null, value: null, diagnostics: [error.diagnostic] };
    throw error;
  }
}

// One-entry memo: normalise asks for many positions in the same source.
let memoSource: string | null = null;
let memoStarts: number[] = [0];

function lineStarts(source: string): number[] {
  if (source === memoSource) return memoStarts;
  const starts = [0];
  for (let i = 0; i < source.length; i++) {
    const c = source.charCodeAt(i);
    if (c === LF || (c === CR && source.charCodeAt(i + 1) !== LF)) starts.push(i + 1);
  }
  memoSource = source;
  memoStarts = starts;
  return starts;
}

/**
 * 1-based line and column of a UTF-16 offset (the editor's unit), clamped to
 * the text. `\n`, `\r\n` and a lone `\r` each end a line.
 */
export function lineColumn(source: string, offset: number): { line: number; column: number } {
  const at = Number.isFinite(offset) ? Math.max(0, Math.min(source.length, Math.floor(offset))) : 0;
  const starts = lineStarts(source);
  let lo = 0;
  let hi = starts.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (starts[mid] <= at) lo = mid;
    else hi = mid - 1;
  }
  return { line: lo + 1, column: at - starts[lo] + 1 };
}
