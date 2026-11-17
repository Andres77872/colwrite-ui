import { useCallback, useEffect, useSyncExternalStore } from 'react';
import {
  htmlToText,
  useBibliography,
  useEditorActions,
  type Block,
  type CitationChild,
  type ReferenceRecord,
  type ParagraphBlock,
} from '@/editor';
import { uid } from '@/lib/uid';
import { scrollBehavior } from '@/lib/motion';
import { serializeEditableHtml } from '@/components/common/Editable/editableHtml';
import { useToast } from '@/components/ui/toastContext';
import type { ToastOptions } from '@/components/ui/toastContext';
import { registerModuleReset } from '@/lib/moduleState';

/**
 * Where the author's caret last was in the document.
 *
 * Citing from a side panel or from the assistant's sources moves focus out of
 * the text, and the document selection goes with it. The last caret position
 * inside a prose block is remembered here, so "Cite" puts the citation where
 * the author was writing rather than somewhere else.
 *
 * It is kept as text offsets, not as a live `Range`: a Range points at DOM
 * nodes, and an editable that rewrites its markup (a widget remount, a state
 * rebase) leaves the Range pointing at detached nodes, or collapsed to the
 * start of the block. Offsets count prose characters only — widget labels
 * such as "[1]" are skipped — so they still mean the same place after the
 * widgets re-render. The Range is rebuilt from them when it is needed.
 */
type RememberedCaret = {
  blockId: string;
  /** The editable the offsets are counted in. */
  element: HTMLElement;
  /** Prose-character offsets of the selection's start and end. */
  start: number;
  end: number;
  /** The selected text, captured when it was selected. */
  selection: string | null;
  /**
   * The widget the caret sits directly after, with nothing between them.
   *
   * Widgets count for no prose characters, so the offset right before a
   * citation and the one right after it are the same number. Rebuilt from
   * the offset alone, a caret placed after "[1]" lands before it, and the
   * next citation would go in front of the first.
   */
  afterChildId?: string;
};

let remembered: RememberedCaret | null = null;

/** Whether a node sits inside an inline widget (a citation, an equation, …). */
function insideWidget(node: Node): boolean {
  const element = node.nodeType === Node.ELEMENT_NODE ? (node as Element) : node.parentElement;
  return Boolean(element?.closest('[data-child-id]'));
}

/** The node just before `node` in document order, staying inside `root`. */
function previousNode(node: Node, root: Node): Node | null {
  let current: Node | null = node;
  while (current && current !== root) {
    if (current.previousSibling) return current.previousSibling;
    current = current.parentNode;
  }
  return null;
}

/** Nothing at all between the widget and the caret. */
const NO_GAP = /^$/;
/** Only spaces between them: "[1] |" still reads as right after the citation. */
const SPACE_GAP = /^[\s\u00a0]*$/;

/**
 * The widget placeholder directly before (container, offset), when the text
 * between them matches `gap`. A line break, or any other character, ends the
 * search: the caret is then not "after" a widget.
 */
function widgetBefore(root: HTMLElement, container: Node, offset: number, gap: RegExp): HTMLElement | null {
  let node: Node | null;
  if (container.nodeType === Node.TEXT_NODE) {
    if (!gap.test((container as Text).data.slice(0, offset))) return null;
    node = previousNode(container, root);
  } else {
    node = offset > 0 ? (container.childNodes[offset - 1] ?? null) : previousNode(container, root);
  }
  while (node) {
    if (node.nodeType === Node.TEXT_NODE) {
      if (!gap.test((node as Text).data)) return null;
      node = previousNode(node, root);
    } else if (node.nodeType === Node.ELEMENT_NODE) {
      const element = node as HTMLElement;
      if (element.hasAttribute('data-child-id')) return element;
      if (element.tagName === 'BR') return null;
      // An inline wrapper (<b>, <span>) that ends right here: its last
      // character is the one before the caret.
      node = element.lastChild ?? previousNode(element, root);
    } else {
      node = previousNode(node, root);
    }
  }
  return null;
}

/** Prose characters between the start of `root` and (container, offset). */
export function proseOffset(root: HTMLElement, container: Node, offset: number): number {
  const pre = document.createRange();
  pre.selectNodeContents(root);
  pre.setEnd(container, offset);
  const holder = document.createElement('div');
  holder.appendChild(pre.cloneContents());
  holder.querySelectorAll('[data-child-id]').forEach((widget) => widget.remove());
  return (holder.textContent ?? '').length;
}

/** A block's prose: its text without the widgets' labels, as the offsets count it. */
export function proseText(root: HTMLElement): string {
  const holder = root.cloneNode(true) as HTMLElement;
  holder.querySelectorAll('[data-child-id]').forEach((widget) => widget.remove());
  return holder.textContent ?? '';
}

/** The id of the widget right before prose offset `offset` of `root`, with only spaces between, or `null`. */
export function widgetIdBefore(root: HTMLElement, offset: number): string | null {
  const at = prosePosition(root, offset);
  return widgetBefore(root, at.node, at.offset, SPACE_GAP)?.getAttribute('data-child-id') ?? null;
}

/** The DOM position `offset` prose characters into `root`, skipping widgets. */
export function prosePosition(root: HTMLElement, offset: number): { node: Node; offset: number } {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode: (node) => (insideWidget(node) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT),
  });
  let remaining = Math.max(0, offset);
  let node = walker.nextNode() as Text | null;
  while (node) {
    if (remaining <= node.data.length) return { node, offset: remaining };
    remaining -= node.data.length;
    node = walker.nextNode() as Text | null;
  }
  return { node: root, offset: root.childNodes.length };
}

/** A Range over prose offsets [start, end] of `root`. */
export function proseRange(root: HTMLElement, start: number, end: number): Range {
  const range = document.createRange();
  const from = prosePosition(root, start);
  range.setStart(from.node, from.offset);
  if (end > start) {
    const to = prosePosition(root, end);
    range.setEnd(to.node, to.offset);
  }
  return range;
}

/** The remembered caret, when its block is still on the page. */
function liveRemembered(): RememberedCaret | null {
  return remembered?.element.isConnected ? remembered : null;
}

/** The server refuses a longer selection; the start is what matters anyway. */
export const MAX_FOCUS_SELECTION_CHARS = 4000;

/** Where the author was working: the caret's block and any selected text. */
export type EditorFocus = { blockId: string; selection: string | null };

let focusSnapshot: EditorFocus | null = null;
const focusListeners = new Set<() => void>();
registerModuleReset(() => {
  remembered = null;
  focusSnapshot = null;
});

/** The plain text of a range, without citation labels and other widgets. */
function rangeText(range: Range): string | null {
  if (range.collapsed) return null;
  const holder = document.createElement('div');
  holder.appendChild(range.cloneContents());
  holder.querySelectorAll('[data-child-id]').forEach((widget) => widget.remove());
  const text = (holder.textContent ?? '').replace(/\u00a0/g, ' ').trim();
  return text ? text.slice(0, MAX_FOCUS_SELECTION_CHARS) : null;
}

/** Where the author's caret is now, or null when it left the document. */
export function currentFocus(): EditorFocus | null {
  const caret = liveRemembered();
  if (!caret) return null;
  return { blockId: caret.blockId, selection: caret.selection };
}

function publishFocus(): void {
  const next = currentFocus();
  if (next?.blockId === focusSnapshot?.blockId && next?.selection === focusSnapshot?.selection) return;
  focusSnapshot = next;
  focusListeners.forEach((listener) => listener());
}

function subscribeFocus(listener: () => void): () => void {
  focusListeners.add(listener);
  return () => focusListeners.delete(listener);
}

/**
 * The author's focus as React state, for surfaces outside the text — the
 * assistant shows the selection it is about to send along with a message.
 */
export function useEditorFocus(): EditorFocus | null {
  return useSyncExternalStore(subscribeFocus, () => focusSnapshot, () => null);
}

/** Mounted once by the canvas: keep `remembered` current. */
export function useRememberCaret(): void {
  useEffect(() => {
    const onChange = () => {
      const selection = window.getSelection();
      if (!selection || selection.rangeCount === 0) return;
      const node = selection.anchorNode;
      const element = node && (node.nodeType === Node.ELEMENT_NODE ? (node as HTMLElement) : node.parentElement);
      if (!element || element.closest('[data-child-id]')) return;
      const editable = element.closest('.editable');
      const blockId = editable?.closest('[data-block-id]')?.getAttribute('data-block-id');
      if (!editable || !blockId) return;
      // Focus already went somewhere else — a panel's search field, the link
      // field of the selection toolbar. A selection change reported now is
      // the browser collapsing a stale selection, not the author moving the
      // caret, and must not overwrite where they were.
      const active = document.activeElement;
      if (active && active !== document.body && !editable.contains(active)) return;
      const range = selection.getRangeAt(0);
      if (!editable.contains(range.startContainer) || !editable.contains(range.endContainer)) return;
      const root = editable as HTMLElement;
      const after = range.collapsed
        ? widgetBefore(root, range.startContainer, range.startOffset, NO_GAP)?.getAttribute('data-child-id')
        : null;
      remembered = {
        blockId,
        element: root,
        start: proseOffset(root, range.startContainer, range.startOffset),
        end: proseOffset(root, range.endContainer, range.endOffset),
        selection: rangeText(range),
        ...(after ? { afterChildId: after } : {}),
      };
      publishFocus();
    };
    document.addEventListener('selectionchange', onChange);
    return () => {
      document.removeEventListener('selectionchange', onChange);
      // The canvas is gone, and with it the document the caret was in.
      remembered = null;
      publishFocus();
    };
  }, []);
}

/** The block the author was last writing in, if it is still in the document. */
export function rememberedBlockId(): string | null {
  return liveRemembered()?.blockId ?? null;
}

/** The API's cap on keys in one citation (`MAX_CITATION_KEYS`). */
const MAX_CITATION_KEYS = 100;

/**
 * Where a cite went, so the caller can say so.
 *
 * - `caret`: a new citation at the author's caret.
 * - `merged`: the caret sat right after a citation, and the sources joined
 *   it ("[1]" becomes "[1, 2]"). `added` is 0 when it already cited them all.
 * - `fallback`: there was no usable caret, so the citation went to the end of
 *   a paragraph — the caret's own section when the caret was in a block that
 *   cannot hold one (a heading, a locked paragraph, code), else the last one.
 * - `new-paragraph`: the document had no paragraph to hold it.
 */
export type CitePlacement =
  | { where: 'caret'; blockId: string }
  | { where: 'merged'; blockId: string; added: number }
  | {
      where: 'fallback';
      blockId: string;
      /** Text of the heading the paragraph sits under, if any. */
      section: string | null;
      /** Whether the paragraph is the last one that can hold a citation. */
      last: boolean;
      /** Why the caret could not take it, when there was a caret. */
      caretBlock: 'heading' | 'locked' | 'other' | null;
    }
  | { where: 'new-paragraph'; blockId: string };

const SECTION_LABEL_CHARS = 48;

function sectionLabel(block: Block | undefined): string | null {
  if (block?.type !== 'heading') return null;
  const text = htmlToText(block.html).replace(/\s+/g, ' ').trim();
  if (!text) return null;
  return text.length > SECTION_LABEL_CHARS ? `${text.slice(0, SECTION_LABEL_CHARS - 1).trimEnd()}…` : text;
}

function scrollToBlock(blockId: string): void {
  if (typeof document === 'undefined') return;
  const reveal = () => {
    const node = document.querySelector(`[data-block-id="${CSS.escape(blockId)}"]`);
    if (node && typeof node.scrollIntoView === 'function') {
      node.scrollIntoView({ block: 'center', behavior: scrollBehavior() });
    }
  };
  // A new paragraph is only on the page after the next render.
  if (typeof requestAnimationFrame === 'function') requestAnimationFrame(reveal);
  else reveal();
}

/**
 * Cite sources at the author's caret — or, failing that, at the end of a
 * paragraph near it — and add them to the document's library.
 *
 * After a cite the caret is remembered right after the citation, so citing
 * again from a panel lands next to it, and joins it: two cites in a row read
 * "[1, 2]", not "[1][2]", and never "[1] … [2]" at the end of the document.
 * When the citation could not go at the caret, the paragraph that took it is
 * scrolled into view.
 *
 * Returns where it went, or null when there was nothing to cite.
 */
export function useCiteAtCursor(): (sources: readonly ReferenceRecord[]) => CitePlacement | null {
  const {
    refs,
    getBlock,
    getBlockIds,
    addParagraphChild,
    updateParagraphChild,
    updateHtml,
    upsertSources,
    insertBlocksAfter,
    markRecentlyChanged,
  } = useEditorActions();
  const bibliography = useBibliography();

  return useCallback(
    (sources) => {
      if (sources.length === 0) return null;
      upsertSources(sources);
      const child: CitationChild = {
        id: uid(),
        type: 'citation',
        keys: sources.map((source) => source.key),
        sources: [...sources],
        style: bibliography.documentStyle ?? bibliography.style,
      };

      const usable = (block: ReturnType<typeof getBlock>): block is ParagraphBlock =>
        block?.type === 'paragraph' && !block.locked && Boolean(refs.current[block.id]);

      const caret = remembered;
      const caretBlock = caret ? getBlock(caret.blockId) : undefined;
      let target: ParagraphBlock | undefined;
      let range: Range | null = null;
      if (usable(caretBlock) && caret) {
        target = caretBlock;
        const el = refs.current[target.id]!;
        // Right after a widget, the offset alone cannot say which side of it
        // the caret was on; the widget's placeholder can.
        const anchor = caret.afterChildId
          ? el.querySelector(`[data-child-id="${CSS.escape(caret.afterChildId)}"]`)
          : null;
        if (anchor?.parentNode && caret.start === caret.end) {
          const index = Array.prototype.indexOf.call(anchor.parentNode.childNodes, anchor) + 1;
          if (proseOffset(el, anchor.parentNode, index) === caret.end) {
            range = document.createRange();
            range.setStart(anchor.parentNode, index);
            range.collapse(true);
          }
        }
        if (!range) {
          // Rebuilt from offsets against the block as it is now, so a markup
          // rewrite since the caret was recorded does not move the citation.
          range = proseRange(el, caret.end, caret.end);
          range.collapse(true);
        }

        // Right after a citation: join it rather than start a second one.
        const neighbour = widgetBefore(el, range.startContainer, range.startOffset, SPACE_GAP);
        const neighbourId = neighbour?.getAttribute('data-child-id');
        const existing = neighbourId
          ? target.children?.find((candidate) => candidate.id === neighbourId)
          : undefined;
        if (existing?.type === 'citation') {
          const known = new Set(existing.keys);
          const fresh = sources.filter((source) => {
            const key = source.key;
            if (known.has(key)) return false;
            known.add(key);
            return true;
          });
          if (existing.keys.length + fresh.length <= MAX_CITATION_KEYS) {
            if (fresh.length > 0) {
              const carried = existing.sources ?? [];
              const carriedKeys = new Set(carried.map((source) => source.key));
              updateParagraphChild(target.id, existing.id, {
                keys: [...existing.keys, ...fresh.map((source) => source.key)],
                // A citation's `sources` name only its own keys, once each.
                sources: [...carried, ...fresh.filter((source) => !carriedKeys.has(source.key))],
              });
              markRecentlyChanged([target.id]);
            }
            remembered = { ...caret, start: caret.end, selection: null };
            publishFocus();
            return { where: 'merged', blockId: target.id, added: fresh.length };
          }
        }
      }

      let fallback: Extract<CitePlacement, { where: 'fallback' }> | null = null;
      if (!range) {
        const ids = getBlockIds();
        const lastUsable = (from: number, to: number): ParagraphBlock | undefined => {
          for (const id of ids.slice(from, to).reverse()) {
            const candidate = getBlock(id);
            if (usable(candidate)) return candidate;
          }
          return undefined;
        };
        // The caret was in a block that cannot hold a citation: keep it in
        // that block's section, from the heading at or above it to the next.
        const at = caretBlock ? ids.indexOf(caretBlock.id) : -1;
        if (at >= 0) {
          let start = at;
          const kindAt = (index: number) => {
            const id = ids[index];
            return id === undefined ? undefined : getBlock(id)?.type;
          };
          while (start > 0 && kindAt(start) !== 'heading') start -= 1;
          let end = at + 1;
          while (end < ids.length && kindAt(end) !== 'heading') end += 1;
          target = lastUsable(start, end);
        }
        const finalUsable = lastUsable(0, ids.length);
        target ??= finalUsable;
        if (target) {
          range = document.createRange();
          range.selectNodeContents(refs.current[target.id]!);
          range.collapse(false);
          let heading: Block | undefined;
          for (const id of ids.slice(0, ids.indexOf(target.id) + 1).reverse()) {
            const candidate = getBlock(id);
            if (candidate?.type === 'heading') {
              heading = candidate;
              break;
            }
          }
          fallback = {
            where: 'fallback',
            blockId: target.id,
            section: sectionLabel(heading),
            last: target.id === finalUsable?.id,
            caretBlock: !caretBlock
              ? null
              : caretBlock.type === 'heading'
                ? 'heading'
                : caretBlock.locked
                  ? 'locked'
                  : 'other',
          };
        }
      }

      if (!target || !range) {
        // Nowhere to put it: a new paragraph holding just the citation.
        const ids = getBlockIds();
        const block: ParagraphBlock = {
          id: uid(),
          type: 'paragraph',
          html: `<span data-child-id="${child.id}" contenteditable="false"></span>`,
          children: [child],
          columns: 1,
        };
        const [inserted] = insertBlocksAfter(ids[ids.length - 1] ?? null, [block]);
        if (!inserted) return null;
        markRecentlyChanged([inserted]);
        scrollToBlock(inserted);
        return { where: 'new-paragraph', blockId: inserted };
      }

      const el = refs.current[target.id]!;
      const placeholder = document.createElement('span');
      placeholder.setAttribute('data-child-id', child.id);
      placeholder.setAttribute('contenteditable', 'false');
      range.insertNode(placeholder);
      // Somewhere for the caret after the widget, as the slash command does —
      // unless a space already follows, which would read as a double space.
      const after = placeholder.nextSibling;
      if (!(after?.nodeType === Node.TEXT_NODE && /^[\s\u00a0]/.test((after as Text).data))) {
        placeholder.parentNode?.insertBefore(document.createTextNode('\u00a0'), after);
      }
      // Children before html: html with a placeholder but no child fails the
      // document's placeholder ↔ child invariant.
      addParagraphChild(target.id, child);
      updateHtml(target.id, serializeEditableHtml(el as HTMLDivElement));
      markRecentlyChanged([target.id]);

      // The next cite from a panel goes right after this one, and joins it.
      const parent = placeholder.parentNode;
      const offset = parent
        ? proseOffset(el, parent, Array.prototype.indexOf.call(parent.childNodes, placeholder) + 1)
        : 0;
      remembered = {
        blockId: target.id,
        element: el,
        start: offset,
        end: offset,
        selection: null,
        afterChildId: child.id,
      };
      publishFocus();

      if (fallback) {
        scrollToBlock(target.id);
        return fallback;
      }
      return { where: 'caret', blockId: target.id };
    },
    [
      addParagraphChild,
      bibliography.documentStyle,
      bibliography.style,
      getBlock,
      getBlockIds,
      insertBlocksAfter,
      markRecentlyChanged,
      refs,
      updateHtml,
      updateParagraphChild,
      upsertSources,
    ],
  );
}

/** What to tell the author after a cite: where it went, in their terms. */
export function citeNotice(placement: CitePlacement, sources: readonly ReferenceRecord[]): ToastOptions {
  const [only] = sources;
  const named = only && sources.length === 1 ? only.csl.title || only.key : `${sources.length} sources`;
  switch (placement.where) {
    case 'caret':
      return { title: 'Citation inserted', description: named };
    case 'merged':
      return placement.added > 0
        ? { title: 'Added to the citation at the cursor', description: named }
        : { title: 'Already cited here', description: named };
    case 'new-paragraph':
      return { title: 'Cited in a new paragraph at the end', description: named };
    case 'fallback': {
      const title = placement.section
        ? `Cited at the end of “${placement.section}”`
        : placement.last
          ? 'Cited at the end of the page'
          : 'Cited at the end of the nearest paragraph';
      const why =
        placement.caretBlock === 'heading'
          ? 'Headings can’t hold citations.'
          : placement.caretBlock === 'locked'
            ? 'The paragraph at the cursor is locked.'
            : placement.caretBlock === 'other'
              ? 'This kind of block can’t hold citations.'
              : 'Click into the text first to cite at a specific place.';
      return { title, description: `${named}. ${why}` };
    }
  }
}

/**
 * {@link useCiteAtCursor}, plus the confirmation that says where the citation
 * went. Every "Cite" button should use this, so a citation that could not go
 * at the caret is never announced as if it had.
 */
export function useCiteAndAnnounce(): (sources: readonly ReferenceRecord[]) => CitePlacement | null {
  const cite = useCiteAtCursor();
  const { toast } = useToast();
  return useCallback(
    (sources) => {
      const placement = cite(sources);
      if (placement) toast(citeNotice(placement, sources));
      return placement;
    },
    [cite, toast],
  );
}
