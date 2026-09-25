import { useEffect, useLayoutEffect, useRef, type MutableRefObject } from 'react';
import {
  isListItem,
  kindOf,
  useEditorActions,
  useEditorState,
  type Block,
  type BlockKindId,
} from '@/editor';
import { blocksToHtml, blocksToMarkdown } from '@/editor/markdown';
import { restoreCaretOffset } from '@/components/common/Editable/caret';
import { BLOCKS_MIME } from '@/components/common/Editable/pasteBlocks';
import { openAskAi } from '../AskAi/askAiEvents';
import { BLOCK_ROW, blockRows, edgeScrollDelta } from './canvasDom';


const TURN_INTO_DIGITS: Record<string, BlockKindId> = {
  Digit0: 'text',
  Digit1: 'h1',
  Digit2: 'h2',
  Digit3: 'h3',
  Digit4: 'todo',
  Digit5: 'bullet',
  Digit6: 'numbered',
  Digit7: 'quote',
  Digit8: 'code',
  Digit9: 'callout',
};

function isMod(event: KeyboardEvent): boolean {
  const mac = /Mac|iPhone|iPad/.test(navigator.platform);
  return mac ? event.metaKey && !event.ctrlKey : event.ctrlKey && !event.metaKey;
}

/** Whether a key event belongs to a text field rather than to the canvas. */
function typingElsewhere(target: EventTarget | null): boolean {
  const element = target as HTMLElement | null;
  if (!element?.closest) return false;
  return Boolean(
    element.closest('input, textarea, select, [contenteditable="true"], [contenteditable="plaintext-only"], [role="dialog"], [role="menu"]'),
  );
}

/**
 * Keyboard and clipboard for whole-block selection.
 *
 * Esc in a block, ⌘A twice, or Shift+click selects blocks; while any are
 * selected the arrow keys move or extend the selection and the block
 * commands (delete, duplicate, move, turn into, copy) act on all of them —
 * the keyboard path to everything the drag handle does, which WCAG 2.5.7
 * requires of any drag interaction.
 */
export function useBlockSelection() {
  const { blocks, selectedBlockIds } = useEditorState();
  const {
    selectBlocks,
    clearBlockSelection,
    removeBlocks,
    duplicateBlock,
    moveBlock,
    setBlockKind,
    indentBlock,
    refs,
  } = useEditorActions();
  // The end of the selection that Shift+arrow moves; the other end stays.
  const anchorRef = useRef<string | null>(null);
  const focusRef = useRef<string | null>(null);

  const blocksRef = useRef(blocks);
  useLayoutEffect(() => {
    blocksRef.current = blocks;
  }, [blocks]);

  useEffect(() => {
    if (selectedBlockIds.length === 0) {
      anchorRef.current = null;
      focusRef.current = null;
      return;
    }
    if (!anchorRef.current || !selectedBlockIds.includes(anchorRef.current)) {
      anchorRef.current = selectedBlockIds[0];
      focusRef.current = selectedBlockIds[selectedBlockIds.length - 1];
    }
  }, [selectedBlockIds]);

  // A selected block holds focus itself (its row is `tabIndex=-1` while
  // selected), instead of focus falling to <body> when Esc lifts the caret
  // out of the text. Focus on a row keeps Tab moving on from that block and
  // gives a screen reader something to read.
  useEffect(() => {
    if (selectedBlockIds.length === 0) return;
    const active = document.activeElement;
    const managed =
      !active ||
      active === document.body ||
      (active instanceof HTMLElement && active.matches('.block-row, .canvas'));
    if (!managed) return;
    const target = focusRef.current ?? selectedBlockIds[selectedBlockIds.length - 1];
    const row = document.querySelector<HTMLElement>(`.block-row[data-block-id="${CSS.escape(target)}"]`);
    if (!row || row === active) return;
    row.focus({ preventScroll: true });
    row.scrollIntoView?.({ block: 'nearest' });
  }, [selectedBlockIds]);

  useDragToSelect({ anchorRef, focusRef, blocksRef });

  useEffect(() => {
    if (selectedBlockIds.length === 0) return;

    const ids = () => blocksRef.current.map((block) => block.id);
    const range = (from: string, to: string) => {
      const order = ids();
      const a = order.indexOf(from);
      const b = order.indexOf(to);
      if (a === -1 || b === -1) return [from];
      return order.slice(Math.min(a, b), Math.max(a, b) + 1);
    };
    const selectedBlocks = (): Block[] => {
      const wanted = new Set(selectedBlockIds);
      return blocksRef.current.filter((block) => wanted.has(block.id));
    };
    const focusBlock = (id: string, offset: number) => {
      requestAnimationFrame(() => {
        const target = refs.current[id];
        if (!target) return;
        target.focus();
        restoreCaretOffset(target, offset);
      });
    };

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || typingElsewhere(event.target)) return;
      const order = ids();
      const first = selectedBlockIds[0];
      const last = selectedBlockIds[selectedBlockIds.length - 1];

      if (event.key === 'Escape') {
        event.preventDefault();
        clearBlockSelection();
        return;
      }
      if (isMod(event) && event.key.toLowerCase() === 'a' && !event.shiftKey) {
        event.preventDefault();
        selectBlocks(order);
        return;
      }
      if ((event.key === 'ArrowUp' || event.key === 'ArrowDown') && !event.altKey) {
        event.preventDefault();
        const dir = event.key === 'ArrowUp' ? -1 : 1;
        if (isMod(event) && event.shiftKey) {
          // Move the selected run as one; the far end moves first so the run
          // keeps its order.
          const moving = dir < 0 ? selectedBlockIds : [...selectedBlockIds].reverse();
          const edge = order.indexOf(dir < 0 ? first : last) + dir;
          if (edge < 0 || edge >= order.length) return;
          for (const id of moving) moveBlock(id, dir);
          return;
        }
        if (event.shiftKey) {
          const focus = focusRef.current ?? last;
          const next = order[order.indexOf(focus) + dir];
          if (!next) return;
          focusRef.current = next;
          selectBlocks(range(anchorRef.current ?? first, next));
          return;
        }
        const from = dir < 0 ? first : last;
        const next = order[order.indexOf(from) + dir] ?? from;
        anchorRef.current = next;
        focusRef.current = next;
        selectBlocks([next]);
        return;
      }
      if (event.key === 'Enter' && !event.shiftKey && !isMod(event)) {
        event.preventDefault();
        clearBlockSelection();
        focusBlock(first, Number.MAX_SAFE_INTEGER);
        return;
      }
      if (event.key === 'Backspace' || event.key === 'Delete') {
        event.preventDefault();
        const before = order[order.indexOf(first) - 1];
        removeBlocks(selectedBlockIds);
        clearBlockSelection();
        if (before) focusBlock(before, Number.MAX_SAFE_INTEGER);
        return;
      }
      if (isMod(event) && !event.shiftKey && event.key.toLowerCase() === 'd') {
        event.preventDefault();
        const copies = [...selectedBlockIds]
          .reverse()
          .map((id) => duplicateBlock(id))
          .filter((id): id is string => Boolean(id));
        if (copies.length) selectBlocks(copies.reverse());
        return;
      }
      if (isMod(event) && event.altKey && TURN_INTO_DIGITS[event.code]) {
        event.preventDefault();
        const kind = TURN_INTO_DIGITS[event.code];
        for (const block of selectedBlocks()) {
          if (kindOf(block) !== kind && block.type !== 'divider') setBlockKind(block.id, kind);
        }
        return;
      }
      if (isMod(event) && !event.shiftKey && !event.altKey && event.key.toLowerCase() === 'j') {
        // Ask AI about the selected blocks.
        event.preventDefault();
        event.stopPropagation();
        openAskAi({ blockId: last });
        return;
      }
      if (event.key === 'Tab' && !isMod(event) && !event.altKey) {
        // Tab indents the selected list items — but only when one of them can
        // actually move. Otherwise Tab is navigation again: the selection is
        // let go and the browser moves on from the selected block's row,
        // which holds focus. Swallowing every Tab trapped keyboard users in
        // the editor (WCAG 2.1.2).
        let moved = false;
        for (const block of selectedBlocks()) {
          if (isListItem(block) && indentBlock(block.id, event.shiftKey ? -1 : 1)) moved = true;
        }
        if (moved) {
          event.preventDefault();
          return;
        }
        clearBlockSelection();
      }
    };

    const writeClipboard = (event: ClipboardEvent) => {
      if (typingElsewhere(document.activeElement)) return false;
      const chosen = selectedBlocks();
      if (chosen.length === 0 || !event.clipboardData) return false;
      event.preventDefault();
      event.clipboardData.setData('text/plain', blocksToMarkdown(chosen));
      event.clipboardData.setData(BLOCKS_MIME, JSON.stringify(chosen));
      // Word processors and other editors read structure from html.
      event.clipboardData.setData('text/html', blocksToHtml(chosen));
      return true;
    };
    const onCopy = (event: ClipboardEvent) => {
      writeClipboard(event);
    };
    const onCut = (event: ClipboardEvent) => {
      if (!writeClipboard(event)) return;
      removeBlocks(selectedBlockIds);
      clearBlockSelection();
    };

    const onPointerDown = (event: MouseEvent) => {
      const target = event.target as HTMLElement | null;
      // Shift+click extends the selection; the gutter controls act on it.
      if (event.shiftKey || target?.closest('.block-controls, [role="menu"]')) return;
      clearBlockSelection();
    };

    document.addEventListener('keydown', onKeyDown);
    document.addEventListener('copy', onCopy);
    document.addEventListener('cut', onCut);
    document.addEventListener('mousedown', onPointerDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.removeEventListener('copy', onCopy);
      document.removeEventListener('cut', onCut);
      document.removeEventListener('mousedown', onPointerDown);
    };
  }, [
    selectedBlockIds,
    selectBlocks,
    clearBlockSelection,
    removeBlocks,
    duplicateBlock,
    moveBlock,
    setBlockKind,
    indentBlock,
    refs,
  ]);

  /** Shift+click on a row: extend the selection from its anchor to `id`. */
  const extendTo = (id: string) => {
    const anchor = anchorRef.current ?? selectedBlockIds[0] ?? id;
    const order = blocksRef.current.map((block) => block.id);
    const a = order.indexOf(anchor);
    const b = order.indexOf(id);
    if (a === -1 || b === -1) {
      selectBlocks([id]);
      return;
    }
    focusRef.current = id;
    selectBlocks(order.slice(Math.min(a, b), Math.max(a, b) + 1));
  };

  return { extendTo };
}

/** Pixels the pointer must travel before a margin press becomes a marquee. */
const MARQUEE_THRESHOLD = 4;

/** The row at viewport height `y`: the one it falls in, else the nearest one above it. */
function rowAtY(rows: HTMLElement[], y: number): HTMLElement | null {
  if (rows.length === 0) return null;
  let hit: HTMLElement = rows[0];
  for (const row of rows) {
    if (row.getBoundingClientRect().top <= y) hit = row;
    else break;
  }
  return hit;
}

/**
 * Mouse paths into block selection, the way Notion does it.
 *
 * - Dragging a text selection out of one block into another turns it into a
 *   block selection from the first block to the one under the pointer. The
 *   native selection stops at the block boundary (each block is its own
 *   contenteditable root), so without this a mouse user saw the drag simply
 *   stop.
 * - Pressing in the canvas margin and dragging draws a marquee that selects
 *   every block it crosses.
 */
function useDragToSelect({
  anchorRef,
  focusRef,
  blocksRef,
}: {
  anchorRef: MutableRefObject<string | null>;
  focusRef: MutableRefObject<string | null>;
  blocksRef: MutableRefObject<Block[]>;
}) {
  const { selectBlocks } = useEditorActions();

  useEffect(() => {
    const between = (from: string, to: string) => {
      const order = blocksRef.current.map((block) => block.id);
      const a = order.indexOf(from);
      const b = order.indexOf(to);
      if (a === -1 || b === -1) return [to];
      return order.slice(Math.min(a, b), Math.max(a, b) + 1);
    };

    const onMouseDown = (down: MouseEvent) => {
      if (down.button !== 0 || down.shiftKey || down.defaultPrevented) return;
      const target = down.target as HTMLElement | null;
      const canvas = target?.closest<HTMLElement>('.canvas');
      if (!target || !canvas) return;
      // Controls, widgets and fields keep their own pointer behaviour.
      if (
        target.closest(
          '.block-controls, button, a, input, textarea, select, [role="menu"], [role="dialog"], [contenteditable="false"], .review-change',
        )
      ) {
        return;
      }
      const startRow = target.closest<HTMLElement>(BLOCK_ROW);
      // Only the page's empty surface starts a marquee — never text such as
      // the title or the references, which keep their own selection.
      const inMargin = !startRow && target.matches('.canvas, .document-container, .blocks-container');
      if (!startRow && !inMargin) return;
      if (blockRows().length === 0) return;

      const anchorId = startRow?.dataset.blockId ?? null;
      const startY = down.clientY + canvas.scrollTop;
      let lastX = down.clientX;
      let lastY = down.clientY;
      let blockMode = false;
      let marquee: HTMLDivElement | null = null;
      let scrollFrame = 0;
      let lastKey = '';
      const select = (ids: string[]) => {
        // Every mousemove lands here; only a change re-renders the page.
        const key = ids.join(' ');
        if (key === lastKey) return;
        lastKey = key;
        selectBlocks(ids);
      };

      const enterBlockMode = () => {
        blockMode = true;
        canvas.setAttribute('data-block-drag', '');
        window.getSelection()?.removeAllRanges();
        const active = document.activeElement as HTMLElement | null;
        if (active && canvas.contains(active) && active !== canvas) active.blur();
      };

      const update = () => {
        const rows = blockRows();
        if (startRow && anchorId) {
          const over = rowAtY(rows, lastY);
          const overId = over?.dataset.blockId;
          if (!overId) return;
          if (!blockMode) {
            // Inside the first block the browser's own text selection is
            // exactly right; only leaving it changes the mode.
            if (overId === anchorId) return;
            enterBlockMode();
          }
          anchorRef.current = anchorId;
          focusRef.current = overId;
          select(between(anchorId, overId));
          return;
        }
        // Marquee from the margin.
        const top = Math.min(startY - canvas.scrollTop, lastY);
        const bottom = Math.max(startY - canvas.scrollTop, lastY);
        if (!blockMode) {
          if (Math.hypot(lastX - down.clientX, lastY - down.clientY) < MARQUEE_THRESHOLD) return;
          enterBlockMode();
          marquee = document.createElement('div');
          marquee.className = 'block-marquee';
          marquee.setAttribute('aria-hidden', 'true');
          document.body.appendChild(marquee);
        }
        if (marquee) {
          const left = Math.min(down.clientX, lastX);
          const bounds = canvas.getBoundingClientRect();
          const clippedTop = Math.max(top, bounds.top);
          Object.assign(marquee.style, {
            left: `${left}px`,
            top: `${clippedTop}px`,
            width: `${Math.abs(lastX - down.clientX)}px`,
            height: `${Math.max(0, Math.min(bottom, bounds.bottom) - clippedTop)}px`,
          });
        }
        const hit = rows.filter((row) => {
          const rect = row.getBoundingClientRect();
          return rect.bottom > top && rect.top < bottom;
        });
        const ids = hit.map((row) => row.dataset.blockId).filter((id): id is string => Boolean(id));
        if (ids.length === 0) {
          select([]);
          return;
        }
        const fromBelow = lastY < startY - canvas.scrollTop;
        anchorRef.current = fromBelow ? ids[ids.length - 1] : ids[0];
        focusRef.current = fromBelow ? ids[0] : ids[ids.length - 1];
        select(ids);
      };

      // Near the scroller's edge the page scrolls under the pointer, as a
      // native text selection would.
      const autoScroll = () => {
        scrollFrame = 0;
        if (!blockMode) return;
        const delta = edgeScrollDelta(canvas.getBoundingClientRect(), lastY);
        if (delta === 0) return;
        const before = canvas.scrollTop;
        canvas.scrollTop += delta;
        if (canvas.scrollTop !== before) update();
        scrollFrame = requestAnimationFrame(autoScroll);
      };

      const onMove = (move: MouseEvent) => {
        if ((move.buttons & 1) === 0) {
          finish();
          return;
        }
        lastX = move.clientX;
        lastY = move.clientY;
        update();
        if (blockMode) {
          // Keep the browser from growing a text selection underneath.
          move.preventDefault();
          if (!scrollFrame) scrollFrame = requestAnimationFrame(autoScroll);
        }
      };

      const swallowClick = (click: MouseEvent) => {
        click.stopPropagation();
        click.preventDefault();
      };

      const finish = () => {
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', finish);
        window.removeEventListener('blur', finish);
        if (scrollFrame) cancelAnimationFrame(scrollFrame);
        marquee?.remove();
        if (!blockMode) return;
        canvas.removeAttribute('data-block-drag');
        window.getSelection()?.removeAllRanges();
        // The click that ends a drag is not a click on whatever it ended over.
        document.addEventListener('click', swallowClick, { capture: true, once: true });
        setTimeout(() => document.removeEventListener('click', swallowClick, { capture: true }), 0);
      };

      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', finish);
      window.addEventListener('blur', finish);
    };

    document.addEventListener('mousedown', onMouseDown);
    return () => document.removeEventListener('mousedown', onMouseDown);
  }, [anchorRef, blocksRef, focusRef, selectBlocks]);
}
