/**
 * The composer is a `contenteditable`, but its model is a plain string: the
 * agent is sent text with `#doc/…` references in it, and each reference is
 * drawn as one atomic chip the caret cannot land inside.
 *
 * These helpers are the bridge. They exist because the previous version read
 * only the host's *direct* children and counted anything that was not a text
 * node or a chip as zero characters — so the moment a browser answered a
 * keystroke with a `<br>` or a wrapper `<div>`, every character after it
 * silently vanished from what got sent.
 */

type Atom =
  /** A run of literal characters. */
  | { kind: 'text'; node: Text; length: number }
  /** A reference chip: one indivisible run of `#doc/…`. */
  | { kind: 'ref'; node: HTMLElement; text: string }
  /** A line break — a `<br>`, or the boundary of a block wrapper. */
  | { kind: 'break'; node: Node };

/**
 * A reference chip. Deliberately not a type guard: narrowing an element that
 * is already an `HTMLElement` leaves the *else* branch typed `never`.
 */
export function isRefTag(node: Node | null | undefined): boolean {
  return (
    !!node &&
    node.nodeType === Node.ELEMENT_NODE &&
    typeof (node as HTMLElement).dataset?.refText === 'string'
  );
}

/**
 * A `<br>` that exists only so a trailing empty line stays visible.
 *
 * It carries no character of its own; counting it would append a newline the
 * author never typed, and that newline would come back on the next keystroke.
 */
function isFiller(node: Node): boolean {
  return node.nodeType === Node.ELEMENT_NODE && 'filler' in (node as HTMLElement).dataset;
}

/** Every model-bearing node under `root`, in document order. */
function atomsOf(root: Node): Atom[] {
  const atoms: Atom[] = [];

  const visit = (node: Node) => {
    for (const child of Array.from(node.childNodes)) {
      if (child.nodeType === Node.TEXT_NODE) {
        atoms.push({ kind: 'text', node: child as Text, length: (child.textContent ?? '').length });
        continue;
      }
      if (child.nodeType !== Node.ELEMENT_NODE) continue;

      const element = child as HTMLElement;
      if (isFiller(element)) continue;
      if (isRefTag(element)) {
        atoms.push({ kind: 'ref', node: element, text: element.dataset.refText ?? '' });
        continue;
      }
      if (element.tagName === 'BR') {
        atoms.push({ kind: 'break', node: element });
        continue;
      }
      // A browser that answers Enter with `<div>…</div>` instead of a newline.
      // Its boundary is one newline in the model; its contents are ordinary.
      if (atoms.length) atoms.push({ kind: 'break', node: element });
      visit(element);
    }
  };

  visit(root);
  return atoms;
}

const atomText = (atom: Atom): string =>
  atom.kind === 'text' ? atom.node.textContent ?? '' : atom.kind === 'ref' ? atom.text : '\n';

const atomLength = (atom: Atom): number => atomText(atom).length;

/** The composer's value, as read back out of the DOM. */
export function textOf(root: HTMLElement): string {
  return atomsOf(root).map(atomText).join('');
}

/** Where a DOM selection sits in the model, or `null` if it is not in `root`. */
export function indexOfSelection(root: HTMLElement, container: Node, offset: number): number | null {
  if (!root.contains(container)) return null;

  const atoms = atomsOf(root);
  const starts = new Map<Node, number>();
  let cursor = 0;
  for (const atom of atoms) {
    starts.set(atom.node, cursor);
    cursor += atomLength(atom);
  }
  const total = cursor;

  if (container.nodeType === Node.TEXT_NODE) {
    const start = starts.get(container);
    if (start === undefined) return null;
    return start + Math.min(offset, (container.textContent ?? '').length);
  }

  // An element container addresses a child *position*, not a character.
  const anchor = container.childNodes[offset] as Node | undefined;
  if (anchor) {
    for (const atom of atoms) {
      if (atom.node === anchor || anchor.contains(atom.node)) return starts.get(atom.node) ?? 0;
    }
    // Nothing model-bearing at or after the anchor within it: fall through to
    // whatever follows it in document order.
    for (const atom of atoms) {
      if (anchor.compareDocumentPosition(atom.node) & Node.DOCUMENT_POSITION_FOLLOWING) {
        return starts.get(atom.node) ?? 0;
      }
    }
    return total;
  }

  // Past the last child of the container: the end of its own content.
  let end = 0;
  let seen = false;
  for (const atom of atoms) {
    if (container === atom.node || container.contains(atom.node)) {
      seen = true;
      end = (starts.get(atom.node) ?? 0) + atomLength(atom);
    }
  }
  return seen ? end : total;
}

/** The DOM position for a model index, ready for `Range.setStart`. */
export function positionOfIndex(
  root: HTMLElement,
  index: number,
): { node: Node; offset: number } {
  const atoms = atomsOf(root);
  let cursor = 0;

  for (const atom of atoms) {
    const length = atomLength(atom);
    if (atom.kind === 'text') {
      if (index <= cursor + length) return { node: atom.node, offset: Math.max(index - cursor, 0) };
    } else {
      // Chips and breaks are atomic: the caret goes before or after, never in.
      const parent = atom.node.parentNode;
      if (parent) {
        const at = Array.prototype.indexOf.call(parent.childNodes, atom.node);
        if (index <= cursor) return { node: parent, offset: at };
        if (index <= cursor + length) return { node: parent, offset: at + 1 };
      }
    }
    cursor += length;
  }

  return { node: root, offset: root.childNodes.length };
}

/**
 * Rebuild the host's DOM from a model string.
 *
 * Newlines stay literal characters — the host renders with `pre-wrap` — so the
 * DOM the browser hands back matches what was put in, and nothing has to guess
 * how this particular engine spells "line break".
 */
export function renderInto(root: HTMLElement, parts: Array<string | HTMLElement>): void {
  const fragment = document.createDocumentFragment();
  for (const part of parts) {
    fragment.appendChild(typeof part === 'string' ? document.createTextNode(part) : part);
  }

  // A line break at the end of a block is collapsed away, so without a filler
  // a trailing newline has no line box: the author's blank line looks refused,
  // and there is nowhere to put the caret after a trailing chip. A trailing
  // `<br>` is itself collapsed, so it costs nothing when neither applies.
  const filler = document.createElement('br');
  filler.dataset.filler = '';
  fragment.appendChild(filler);

  root.replaceChildren(fragment);
}

/**
 * Insert text at a selection, the way a paste or a Shift+Enter does.
 *
 * Returned rather than applied so the caller updates its own state and lets
 * the render put the DOM right — `document.execCommand` is deprecated, and
 * what it produces differs per browser in exactly the ways this file exists to
 * paper over.
 */
export function spliceText(
  value: string,
  selection: { start: number; end: number },
  insert: string,
  maxLength?: number,
): { value: string; caret: number } {
  const start = Math.max(0, Math.min(selection.start, value.length));
  const end = Math.max(start, Math.min(selection.end, value.length));
  const room = maxLength === undefined ? insert.length : maxLength - (value.length - (end - start));
  const text = room <= 0 ? '' : insert.slice(0, room);
  return { value: value.slice(0, start) + text + value.slice(end), caret: start + text.length };
}
