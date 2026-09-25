/**
 * Plain-text editing for the code editables: code blocks, and the source of
 * diagrams and figures.
 *
 * The editable is a `plaintext-only` contenteditable, and the browser's idea
 * of a line is not the document's. `execCommand('insertText', '\n')` opens a
 * `<div>` per line, other paths leave `<br>`s, and `textContent` reads
 * neither as a newline, so lines that looked separate were saved joined. The
 * editable therefore reads its text the way the browser draws it
 * (`readCodeText`), keeps its DOM a single text node (`writeCodeText`), and
 * makes the edits that add or re-indent lines itself, as text.
 *
 * Offsets count characters of that text — the unit `captureCaretOffset` and
 * `restoreCaretOffset` use once the DOM is one text node.
 */

/** One press of Tab, and what Shift+Tab takes back. */
export const INDENT = '  ';

/** Elements a browser writes into the text that start a line of their own. */
const LINE_ELEMENTS = new Set(['DIV', 'P', 'PRE', 'LI', 'BLOCKQUOTE', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6']);

function isLineElement(node: Node): boolean {
  return node.nodeType === Node.ELEMENT_NODE && LINE_ELEMENTS.has(node.nodeName);
}

/** Whether anything is drawn for this node (comments and empty text are not). */
function isDrawn(node: Node): boolean {
  if (node.nodeType === Node.TEXT_NODE) return (node as Text).data !== '';
  return node.nodeType === Node.ELEMENT_NODE;
}

/**
 * Whether a `<br>` is the placeholder a browser keeps at the end of a line
 * rather than a line break: nothing drawn follows it before its line ends.
 * With `cut`, the end of `root` is only where a caret cut the text, so a
 * `<br>` right before it is a real break.
 */
function isPlaceholderBreak(br: Node, root: Node, cut: boolean): boolean {
  for (let node: Node = br; node !== root && node.parentNode; node = node.parentNode) {
    for (let next = node.nextSibling; next; next = next.nextSibling) {
      if (isLineElement(next)) return true;
      if (isDrawn(next)) return false;
    }
    if (node.parentNode !== root && isLineElement(node.parentNode)) return true;
  }
  return !cut;
}

/**
 * The text an editable shows, line for line.
 *
 * Text nodes are taken as they are; a `<br>` is a newline unless it is the
 * browser's end-of-line placeholder; a line element (`<div>`, `<p>`, …)
 * starts a new line. `white-space: pre` draws no line after a final newline,
 * so a browser keeps a second one there when an empty last line is opened:
 * that one is not part of the text.
 *
 * `cut` reads a fragment cloned up to the caret, whose end is not the end of
 * the text, to find the caret's offset in it.
 */
export function readCodeText(root: Node, { cut = false }: { cut?: boolean } = {}): string {
  let out = '';
  /** A line element ended: whatever is drawn next starts a new line. */
  let breakPending = false;
  /** The text so far ends in a newline no line was drawn for yet. */
  let openNewline = false;

  const append = (value: string, fromText: boolean) => {
    if (breakPending) {
      out += '\n';
      breakPending = false;
    }
    out += value;
    openNewline = fromText && value.endsWith('\n');
  };

  const visit = (parent: Node) => {
    for (let node = parent.firstChild; node; node = node.nextSibling) {
      if (node.nodeType === Node.TEXT_NODE) {
        const data = (node as Text).data;
        if (data) append(data, true);
      } else if (node.nodeName === 'BR') {
        if (!isPlaceholderBreak(node, root, cut)) append('\n', false);
        // A placeholder holds its line open: a newline before it is drawn.
        else openNewline = false;
      } else if (isLineElement(node)) {
        if (breakPending || (out !== '' && !out.endsWith('\n'))) out += '\n';
        breakPending = false;
        openNewline = false;
        visit(node);
        breakPending = true;
      } else if (node.nodeType === Node.ELEMENT_NODE) {
        visit(node);
      }
    }
  };

  visit(root);
  return !cut && openNewline ? out.slice(0, -1) : out;
}

/**
 * Put `text` into an editable as a single text node. A final newline gets a
 * `<br>` after it, so the empty last line is drawn and can hold the caret.
 */
export function writeCodeText(el: HTMLElement, text: string): void {
  el.textContent = text;
  if (text.endsWith('\n')) el.appendChild(document.createElement('br'));
}

/** Whether the editable holds `text` exactly as `writeCodeText` writes it. */
export function holdsCodeText(el: HTMLElement, text: string): boolean {
  const nodes = el.childNodes;
  if (text === '') return nodes.length === 0;
  const first = nodes[0];
  if (!first || first.nodeType !== Node.TEXT_NODE || (first as Text).data !== text) return false;
  return text.endsWith('\n') ? nodes.length === 2 && nodes[1].nodeName === 'BR' : nodes.length === 1;
}

/** Control characters the API refuses in a code block (tab and newlines stay). */
// eslint-disable-next-line no-control-regex
const CONTROL_CHARACTERS = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g;

/**
 * Text the canonical model accepts, with Unix line endings. One stray
 * control character fails the save of the whole document.
 */
export function cleanCodeText(text: string): string {
  return text.replace(/\r\n?/g, '\n').replace(CONTROL_CHARACTERS, '');
}

/** Terminal escape sequences: colours, cursor moves, window titles. */
// eslint-disable-next-line no-control-regex
const ANSI_SEQUENCE = /\u001b(?:\[[0-?]*[ -/]*[@-~]|\][^\u0007\u001b]*(?:\u0007|\u001b\\)|[@-Z\\-_])/g;

/**
 * Clipboard text made fit for a code block.
 *
 * Program output is pasted straight from terminals, so colour codes go, and
 * a line a carriage return redrew (a progress bar) keeps what it showed
 * last. Non-breaking spaces, which code copied from web pages and PDFs is
 * full of, become spaces, since a compiler does not read them as indentation.
 */
export function cleanPastedCode(text: string): string {
  const lines = text
    .replace(/\r\n/g, '\n')
    .replace(ANSI_SEQUENCE, '')
    .split('\n')
    .map((line) => {
      if (!line.includes('\r')) return line;
      const drawn = line.split('\r').filter((part) => part !== '');
      return drawn[drawn.length - 1] ?? '';
    });
  return cleanCodeText(lines.join('\n')).replace(/\u00a0/g, ' ');
}

/** An edit's result: the new text and the selection to put back. */
export type CodeEdit = { text: string; start: number; end: number };

/** Offset of the start of the line that holds `offset`. */
export function lineStartOf(text: string, offset: number): number {
  return offset <= 0 ? 0 : text.lastIndexOf('\n', offset - 1) + 1;
}

/** `[start, end)` replaced by `insert`, with the caret after it. */
export function replaceEdit(text: string, start: number, end: number, insert: string): CodeEdit {
  const caret = start + insert.length;
  return { text: text.slice(0, start) + insert + text.slice(end), start: caret, end: caret };
}

/** Enter: a new line, indented like the one the caret is on. */
export function newlineEdit(text: string, start: number, end: number): CodeEdit {
  const before = text.slice(lineStartOf(text, start), start);
  const indent = /^[ \t]*/.exec(before)?.[0] ?? '';
  return replaceEdit(text, start, end, `\n${indent}`);
}

/**
 * Starts of the lines a selection touches. One that ends at the very start
 * of a line leaves that line out, as in any code editor.
 */
function touchedLineStarts(text: string, start: number, end: number): number[] {
  const last = end > start && lineStartOf(text, end) === end ? end - 1 : end;
  const starts = [lineStartOf(text, start)];
  for (let i = text.indexOf('\n', starts[0]); i !== -1 && i < last; i = text.indexOf('\n', i + 1)) {
    starts.push(i + 1);
  }
  return starts;
}

/**
 * Tab: two spaces at the caret, or — with a selection — every line it
 * touches indented, the selection kept over the same text.
 */
export function indentEdit(text: string, start: number, end: number): CodeEdit {
  if (start === end) return replaceEdit(text, start, end, INDENT);
  const starts = touchedLineStarts(text, start, end).filter(
    (at) => at < text.length && text[at] !== '\n',
  );
  let next = text;
  for (let i = starts.length - 1; i >= 0; i--) next = next.slice(0, starts[i]) + INDENT + next.slice(starts[i]);
  // A selection that starts at the beginning of a line keeps the new indent in it.
  const shift = (position: number, inclusive: boolean) =>
    position + starts.filter((at) => at < position || (inclusive && at === position)).length * INDENT.length;
  return { text: next, start: shift(start, false), end: shift(end, true) };
}

/** Shift+Tab: one level of indentation taken off every line the selection touches. */
export function outdentEdit(text: string, start: number, end: number): CodeEdit {
  const removals = touchedLineStarts(text, start, end)
    .map((at) => {
      if (text[at] === '\t') return { at, count: 1 };
      let count = 0;
      while (count < INDENT.length && text[at + count] === ' ') count++;
      return { at, count };
    })
    .filter((removal) => removal.count > 0);
  if (removals.length === 0) return { text, start, end };
  let next = text;
  for (let i = removals.length - 1; i >= 0; i--) {
    const { at, count } = removals[i];
    next = next.slice(0, at) + next.slice(at + count);
  }
  // A position inside removed indentation lands where the line now starts.
  const shift = (position: number) =>
    removals.reduce(
      (moved, { at, count }) =>
        moved - (position >= at + count ? count : position > at ? position - at : 0),
      position,
    );
  return { text: next, start: shift(start), end: shift(end) };
}
