import { useEffect } from 'react';
import type { EditorFocus } from '@/components/editor/References';
import { proseOffset, proseRange } from '@/components/editor/References/citeAtCursor';

const NAME = 'chat-context';

type HighlightRegistry = { set: (name: string, highlight: unknown) => void; delete: (name: string) => void };
type HighlightCtor = new (...ranges: Range[]) => unknown;

function registry(): { highlights: HighlightRegistry; Highlight: HighlightCtor } | null {
  const highlights = (globalThis.CSS as unknown as { highlights?: HighlightRegistry } | undefined)?.highlights;
  const Highlight = (globalThis as unknown as { Highlight?: HighlightCtor }).Highlight;
  return highlights && Highlight ? { highlights, Highlight } : null;
}

/**
 * Where the attached selection lives, as prose offsets into one editable of
 * one block. Positions, not a live Range: Editable rewrites its text nodes on
 * blur and re-render, which collapses any Range held across that.
 */
export type ContextAnchor = { blockId: string; editable: number; start: number; end: number; text: string };

/** The plain text of a range, without citation labels and other widgets. */
function plainText(range: Range): string {
  const holder = document.createElement('div');
  holder.appendChild(range.cloneContents());
  holder.querySelectorAll('[data-child-id]').forEach((widget) => widget.remove());
  return (holder.textContent ?? '').replace(/\u00a0/g, ' ');
}

function blockElement(blockId: string): HTMLElement | null {
  for (const element of document.querySelectorAll<HTMLElement>('[data-block-id]')) {
    if (element.getAttribute('data-block-id') === blockId) return element;
  }
  return null;
}

/** The block's own editables, not those of blocks nested inside it. */
function editablesOf(block: HTMLElement): HTMLElement[] {
  return [...block.querySelectorAll<HTMLElement>('.editable')].filter(
    (editable) => editable.closest('[data-block-id]') === block,
  );
}

/** The page selection right now, as an anchor, when it is the one `focus` describes. */
export function captureAnchor(focus: EditorFocus): ContextAnchor | null {
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0 || selection.isCollapsed) return null;
  const range = selection.getRangeAt(0);
  const start = range.startContainer;
  const element = start.nodeType === Node.ELEMENT_NODE ? (start as Element) : start.parentElement;
  const editable = element?.closest<HTMLElement>('.editable');
  const block = editable?.closest<HTMLElement>('[data-block-id]');
  if (!editable || !block || block.getAttribute('data-block-id') !== focus.blockId) return null;
  if (!editable.contains(range.endContainer)) return null;
  const index = editablesOf(block).indexOf(editable);
  if (index < 0) return null;
  return {
    blockId: focus.blockId,
    editable: index,
    start: proseOffset(editable, range.startContainer, range.startOffset),
    end: proseOffset(editable, range.endContainer, range.endOffset),
    text: plainText(range).trim(),
  };
}

/**
 * The selected text as it is found in the block, for when the selection had
 * already left the page by the time the chip attached.
 */
function findAnchor(focus: EditorFocus): ContextAnchor | null {
  const wanted = focus.selection?.trim();
  const block = blockElement(focus.blockId);
  if (!wanted || !block) return null;
  const editables = editablesOf(block);
  for (let index = 0; index < editables.length; index++) {
    const editable = editables[index];
    const whole = document.createRange();
    whole.selectNodeContents(editable);
    const text = plainText(whole);
    const at = text.indexOf(wanted);
    if (at >= 0) return { blockId: focus.blockId, editable: index, start: at, end: at + wanted.length, text: wanted };
  }
  return null;
}

/** A fresh Range over the anchor in the page as it is now, or null when the text is gone. */
export function resolveAnchor(anchor: ContextAnchor): Range | null {
  const block = blockElement(anchor.blockId);
  const editable = block && editablesOf(block)[anchor.editable];
  if (!editable) return null;
  const range = proseRange(editable, anchor.start, anchor.end);
  if (range.collapsed || plainText(range).trim() !== anchor.text) return null;
  return range;
}

/**
 * Keeps the text the next message is about marked in the page.
 *
 * Moving into the composer takes the browser's selection with it, so the only
 * sign of what the AI would act on used to be the chip in the composer. While
 * that chip is attached, the selection is painted with the CSS Custom
 * Highlight API (`::highlight(chat-context)`), which needs no DOM changes in
 * the page and survives focus leaving it. The selection is remembered as
 * offsets and a Range is rebuilt from the current DOM whenever the page
 * changes, since the editor replaces its text nodes on blur. Cleared when the
 * chip goes.
 */
export function useChatContextHighlight(focus: EditorFocus | null): void {
  useEffect(() => {
    const api = registry();
    if (!api) return;
    if (!focus?.selection) {
      api.highlights.delete(NAME);
      return;
    }
    // The effect runs as the selection is published, while the page still
    // holds it; failing that, the selected text is looked up in the block.
    const anchor = captureAnchor(focus) ?? findAnchor(focus);
    if (!anchor) {
      api.highlights.delete(NAME);
      return;
    }

    const paint = () => {
      const range = resolveAnchor(anchor);
      if (range) api.highlights.set(NAME, new api.Highlight(range));
      else api.highlights.delete(NAME);
    };
    paint();

    // Editable swaps its text nodes on blur and whenever the block
    // re-renders, and the block itself can be remounted: repaint from the
    // offsets after any change to the page around it.
    const root = blockElement(anchor.blockId)?.closest('.canvas') ?? document.body;
    const observer = typeof MutationObserver === 'function' ? new MutationObserver(paint) : null;
    observer?.observe(root, { childList: true, subtree: true, characterData: true });

    return () => {
      observer?.disconnect();
      api.highlights.delete(NAME);
    };
  }, [focus]);
}
