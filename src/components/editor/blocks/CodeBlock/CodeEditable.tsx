import { useLayoutEffect, useRef } from 'react';
import { cn } from '@/lib/utils';
import {
  kindOf,
  useActiveBlock,
  useEditorActions,
  type CodeBlock as CodeBlockModel,
} from '@/editor';
import {
  caretLineInfo,
  placeCaretAtLine,
  restoreCaretOffset,
} from '@/components/common/Editable/caret';
import { isMod, turnIntoKind } from '@/components/common/Editable/blockKeys';
import { openAskAi } from '../../AskAi/askAiEvents';
import {
  cleanCodeText,
  cleanPastedCode,
  holdsCodeText,
  indentEdit,
  lineStartOf,
  newlineEdit,
  outdentEdit,
  readCodeText,
  replaceEdit,
  writeCodeText,
  type CodeEdit,
} from './codeText';

/** The selection as offsets into the editable's text, when it is inside it. */
function selectionOffsets(el: HTMLElement): { start: number; end: number } | null {
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0) return null;
  const range = selection.getRangeAt(0);
  if (!el.contains(range.startContainer) || !el.contains(range.endContainer)) return null;
  const offsetOf = (container: Node, offset: number) => {
    // The usual case: the one text node `writeCodeText` leaves.
    if (container === el.firstChild && container.nodeType === Node.TEXT_NODE) return offset;
    const before = document.createRange();
    before.selectNodeContents(el);
    before.setEnd(container, offset);
    const holder = document.createElement('div');
    holder.appendChild(before.cloneContents());
    return readCodeText(holder, { cut: true }).length;
  };
  return {
    start: offsetOf(range.startContainer, range.startOffset),
    end: offsetOf(range.endContainer, range.endOffset),
  };
}

/** Select `[start, end)` of text written by `writeCodeText`. */
function selectOffsets(el: HTMLElement, start: number, end: number): void {
  const selection = window.getSelection();
  if (!selection) return;
  const node = el.firstChild;
  const range = document.createRange();
  if (node?.nodeType === Node.TEXT_NODE) {
    const length = (node as Text).length;
    range.setStart(node, Math.min(start, length));
    range.setEnd(node, Math.min(end, length));
  } else {
    range.setStart(el, 0);
    range.collapse(true);
  }
  selection.removeAllRanges();
  selection.addRange(range);
}

/**
 * Scroll the text at `offset` into view — in the block, which scrolls on its
 * own past a height, and on the page. A selection placed by script is not
 * scrolled to the way a typed one is, so after an Enter on the last visible
 * line the caret would carry on out of sight.
 */
function revealOffset(el: HTMLElement, offset: number): void {
  const node = el.firstChild;
  if (node?.nodeType !== Node.TEXT_NODE) return;
  const marker = document.createElement('span');
  const range = document.createRange();
  range.setStart(node, Math.min(offset, (node as Text).length));
  range.insertNode(marker);
  marker.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
  marker.remove();
  el.normalize();
}

/**
 * The editable text of a code block — shared by code, diagram and figure
 * blocks.
 *
 * It is a plaintext-only contenteditable rather than a textarea so it joins
 * the document's caret flow — arrow keys cross into and out of it like any
 * other block, and it registers with the editor like the prose blocks do.
 * Enter opens a new line at the current indentation; Tab and Shift+Tab indent
 * and outdent the caret's line or every selected line; Mod+Enter leaves the
 * block. The block shortcuts of the prose editables (Esc, Mod+A, Mod+D,
 * Mod+Shift+↑↓, Mod+Alt+digit, Mod+J) mean the same here.
 *
 * Every edit that adds or re-indents lines is made here, as text, and the
 * browser only types and deletes characters; see `codeText.ts` for why.
 */
export function CodeEditable({
  block,
  ariaLabel,
  placeholder = 'Code',
  className,
  onLeave,
}: {
  block: CodeBlockModel;
  ariaLabel: string;
  placeholder?: string;
  className?: string;
  /**
   * Escape or Mod+Enter took the caret out of the text. A diagram block
   * closes its source editor on it; a code block has nothing to close.
   */
  onLeave?: () => void;
}) {
  const {
    addBlockAfter,
    duplicateBlock,
    getBlockIds,
    moveBlock,
    refs,
    registerEditable,
    removeBlock,
    selectBlocks,
    setBlockKind,
    updateCodeText,
  } = useEditorActions();
  const { activeId, setActive } = useActiveBlock();
  const elementRef = useRef<HTMLDivElement | null>(null);
  const lastCommitted = useRef(block.text);
  /** True between compositionstart and compositionend (IME input). */
  const composingRef = useRef(false);
  const locked = block.locked === true;

  // Same rule as the prose editables: state is written into the DOM while the
  // block is not being typed in, or when it changed from elsewhere.
  useLayoutEffect(() => {
    const el = elementRef.current;
    if (!el) return;
    if (!holdsCodeText(el, block.text) && (activeId !== block.id || lastCommitted.current !== block.text)) {
      const selection = activeId === block.id ? selectionOffsets(el) : null;
      writeCodeText(el, block.text);
      if (selection) selectOffsets(el, selection.start, selection.end);
    }
    lastCommitted.current = block.text;
  }, [block.text, block.id, activeId]);

  const commit = (el: HTMLElement, text: string) => {
    el.toggleAttribute('data-empty', text === '');
    lastCommitted.current = text;
    updateCodeText(block.id, text);
  };

  /** Apply an edit made here: new text, the selection, the caret in view. */
  const apply = (el: HTMLElement, edit: CodeEdit) => {
    writeCodeText(el, edit.text);
    revealOffset(el, edit.end);
    selectOffsets(el, edit.start, edit.end);
    commit(el, edit.text);
  };

  /**
   * After the browser edited the text itself: read it back, and when it left
   * more than one text node (a drop, a native line break) or something the
   * API refuses, write it back clean with the caret where it was.
   */
  const sync = (el: HTMLElement) => {
    const drawn = readCodeText(el);
    const text = cleanCodeText(drawn);
    if (!holdsCodeText(el, text)) {
      const selection = selectionOffsets(el);
      writeCodeText(el, text);
      if (selection) {
        const caret = cleanCodeText(drawn.slice(0, selection.end)).length;
        selectOffsets(el, caret, caret);
      }
    }
    commit(el, text);
  };

  const neighbour = (dir: -1 | 1): string | null => {
    const ids = getBlockIds();
    for (let j = ids.indexOf(block.id) + dir; j >= 0 && j < ids.length; j += dir) {
      if (refs.current[ids[j]]) return ids[j];
    }
    return null;
  };

  const focusBlock = (id: string, offset: number) => {
    requestAnimationFrame(() => {
      const target = refs.current[id];
      if (!target) return;
      target.focus();
      restoreCaretOffset(target, offset);
    });
  };

  return (
    <div
      ref={(element) => {
        elementRef.current = element;
        registerEditable(block.id, element);
        if (element && element.childNodes.length === 0 && block.text) writeCodeText(element, block.text);
      }}
      role="textbox"
      aria-multiline="true"
      aria-label={ariaLabel}
      aria-readonly={locked || undefined}
      tabIndex={locked ? 0 : undefined}
      contentEditable={locked ? false : 'plaintext-only'}
      suppressContentEditableWarning
      // Code is not prose: no spelling marks, no capitalised first letter or
      // autocorrect on a phone keyboard, and a page translator leaves it be.
      spellCheck={false}
      autoCapitalize="off"
      autoCorrect="off"
      translate="no"
      data-placeholder={placeholder}
      data-empty={block.text === '' ? '' : undefined}
      className={cn(
        'code-editable block w-full overflow-auto whitespace-pre font-mono text-[0.85em] leading-[1.6] outline-none',
        // A pasted tab is as wide as the LaTeX export prints it.
        '[tab-size:4]',
        className,
      )}
      onFocus={() => setActive(block.id)}
      onBlur={(event) => {
        const row = event.currentTarget.closest('[data-block-id]');
        const canvas = event.currentTarget.closest('.canvas');
        // As in the prose editables: the block stays active while focus is on
        // its own controls, and a block focus moves to marks itself active.
        queueMicrotask(() => {
          const next = document.activeElement;
          if (next && (row?.contains(next) || canvas?.contains(next))) return;
          setActive(null);
        });
      }}
      onInput={(event) => {
        // IME composition commits on compositionend: rewriting the text
        // mid-composition drops the characters still being composed.
        if (composingRef.current) return;
        sync(event.currentTarget);
      }}
      onCompositionStart={() => {
        composingRef.current = true;
      }}
      onCompositionEnd={(event) => {
        composingRef.current = false;
        sync(event.currentTarget);
      }}
      onPaste={(event) => {
        event.preventDefault();
        if (locked) return;
        const el = event.currentTarget;
        const selection = selectionOffsets(el);
        const pasted = cleanPastedCode(event.clipboardData.getData('text/plain'));
        if (!selection || (pasted === '' && selection.start === selection.end)) return;
        apply(el, replaceEdit(readCodeText(el), selection.start, selection.end, pasted));
      }}
      onKeyDown={(event) => {
        const el = event.currentTarget;
        // IME composition keydowns are not commands: Enter confirms the
        // composition, it does not open a line.
        if (event.nativeEvent.isComposing || composingRef.current) return;
        const mod = isMod(event);

        if (event.key === 'Escape') {
          event.preventDefault();
          selectBlocks([block.id]);
          el.blur();
          onLeave?.();
          return;
        }
        // Mod+A selects the code; pressed again, every block in the document.
        if (mod && !event.shiftKey && !event.altKey && event.key.toLowerCase() === 'a') {
          const all = readCodeText(el).length;
          const selected = window.getSelection()?.toString().length ?? 0;
          if (all === 0 || selected >= all) {
            event.preventDefault();
            selectBlocks(getBlockIds());
            el.blur();
            onLeave?.();
          }
          return;
        }
        // Block commands that do not change the text work on a locked block too.
        if (mod && !event.shiftKey && !event.altKey && event.key.toLowerCase() === 'd') {
          event.preventDefault();
          duplicateBlock(block.id);
          return;
        }
        if (mod && !event.shiftKey && !event.altKey && event.key.toLowerCase() === 'j') {
          event.preventDefault();
          event.stopPropagation();
          openAskAi({ blockId: block.id });
          return;
        }
        if (mod && event.shiftKey && !event.altKey && (event.key === 'ArrowUp' || event.key === 'ArrowDown')) {
          event.preventDefault();
          if (locked) return;
          const caret = selectionOffsets(el)?.start ?? 0;
          moveBlock(block.id, event.key === 'ArrowUp' ? -1 : 1);
          focusBlock(block.id, caret);
          return;
        }
        const kind = mod && event.altKey && !event.shiftKey ? turnIntoKind(event) : undefined;
        if (kind) {
          event.preventDefault();
          if (locked || kindOf(block) === kind) return;
          setBlockKind(block.id, kind);
          focusBlock(block.id, 0);
          return;
        }

        // Nothing that changes the text applies to a locked block. Arrow keys
        // fall through to the navigation below, which only moves the caret.
        if (locked && !event.key.startsWith('Arrow')) return;

        if (event.key === 'Tab' && !event.metaKey && !event.ctrlKey && !event.altKey) {
          // Consumed even when nothing moves, so focus stays in the text;
          // Esc then Tab reaches the next control.
          event.preventDefault();
          const selection = selectionOffsets(el);
          if (!selection) return;
          const text = readCodeText(el);
          const edit = event.shiftKey
            ? outdentEdit(text, selection.start, selection.end)
            : indentEdit(text, selection.start, selection.end);
          if (edit.text !== text) apply(el, edit);
          return;
        }
        if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
          event.preventDefault();
          const nextId = addBlockAfter(block.id, 'paragraph');
          focusBlock(nextId, 0);
          onLeave?.();
          return;
        }
        if (event.key === 'Enter') {
          // A newline, never a new block: code keeps its lines together.
          event.preventDefault();
          const selection = selectionOffsets(el);
          if (selection) apply(el, newlineEdit(readCodeText(el), selection.start, selection.end));
          return;
        }
        if (event.key === 'Backspace' && readCodeText(el) === '') {
          event.preventDefault();
          const previous = neighbour(-1);
          removeBlock(block.id);
          if (previous) focusBlock(previous, Number.MAX_SAFE_INTEGER);
          return;
        }

        // Arrow keys cross block boundaries at the edges of the text: Left and
        // Right at the first and last character, Up and Down on the first and
        // last line, keeping the column.
        if (!event.key.startsWith('Arrow') || event.shiftKey || event.altKey || event.metaKey || event.ctrlKey) return;
        const selection = selectionOffsets(el);
        if (!selection || selection.start !== selection.end) return;
        const text = readCodeText(el);
        const offset = selection.start;
        const x = event.key === 'ArrowUp' || event.key === 'ArrowDown' ? caretLineInfo(el)?.x ?? null : null;
        const leaveUp =
          event.key === 'ArrowLeft' ? offset === 0 : event.key === 'ArrowUp' && lineStartOf(text, offset) === 0;
        const leaveDown =
          event.key === 'ArrowRight'
            ? offset === text.length
            : event.key === 'ArrowDown' && !text.includes('\n', offset);
        const targetId = leaveUp ? neighbour(-1) : leaveDown ? neighbour(1) : null;
        const target = targetId ? refs.current[targetId] : null;
        if (!target) return;
        event.preventDefault();
        target.focus();
        if (event.key === 'ArrowUp') placeCaretAtLine(target, 'last', x);
        else if (event.key === 'ArrowDown') placeCaretAtLine(target, 'first', x);
        else restoreCaretOffset(target, leaveUp ? target.textContent?.length ?? 0 : 0);
      }}
    />
  );
}
