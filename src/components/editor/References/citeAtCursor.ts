import { useCallback, useEffect, useSyncExternalStore } from 'react';
import {
  useBibliography,
  useEditorActions,
  type CitationChild,
  type CitationSource,
  type ParagraphBlock,
} from '@/editor';
import { uid } from '@/lib/uid';
import { serializeEditableHtml } from '@/components/common/Editable/editableHtml';

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
};

let remembered: RememberedCaret | null = null;

/** Whether a node sits inside an inline widget (a citation, an equation, …). */
function insideWidget(node: Node): boolean {
  const element = node.nodeType === Node.ELEMENT_NODE ? (node as Element) : node.parentElement;
  return Boolean(element?.closest('[data-child-id]'));
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
      remembered = {
        blockId,
        element: root,
        start: proseOffset(root, range.startContainer, range.startOffset),
        end: proseOffset(root, range.endContainer, range.endOffset),
        selection: rangeText(range),
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

/** For tests: forget the remembered caret. */
export function forgetCaret(): void {
  remembered = null;
  publishFocus();
}

/**
 * Cite sources at the author's caret — or, failing that, at the end of the
 * last editable paragraph — and add them to the document's library.
 *
 * Returns the id of the block that received the citation, or null when there
 * was nothing to cite.
 */
export function useCiteAtCursor(): (sources: readonly CitationSource[]) => string | null {
  const {
    refs,
    getBlock,
    getBlockIds,
    addParagraphChild,
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
        style: bibliography.documentStyle ?? bibliography.style ?? 'numeric',
      };

      const usable = (block: ReturnType<typeof getBlock>): block is ParagraphBlock =>
        block?.type === 'paragraph' && !block.locked && Boolean(refs.current[block.id]);

      const caret = remembered;
      let target = caret ? getBlock(caret.blockId) : undefined;
      let range: Range | null = null;
      if (usable(target) && caret) {
        // Rebuilt from offsets against the block as it is now, so a markup
        // rewrite since the caret was recorded does not move the citation.
        const el = refs.current[target.id]!;
        range = proseRange(el, caret.end, caret.end);
        range.collapse(true);
      }
      if (!range) {
        const ids = getBlockIds();
        target = undefined;
        for (let index = ids.length - 1; index >= 0; index -= 1) {
          const candidate = getBlock(ids[index]);
          if (usable(candidate)) {
            target = candidate;
            break;
          }
        }
        if (target) {
          range = document.createRange();
          range.selectNodeContents(refs.current[target.id]!);
          range.collapse(false);
        }
      }

      if (!usable(target) || !range) {
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
        if (inserted) markRecentlyChanged([inserted]);
        return inserted ?? null;
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
      remembered = null;
      return target.id;
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
      upsertSources,
    ],
  );
}
