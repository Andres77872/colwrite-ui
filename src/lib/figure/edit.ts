import { normalizeFigure } from './normalize';
import { MathTracker, parseFigureSource } from './parse';
import { vocabularyKey } from './vocabulary';
import type {
  FigureModel,
  JsonMember,
  JsonNode,
  JsonNumberNode,
  JsonObjectNode,
  JsonStringNode,
  JsonValue,
} from './types';

/**
 * Text edits on a figure's source.
 *
 * The inspector changes one property of one item by rewriting only that
 * property's text, so the author's comments, key order and layout survive
 * and the assistant later reads exactly what the author sees. Format
 * re-prints the whole spec as strict, compact JSON and keeps its comments.
 */

/** Line width the printer fills before it breaks a container over lines. */
const PRINT_WIDTH = 80;
const INDENT_UNIT = '  ';
const IDENTIFIER_KEY = /^[A-Za-z_$][\w$-]*$/;

type Found = { node: JsonNode; path: string };

function lastMember(object: JsonObjectNode, key: string): JsonMember | null {
  for (let i = object.members.length - 1; i >= 0; i--) {
    if (object.members[i].key === key) return object.members[i];
  }
  return null;
}

/** Whether `member` is `key` in any spelling normalisation accepts for it (`Tone`, `font_size`). */
function spells(member: JsonMember, key: string): boolean {
  return vocabularyKey(member.key) === vocabularyKey(key);
}

/** The member normalisation reads for `key`: the last one, in any spelling. */
function effectiveMember(object: JsonObjectNode, key: string): JsonMember | null {
  for (let i = object.members.length - 1; i >= 0; i--) {
    if (spells(object.members[i], key)) return object.members[i];
  }
  return null;
}

/** The node spanning exactly [start, end), or null. */
function nodeAt(node: JsonNode, start: number, end: number): JsonNode | null {
  if (node.start === start && node.end === end) return node;
  const children = node.kind === 'object' ? node.members.map((member) => member.value) : node.kind === 'array' ? node.items : [];
  const child = children.find((candidate) => candidate.start <= start && end <= candidate.end);
  return child ? nodeAt(child, start, end) : null;
}

function modelOf(ast: JsonNode): FigureModel | null {
  try {
    return normalizeFigure({ ast, value: null, diagnostics: [] }).model;
  } catch {
    // The compiler reports the crash; an edit just finds nothing.
    return null;
  }
}

/**
 * Find the object (or shorthand string or number) that defines a node/group with this id.
 *
 * Normalisation decides what defines an item (an id derived from the label,
 * a map-form list, any spelling of a key, a trimmed shorthand, the winner
 * among namesakes) and records where, so this reads that record instead of
 * guessing. Pass `model` when it was already normalised from this `ast`.
 */
export function findItemNode(ast: JsonNode, id: string, model: FigureModel | null = modelOf(ast)): Found | null {
  const item = model?.items.get(id);
  if (!item?.range) return null;
  const node = nodeAt(ast, item.range[0], item.range[1]);
  return node && { node, path: item.path };
}

/**
 * Set (value !== undefined) or delete (undefined) `key` on the item's object, editing text in place so
 * comments/formatting elsewhere survive; a shorthand string item is first expanded to
 * `{"id": "...", "label": "..."}`. Returns the new source, or null when the item is not found.
 *
 * Setting replaces the effective (last) duplicate's value, in whichever
 * spelling of the key it is written, or appends a member in the object's own
 * style: its indentation, key quoting and `:` spacing, one line when the
 * object is written on one line. Deleting removes every duplicate and
 * spelling with its comma, and its whole line when it stands alone on it.
 * The item keeps its id: one derived from the label is written in when a
 * change would move it (see `keepId`).
 */
export function setItemProperty(
  source: string,
  id: string,
  key: string,
  value: JsonValue | undefined,
): string | null {
  const { ast } = parseFigureSource(source);
  if (!ast) return null;
  const found = findItemNode(ast, id);
  if (!found) return null;
  const { node } = found;
  let next: string;
  if (node.kind === 'string' || node.kind === 'number') next = expandShorthand(source, node, id, key, value);
  else if (node.kind === 'object') next = value === undefined ? deleteKey(source, node, key) : setKey(source, node, key, value);
  else return null;
  // Renaming is the one change meant to move the id.
  return next === source || vocabularyKey(key) === 'id' ? next : keepId(next, node.start, id);
}

/**
 * An id derived from the label follows it, so relabelling `{"label": "Encoder"}`
 * would turn item `encoder` into `encoder-stack` (or hand `encoder` to a
 * namesake): the edges that name it and the inspector's selection would lose
 * it. When the edited item, still starting at `start`, no longer has `id`,
 * the id is written in.
 */
function keepId(source: string, start: number, id: string): string {
  const { ast } = parseFigureSource(source);
  if (!ast) return source;
  if (modelOf(ast)?.items.get(id)?.range?.[0] === start) return source;
  const object = objectAt(ast, start);
  return object ? setKey(source, object, 'id', id) : source;
}

/**
 * Pretty-print (2-space JSON, stable key order = as written); null when the source does not parse.
 *
 * Strings and keys come out strict (LaTeX backslashes doubled), a container
 * that fits in 80 columns and holds no objects stays on one line (`[8, 8]`,
 * `{ "id": "q", "label": "$Q$" }`), and comments are kept next to the
 * member they annotate. A duplicate key keeps only its winning member.
 */
export function formatFigureSource(source: string): string | null {
  const { ast } = parseFigureSource(source);
  if (!ast) return null;
  const doc = docFromAst(ast, source);
  const leading = gapComments(source, 0, ast.start).map((comment) => comment.text);
  const after = gapComments(source, ast.end, source.length);
  let body = render(doc, '', 0, INDENT_UNIT, true);
  const sameLine = after.filter((comment) => comment.sameLine).map((comment) => comment.text);
  if (sameLine.length) body += ` ${sameLine.join(' ')}`;
  const below = after.filter((comment) => !comment.sameLine).map((comment) => comment.text);
  return [...leading, body, ...below].join('\n');
}

/* ────────────────────────────────────────────────────────────────────────
 * Setting and deleting members
 * ──────────────────────────────────────────────────────────────────────── */

type Edit = { start: number; end: number; text: string };

/** Applies edits from the end backwards; inserted line breaks follow the source's own (`\r\n` or `\n`). */
function applyEdits(source: string, edits: Edit[]): string {
  const eol = source.includes('\r\n') ? '\r\n' : '\n';
  let out = source;
  for (const edit of [...edits].sort((a, b) => b.start - a.start)) {
    const text = eol === '\n' ? edit.text : edit.text.replace(/\n/g, eol);
    out = out.slice(0, edit.start) + text + out.slice(edit.end);
  }
  return out;
}

function isBreakCode(c: number): boolean {
  return c === 0x0a || c === 0x0d || c === 0x2028 || c === 0x2029;
}

function hasBreak(source: string, from: number, to: number): boolean {
  for (let i = from; i < to; i++) if (isBreakCode(source.charCodeAt(i))) return true;
  return false;
}

function lineStart(source: string, pos: number): number {
  let i = pos;
  while (i > 0 && !isBreakCode(source.charCodeAt(i - 1))) i--;
  return i;
}

/** The whitespace before `pos` on its line, or null when anything else precedes it there. */
function ownLineIndent(source: string, pos: number): string | null {
  const before = source.slice(lineStart(source, pos), pos);
  return /^[ \t]*$/.test(before) ? before : null;
}

function lineIndent(source: string, pos: number): string {
  return /^[ \t]*/.exec(source.slice(lineStart(source, pos), pos))?.[0] ?? '';
}

function skipSpaces(source: string, pos: number): number {
  let i = pos;
  while (i < source.length && (source[i] === ' ' || source[i] === '\t')) i++;
  return i;
}

/** Skips whitespace and comments; the gaps between AST nodes hold nothing else but `,` and `:`. */
function skipTrivia(source: string, pos: number, limit: number): number {
  let i = pos;
  while (i < limit) {
    const c = source.charCodeAt(i);
    if (c === 0x20 || c === 0x09 || isBreakCode(c) || c === 0x0b || c === 0x0c || c === 0xa0 || c === 0xfeff) {
      i++;
    } else if (source.startsWith('//', i)) {
      while (i < limit && !isBreakCode(source.charCodeAt(i))) i++;
    } else if (source.startsWith('/*', i)) {
      const close = source.indexOf('*/', i + 2);
      i = close < 0 ? limit : close + 2;
    } else {
      break;
    }
  }
  return i;
}

/** Offset of the `,` that follows `pos` (past trivia, before `limit`), or -1. */
function commaAfter(source: string, pos: number, limit: number): number {
  const i = skipTrivia(source, pos, limit);
  return i < limit && source[i] === ',' ? i : -1;
}

/**
 * The rest of the line after `pos` when it holds only spaces and comments:
 * `end` is past the line break (`full`), else `pos` itself.
 */
function lineTail(source: string, pos: number): { end: number; full: boolean } {
  let i = skipSpaces(source, pos);
  for (;;) {
    if (source.startsWith('//', i)) {
      while (i < source.length && !isBreakCode(source.charCodeAt(i))) i++;
    } else if (source.startsWith('/*', i)) {
      const close = source.indexOf('*/', i + 2);
      if (close < 0 || hasBreak(source, i, close)) break;
      i = skipSpaces(source, close + 2);
      continue;
    }
    break;
  }
  if (i >= source.length) return { end: i, full: true };
  const c = source.charCodeAt(i);
  if (c === 0x0d && source.charCodeAt(i + 1) === 0x0a) return { end: i + 2, full: true };
  if (isBreakCode(c)) return { end: i + 1, full: true };
  return { end: pos, full: false };
}

/** End of `pos`'s line content, past trailing spaces and same-line comments, before the break. */
function lineContentEnd(source: string, pos: number): number {
  const tail = lineTail(source, pos);
  if (!tail.full) return pos;
  let end = tail.end;
  if (end > pos && isBreakCode(source.charCodeAt(end - 1))) end--;
  if (end > pos && source.charCodeAt(end) === 0x0a && source.charCodeAt(end - 1) === 0x0d) end--;
  return end;
}

type Style = {
  /** Whether members sit on their own lines. */
  multiLine: boolean;
  /** Indentation of a member line. */
  indent: string;
  /** One nesting step, as the object writes it. */
  unit: string;
  /** Text between a key and its value, e.g. `: `. */
  colon: string;
  /** Whether keys are written bare. */
  bareKeys: boolean;
};

function objectStyle(source: string, object: JsonObjectNode): Style {
  const base = lineIndent(source, object.start);
  let indent: string | null = null;
  for (const member of object.members) {
    indent = ownLineIndent(source, member.start);
    if (indent !== null) break;
  }
  const unit =
    indent !== null && indent.length > base.length && indent.startsWith(base) ? indent.slice(base.length) : INDENT_UNIT;
  const first = object.members[0];
  const between = first ? source.slice(first.keyEnd, first.value.start) : '';
  const firstChar = first ? source[first.keyStart] : '"';
  return {
    multiLine: indent !== null,
    indent: indent ?? base + unit,
    unit,
    colon: /^[ \t]*:[ \t]*$/.test(between) ? between : ': ',
    bareKeys: firstChar !== '"' && firstChar !== "'",
  };
}

function keyText(key: string, style: Style): string {
  return style.bareKeys && IDENTIFIER_KEY.test(key) ? key : encodeJsonString(key);
}

/** A value printed where it starts at `column` on a line indented by `indent`. */
function valueText(value: JsonValue, style: Style, column: number, oneLine: boolean): string {
  const doc = docFromValue(value);
  if (oneLine) {
    const flat = inline(doc);
    if (flat !== null) return flat;
  }
  return render(doc, style.indent, column, style.unit);
}

function setKey(source: string, object: JsonObjectNode, key: string, value: JsonValue): string {
  const style = objectStyle(source, object);
  const existing = effectiveMember(object, key);
  if (existing) {
    const at = existing.value.start;
    const memberStyle = { ...style, indent: lineIndent(source, existing.start) };
    const text = valueText(value, memberStyle, at - lineStart(source, at), !style.multiLine);
    return applyEdits(source, [{ start: at, end: existing.value.end, text }]);
  }

  const head = `${keyText(key, style)}${style.colon}`;
  const members = object.members;
  if (members.length === 0) {
    // Not reachable through an id (an addressable object has an `id` member); kept total.
    return applyEdits(source, [{ start: object.start, end: object.end, text: `{ ${head}${valueText(value, style, 0, true)} }` }]);
  }

  const last = members[members.length - 1];
  const trailingComma = commaAfter(source, last.end, object.end - 1);
  if (!style.multiLine) {
    const member = head + valueText(value, style, 0, true);
    return applyEdits(source, [{ start: last.end, end: last.end, text: `, ${member}` }]);
  }
  const member = head + valueText(value, style, style.indent.length + head.length, false);
  // A new line after the last member, past its comma and same-line comment,
  // keeping a trailing comma if the object uses them.
  const anchor = lineContentEnd(source, trailingComma >= 0 ? trailingComma + 1 : last.end);
  const line = `\n${style.indent}${member}${trailingComma >= 0 ? ',' : ''}`;
  if (trailingComma >= 0) return applyEdits(source, [{ start: anchor, end: anchor, text: line }]);
  // No comma yet: one goes right after the last value (edits at one offset apply in order).
  return applyEdits(source, [
    { start: anchor, end: anchor, text: line },
    { start: last.end, end: last.end, text: ',' },
  ]);
}

function objectAt(node: JsonNode, start: number): JsonObjectNode | null {
  if (node.kind === 'object') {
    if (node.start === start) return node;
    for (const member of node.members) {
      if (member.value.start <= start && start < member.value.end) return objectAt(member.value, start);
    }
  } else if (node.kind === 'array') {
    for (const item of node.items) {
      if (item.start <= start && start < item.end) return objectAt(item, start);
    }
  }
  return null;
}

function deleteKey(source: string, object: JsonObjectNode, key: string): string {
  let text = source;
  let current: JsonObjectNode | null = object;
  // Duplicates go last first; after each removal the object is read again,
  // since what "last member" means has changed. Its start never moves.
  while (current) {
    let index = -1;
    for (let i = current.members.length - 1; i >= 0 && index < 0; i--) {
      if (spells(current.members[i], key)) index = i;
    }
    if (index < 0) return text;
    text = removeMember(text, current, index);
    const reread = parseFigureSource(text).ast;
    current = reread ? objectAt(reread, object.start) : null;
  }
  return text;
}

function removeMember(source: string, object: JsonObjectNode, index: number): string {
  const members = object.members;
  const member = members[index];
  const prev = index > 0 ? members[index - 1] : null;
  const next = index + 1 < members.length ? members[index + 1] : null;
  const own = ownLineIndent(source, member.start) !== null;
  const wholeLine = (from: number): Edit | null => {
    const tail = lineTail(source, from);
    return own && tail.full ? { start: lineStart(source, member.start), end: tail.end, text: '' } : null;
  };

  const comma = commaAfter(source, member.end, next ? next.start : object.end - 1);
  if (comma >= 0) {
    const edit = wholeLine(comma + 1) ?? { start: member.start, end: skipSpaces(source, comma + 1), text: '' };
    return applyEdits(source, [edit]);
  }
  if (prev) {
    // The last member: its predecessor's comma goes with it.
    const line = wholeLine(member.end);
    if (!line) return applyEdits(source, [{ start: prev.end, end: member.end, text: '' }]);
    const prevComma = commaAfter(source, prev.end, member.start);
    return applyEdits(source, prevComma >= 0 ? [line, { start: prevComma, end: prevComma + 1, text: '' }] : [line]);
  }
  if (next) {
    // The first member of a pair written without a comma.
    return applyEdits(source, [wholeLine(member.end) ?? { start: member.start, end: next.start, text: '' }]);
  }
  const before = source.slice(object.start + 1, member.start);
  const after = source.slice(member.end, object.end - 1);
  if (/^\s*$/.test(before) && /^\s*$/.test(after)) {
    return applyEdits(source, [{ start: object.start, end: object.end, text: '{}' }]);
  }
  return applyEdits(source, [wholeLine(member.end) ?? { start: member.start, end: member.end, text: '' }]);
}

/**
 * A shorthand `"Q"` becomes `{ "id": "Q", "label": "Q" }` with the change
 * applied. The id is the one normalisation gave it: the text trimmed, or the
 * key of a map-form list (`"q": "Query"`), whose text is then the label.
 */
function expandShorthand(
  source: string,
  node: JsonStringNode | JsonNumberNode,
  id: string,
  key: string,
  value: JsonValue | undefined,
): string {
  const written = String(node.value);
  const entries: Array<[string, JsonValue]> = [
    ['id', id],
    ['label', written.trim() === id ? id : written],
  ];
  const index = entries.findIndex(([name]) => vocabularyKey(name) === vocabularyKey(key));
  if (value === undefined) {
    if (index < 0) return source;
    entries.splice(index, 1);
  } else if (index >= 0) {
    entries[index][1] = value;
  } else {
    entries.push([key, value]);
  }
  const doc = container(
    '{',
    entries.map(([name, entry]) => ({ key: encodeJsonString(name), value: docFromValue(entry), leading: [], trailing: [] })),
    [],
  );
  const text = inline(doc) ?? render(doc, lineIndent(source, node.start), node.start - lineStart(source, node.start), INDENT_UNIT);
  return applyEdits(source, [{ start: node.start, end: node.end, text }]);
}

/* ────────────────────────────────────────────────────────────────────────
 * Printing
 * ──────────────────────────────────────────────────────────────────────── */

type DocEntry = {
  /** Encoded key, or null for an array item. */
  key: string | null;
  value: Doc;
  leading: string[];
  trailing: string[];
};

type Doc =
  | { kind: 'scalar'; text: string }
  | { kind: 'container'; open: '{' | '['; close: '}' | ']'; entries: DocEntry[]; dangling: string[] };

type Comment = { text: string; sameLine: boolean };

/**
 * Comments in the gap [from, to) between two AST nodes, and whether each
 * starts on the line where the gap does (a trailing comment).
 */
function gapComments(source: string, from: number, to: number): Comment[] {
  const out: Comment[] = [];
  let sameLine = true;
  let i = from;
  while (i < to) {
    const c = source.charCodeAt(i);
    if (isBreakCode(c)) {
      sameLine = false;
      i++;
    } else if (source.startsWith('//', i)) {
      let end = i + 2;
      while (end < to && !isBreakCode(source.charCodeAt(end))) end++;
      out.push({ text: source.slice(i, end).trimEnd(), sameLine });
      i = end;
    } else if (source.startsWith('/*', i)) {
      const close = source.indexOf('*/', i + 2);
      const end = close < 0 || close + 2 > to ? to : close + 2;
      out.push({ text: source.slice(i, end), sameLine });
      if (hasBreak(source, i, end)) sameLine = false;
      i = end;
    } else {
      i++;
    }
  }
  return out;
}

const STRICT_NUMBER = /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?$/;

function docFromAst(node: JsonNode, source: string): Doc {
  switch (node.kind) {
    case 'string':
      return { kind: 'scalar', text: encodeJsonString(node.value) };
    case 'number': {
      const written = source.slice(node.start, node.end);
      return { kind: 'scalar', text: STRICT_NUMBER.test(written) ? written : JSON.stringify(node.value) };
    }
    case 'boolean':
      return { kind: 'scalar', text: node.value ? 'true' : 'false' };
    case 'null':
      return { kind: 'scalar', text: 'null' };
    case 'array':
    case 'object': {
      const children =
        node.kind === 'object'
          ? node.members.map((member) => ({
              start: member.start,
              end: member.end,
              key: member.key as string | null,
              value: member.value,
              inner: gapComments(source, member.keyEnd, member.value.start),
            }))
          : node.items.map((item) => ({ start: item.start, end: item.end, key: null, value: item, inner: [] }));
      const entries: DocEntry[] = [];
      let gapStart = node.start + 1;
      for (const child of children) {
        const leading: string[] = [];
        for (const comment of gapComments(source, gapStart, child.start)) {
          const prev = entries[entries.length - 1];
          if (comment.sameLine && prev) prev.trailing.push(comment.text);
          else leading.push(comment.text);
        }
        leading.push(...child.inner.map((comment) => comment.text));
        entries.push({
          key: child.key === null ? null : encodeJsonString(child.key),
          value: docFromAst(child.value, source),
          leading,
          trailing: [],
        });
        gapStart = child.end;
      }
      const dangling: string[] = [];
      for (const comment of gapComments(source, gapStart, node.end - 1)) {
        const prev = entries[entries.length - 1];
        if (comment.sameLine && prev) prev.trailing.push(comment.text);
        else dangling.push(comment.text);
      }
      if (node.kind === 'object') return container('{', dropOverridden(node, entries), dangling);
      return container('[', entries, dangling);
    }
  }
}

function container(open: '{' | '[', entries: DocEntry[], dangling: string[]): Doc {
  return { kind: 'container', open, close: open === '{' ? '}' : ']', entries, dangling };
}

/**
 * Keeps the winning (last) member of each duplicate key where it stands; the
 * comments of the members it overrides move in front of it, since they were
 * about the same key.
 */
function dropOverridden(node: JsonObjectNode, entries: DocEntry[]): DocEntry[] {
  const carried = new Map<string, string[]>();
  const kept: DocEntry[] = [];
  node.members.forEach((member, i) => {
    const entry = entries[i];
    const comments = carried.get(member.key) ?? [];
    if (lastMember(node, member.key) !== member) {
      carried.set(member.key, [...comments, ...entry.leading, ...entry.trailing]);
      return;
    }
    entry.leading.unshift(...comments);
    kept.push(entry);
  });
  return kept;
}

/** Like `JSON.stringify`: an `undefined` member is left out, an `undefined` item prints as null. */
function docFromValue(value: JsonValue | undefined): Doc {
  if (value === null || value === undefined) return { kind: 'scalar', text: 'null' };
  if (typeof value === 'string') return { kind: 'scalar', text: encodeJsonString(value) };
  if (typeof value === 'number') return { kind: 'scalar', text: JSON.stringify(value) };
  if (typeof value === 'boolean') return { kind: 'scalar', text: value ? 'true' : 'false' };
  if (Array.isArray(value)) {
    return container(
      '[',
      value.map((item) => ({ key: null, value: docFromValue(item), leading: [], trailing: [] })),
      [],
    );
  }
  return container(
    '{',
    Object.keys(value)
      .filter((key) => value[key] !== undefined)
      .map((key) => ({ key: encodeJsonString(key), value: docFromValue(value[key]), leading: [], trailing: [] })),
    [],
  );
}

/**
 * The one-line form of a container, or null when it must break: it holds a
 * comment, an object, or an array that itself holds a container.
 */
function inline(doc: Doc): string | null {
  if (doc.kind === 'scalar') return doc.text;
  if (doc.dangling.length) return null;
  const parts: string[] = [];
  for (const entry of doc.entries) {
    if (entry.leading.length || entry.trailing.length) return null;
    const value = entry.value;
    if (value.kind === 'container') {
      if (value.open === '{' || value.dangling.length) return null;
      if (value.entries.some((item) => item.value.kind !== 'scalar' || item.leading.length || item.trailing.length)) {
        return null;
      }
    }
    const text = inline(value);
    if (text === null) return null;
    parts.push(entry.key === null ? text : `${entry.key}: ${text}`);
  }
  if (doc.open === '[') return `[${parts.join(', ')}]`;
  return parts.length ? `{ ${parts.join(', ')} }` : '{}';
}

/** Prints `doc` starting at `column` of a line indented by `indent`. */
function render(doc: Doc, indent: string, column: number, unit: string, expand = false): string {
  if (doc.kind === 'scalar') return doc.text;
  if (doc.entries.length === 0 && doc.dangling.length === 0) return doc.open + doc.close;
  if (!expand) {
    const flat = inline(doc);
    // +1 leaves room for the comma that usually follows.
    if (flat !== null && column + flat.length + 1 <= PRINT_WIDTH) return flat;
  }
  const inner = indent + unit;
  const lines: string[] = [doc.open];
  doc.entries.forEach((entry, i) => {
    for (const comment of entry.leading) lines.push(inner + comment);
    const head = entry.key === null ? '' : `${entry.key}: `;
    const body = render(entry.value, inner, inner.length + head.length, unit);
    const comma = i < doc.entries.length - 1 ? ',' : '';
    const trailing = entry.trailing.length ? ` ${entry.trailing.join(' ')}` : '';
    lines.push(inner + head + body + comma + trailing);
  });
  for (const comment of doc.dangling) lines.push(inner + comment);
  lines.push(indent + doc.close);
  return lines.join('\n');
}

const SHORT_ESCAPES: Record<number, string> = { 0x08: '\\b', 0x0c: '\\f', 0x0a: '\\n', 0x0d: '\\r', 0x09: '\\t' };

function isLowSurrogate(c: number): boolean {
  return c >= 0xdc00 && c <= 0xdfff;
}

function isAsciiLetter(c: number): boolean {
  const lower = c | 0x20;
  return lower >= 0x61 && lower <= 0x7a;
}

/**
 * `JSON.stringify` for a string, with one exception that keeps the output
 * round-tripping through the lenient reader: a tab, line break, backspace or
 * form feed inside maths right before a letter is written `\u00XX`, because
 * the reader would take `\t` + letter there for LaTeX (`\times`).
 */
function encodeJsonString(value: string): string {
  let out = '"';
  const math = new MathTracker();
  for (let i = 0; i < value.length; i++) {
    const c = value.charCodeAt(i);
    if (c === 0x22) out += '\\"';
    else if (c === 0x5c) out += '\\\\';
    else if (c < 0x20) {
      const short = SHORT_ESCAPES[c];
      out +=
        short && !(math.inMath && isAsciiLetter(value.charCodeAt(i + 1)))
          ? short
          : `\\u${c.toString(16).padStart(4, '0')}`;
    } else if (c >= 0xd800 && c <= 0xdbff && isLowSurrogate(value.charCodeAt(i + 1))) {
      out += value[i] + value[i + 1];
      math.push(c);
      i++;
      math.push(value.charCodeAt(i));
      continue;
    } else if (c >= 0xd800 && c <= 0xdfff) out += `\\u${c.toString(16)}`;
    else out += value[i];
    math.push(c);
  }
  return `${out}"`;
}
