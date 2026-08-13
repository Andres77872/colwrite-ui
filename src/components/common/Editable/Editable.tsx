import type { CSSProperties } from 'react';
import { cn } from '@/lib/utils';
import { sanitizeEditableHtml } from '@/export/sanitize';
import { useActiveBlock, useEditorActions } from '../../../editor';
import { useLayoutEffect, useRef } from 'react';
import { openSlashMenu, isSlashMenuOpen } from '../../editor/SlashMenu/slashMenuEvents';
import { serializeEditableHtml } from './editableHtml';

/**
 * Whether a node sits inside an inline widget rather than in the prose.
 *
 * Every widget is rendered into its `data-child-id` placeholder, so that
 * attribute identifies all of them — present and future. This used to be a
 * hand-maintained list of five class names (`.table-inline`, `.graph-inline`,
 * …), which silently stopped matching the moment a widget's markup was
 * reworked: the paragraph then treated typing inside a table cell as typing in
 * the document, so "/" opened the command menu and Backspace in an empty cell
 * deleted the whole block.
 *
 * `.ai-suggest` is listed separately because the floating toolbar builds it
 * with raw DOM inside the paragraph, not as a child widget.
 */
function isInsideWidget(node: Node | null | undefined): boolean {
  if (!node) return false;
  const element = node.nodeType === 1 ? (node as HTMLElement) : node.parentElement;
  return !!element?.closest?.('[data-child-id], .ai-suggest');
}

/** Caret position as a character offset over the element's text content. */
function captureCaretOffset(el: HTMLElement): number | null {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0 || !el.contains(sel.anchorNode)) return null;
  const range = sel.getRangeAt(0);
  const pre = range.cloneRange();
  pre.selectNodeContents(el);
  pre.setEnd(range.startContainer, range.startOffset);
  return pre.toString().length;
}

/** Restore the caret from a character offset, clamped to the content. */
function restoreCaretOffset(el: HTMLElement, offset: number): void {
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  let remaining = offset;
  let node = walker.nextNode() as Text | null;
  while (node) {
    if (remaining <= node.data.length) {
      const sel = window.getSelection();
      const range = document.createRange();
      range.setStart(node, remaining);
      range.collapse(true);
      sel?.removeAllRanges();
      sel?.addRange(range);
      return;
    }
    remaining -= node.data.length;
    node = walker.nextNode() as Text | null;
  }
  const sel = window.getSelection();
  const range = document.createRange();
  range.selectNodeContents(el);
  range.collapse(false);
  sel?.removeAllRanges();
  sel?.addRange(range);
}

/**
 * Whether "/" at the caret would start a token or sit inside one.
 *
 * The command menu only takes the key at a word boundary (start of the block
 * or after whitespace): mid-word a slash is literal text — DOIs
 * (`10.1000/xyz`), URLs, "and/or" — and a menu that eats it makes those
 * untypable.
 */
function caretAtWordBoundary(el: HTMLElement): boolean {
  const offset = captureCaretOffset(el);
  if (offset === null) return false;
  if (offset === 0) return true;
  return /\s/.test(el.textContent?.charAt(offset - 1) ?? '');
}

export function Editable({
  id,
  html,
  placeholder,
  ariaLabel,
  className,
  style,
  slashEnabled = false,
  locked = false,
}: {
  id: string;
  html: string;
  placeholder?: string;
  /** Accessible name for the document field, such as "Paragraph". */
  ariaLabel?: string;
  className?: string;
  style?: CSSProperties;
  slashEnabled?: boolean;
  /**
   * Whether the block is locked against editing.
   *
   * "Lock block" wrote a flag that was read in exactly one place — the row's
   * class list — so a locked block still typed normally. An affordance that
   * says a block is protected and does not protect it is worse than not
   * offering it, so the flag gates the contenteditable itself. The element
   * stays focusable so arrow-key navigation still crosses the block and its
   * text can still be selected and copied.
   */
  locked?: boolean;
}) {
  // Actions plus the active-block context: the full state value changes on
  // every keystroke anywhere in the document, and subscribing to it made every
  // editable re-render on every edit. Block order is read at keydown time via
  // `getBlockIds` instead of a `blocks` subscription for the same reason.
  const {
    addBlockAfter,
    getBlockIds,
    mergeWithPrevious,
    removeBlock,
    splitBlock,
    updateHtml,
    refs,
    registerEditable,
  } = useEditorActions();
  const { activeId, setActive } = useActiveBlock();
  const pointerDownRef = useRef(false);
  const editableRef = useRef<HTMLDivElement | null>(null);
  const prevHtmlRef = useRef(html || '');
  /** True between compositionstart and compositionend (IME input). */
  const composingRef = useRef(false);

  /** Nearest block in `dir` that has an editable element, if any. */
  const neighbourBlock = (dir: -1 | 1): string | null => {
    const ids = getBlockIds();
    for (let j = ids.indexOf(id) + dir; j >= 0 && j < ids.length; j += dir) {
      if (refs.current[ids[j]]) return ids[j];
    }
    return null;
  };

  // Keep DOM content in sync only when NOT actively editing this block.
  // When becoming active (focus), ensure content is restored if a re-render replaced the node.
  useLayoutEffect(() => {
    const el = editableRef.current;
    if (!el) return;
    const next = html || '';
    if (activeId !== id) {
      if (el.innerHTML !== next) el.innerHTML = next;
    } else {
      // State that moved without this editable — an accepted agent change, a
      // restore, an undo — must not wait for blur: the next keystroke would
      // serialize this stale DOM back over the new state. Detect it against
      // the last html this editable itself committed, and rebase. While an AI
      // suggestion is live the toolbar owns the DOM on purpose, so state and
      // DOM legitimately disagree there.
      const movedExternally =
        prevHtmlRef.current !== next &&
        el.getAttribute('data-serialized') !== next &&
        !el.querySelector('.ai-suggest');
      if (movedExternally) {
        const caret = captureCaretOffset(el);
        el.innerHTML = next;
        el.setAttribute('data-serialized', next);
        if (caret !== null) restoreCaretOffset(el, caret);
      }
      // Active: if DOM got replaced and is empty, restore from state.
      if (!el.innerHTML && next) el.innerHTML = next;
      // If selection is not inside this element (e.g., after re-render), move caret to end.
      const sel = window.getSelection();
      const within = !!sel && sel.rangeCount > 0 && el.contains(sel.anchorNode);
      if (!within) {
        const range = document.createRange();
        range.selectNodeContents(el);
        range.collapse(false);
        if (sel) { sel.removeAllRanges(); sel.addRange(range); }
      }
    }
    prevHtmlRef.current = next;
  }, [html, activeId, id]);
  return (
    <div
      className={cn(
        // `editable` is the hook FloatingToolbar walks the DOM for to decide
        // whether a selection is inside a block. Without it the format and
        // AI-action toolbar never appears.
        "editable",
        // No focus outline: a box drawn around body text reads as an error
        // state while writing. The affordance is the row tint in `Canvas`,
        // which keys off `.editable:focus-visible`.
        "min-h-[1.5em] w-full outline-none whitespace-pre-wrap break-words",
        locked && "cursor-default",
        className
      )}
      ref={(element) => {
        editableRef.current = element;
        registerEditable(id, element);
      }}
      contentEditable={!locked}
      // A contenteditable div has inconsistent implicit semantics across
      // browser/assistive-technology pairs. Expose the editing contract
      // explicitly so every prose block is discoverable as a document field.
      role="textbox"
      aria-label={ariaLabel ?? placeholder ?? 'Document text'}
      aria-multiline="true"
      // A non-editable div is not in the tab order, and `refs.current[id].focus()`
      // on one does nothing — which would strand arrow-key navigation on the
      // block before a locked one.
      tabIndex={locked ? 0 : undefined}
      aria-readonly={locked || undefined}
      suppressContentEditableWarning
      onMouseDown={() => { pointerDownRef.current = true; }}
      onFocus={(e) => {
        setActive(id);
        // Focus that started inside a widget belongs to that widget: moving
        // the caret here would pull it back out mid-keystroke.
        if (isInsideWidget(e.target as HTMLElement)) return;
        const el = e.currentTarget as HTMLDivElement;
        if (!el.innerHTML && (html ?? '') !== '') {
          el.innerHTML = html || '';
        }
        // When focus was initiated by a pointer (mouse/touch), preserve the browser's caret
        // placement instead of forcing it to the end. Reset the flag after this tick.
        if (pointerDownRef.current) {
          queueMicrotask(() => { pointerDownRef.current = false; });
          return;
        }
        const range = document.createRange();
        range.selectNodeContents(el);
        range.collapse(false);
        const sel = window.getSelection();
        if (sel) { sel.removeAllRanges(); sel.addRange(range); }
      }}
      onClick={() => setActive(id)}
      onBlur={(e) => {
        const el = e.currentTarget as HTMLDivElement;
        const row = el.closest('[data-block-id]') as HTMLElement | null;
        const explicitNext = (e.relatedTarget as HTMLElement | null) || null;
        const canvas = el.closest('.canvas') as HTMLElement | null;
        // If the slash menu is open, do not clear active block when focus appears to move elsewhere
        if (isSlashMenuOpen()) return;
        // Focus moved within the same block row (e.g., controls) → keep active
        if (row && explicitNext && row.contains(explicitNext)) return;
        // Defer to allow focus to settle (e.relatedTarget can be null on mousedown)
        queueMicrotask(() => {
          const next = document.activeElement as HTMLElement | null;
          if (isSlashMenuOpen()) return;
          // If focus remains inside the same row, keep active
          if (row && next && row.contains(next)) return;
          // If focus moved elsewhere but still inside the editor canvas, do not clear here.
          // The destination will set active via its own focus handler.
          if (canvas && next && canvas.contains(next)) return;
          setActive(null);
        });
      }}
      onInput={(e) => {
        // IME composition commits on compositionend, not per update: an
        // intermediate commit re-renders the block mid-composition and can
        // drop the in-flight text.
        if (composingRef.current) return;
        const target = e.currentTarget as HTMLDivElement;
        const serialized = serializeEditableHtml(target);
        if (target.getAttribute('data-serialized') !== serialized) {
          target.setAttribute('data-serialized', serialized);
          updateHtml(id, serialized);
        }
      }}
      onCompositionStart={() => { composingRef.current = true; }}
      onCompositionEnd={(e) => {
        composingRef.current = false;
        const target = e.currentTarget as HTMLDivElement;
        const serialized = serializeEditableHtml(target);
        if (target.getAttribute('data-serialized') !== serialized) {
          target.setAttribute('data-serialized', serialized);
          updateHtml(id, serialized);
        }
      }}
      onPaste={(e) => {
        // Widget interiors (table cells, …) run their own paste handling.
        const selection = window.getSelection();
        if (isInsideWidget(selection?.anchorNode) || isInsideWidget(e.target as Node)) return;
        // Browser-default paste would drop arbitrary clipboard HTML into the
        // DOM; `onInput` would then serialize it into document state and it
        // would round-trip to storage as stored XSS. Placeholder spans are
        // dropped as well: their children don't travel with a copy, so a
        // pasted `data-child-id` span would render as an empty ghost widget.
        e.preventDefault();
        const html = e.clipboardData.getData('text/html');
        if (html) {
          document.execCommand(
            'insertHTML',
            false,
            sanitizeEditableHtml(html, { placeholders: 'drop' }),
          );
          return;
        }
        const text = e.clipboardData.getData('text/plain');
        if (text) document.execCommand('insertText', false, text);
      }}
      onKeyDown={(e) => {
        // Typing inside a widget is that widget's business — the paragraph
        // must not steal '/' for the command menu or Backspace for deletion.
        const selection = window.getSelection();
        if (
          isInsideWidget(selection?.anchorNode) ||
          isInsideWidget(document.activeElement) ||
          isInsideWidget(e.target as Node)
        ) {
          return;
        }
        const el = e.currentTarget as HTMLDivElement;
        // IME composition keydowns are not commands: Chrome masks most as
        // 'Process', but Firefox/Safari leak Backspace/Enter — which used to
        // delete or split the block mid-composition.
        if (e.nativeEvent.isComposing || composingRef.current) return;
        // A selection spanning two editables would make the browser do DOM
        // surgery across two React-tracked roots; collapse it into this block
        // before an editing key acts on it.
        if (selection && !selection.isCollapsed && selection.rangeCount > 0) {
          const range = selection.getRangeAt(0);
          if (
            !el.contains(range.commonAncestorContainer) &&
            (e.key === 'Backspace' || e.key === 'Delete' || e.key === 'Enter' || e.key.length === 1)
          ) {
            e.preventDefault();
            selection.collapseToStart();
            return;
          }
        }
        // Nothing that mutates a locked block applies to it. Arrow keys fall
        // through to the navigation handler below, which only moves the caret.
        if (locked && !e.key.startsWith('Arrow')) return;
        if (slashEnabled && e.key === '/' && !e.shiftKey && !e.ctrlKey && !e.metaKey && !e.altKey) {
          // Mid-word the key falls through and types a literal '/'; the menu
          // only opens at a word boundary.
          if (!caretAtWordBoundary(el)) return;
          e.preventDefault();
          openSlashMenu(id);
          return;
        }
        if (e.key === 'Enter' && !e.ctrlKey && !e.metaKey && !e.shiftKey && !e.altKey) {
          // Split the block at the caret; the text after it moves into a new
          // paragraph below. Ctrl+Enter below keeps the old "empty block
          // after" behavior.
          e.preventDefault();
          if (!selection || selection.rangeCount === 0) return;
          const range = selection.getRangeAt(0);
          range.deleteContents();
          const afterRange = document.createRange();
          afterRange.setStart(range.endContainer, range.endOffset);
          afterRange.setEnd(el, el.childNodes.length);
          const holder = document.createElement('div');
          holder.appendChild(afterRange.extractContents());
          const afterHtml = serializeEditableHtml(holder);
          const beforeHtml = serializeEditableHtml(el);
          // The live DOM already shows exactly the before half.
          el.setAttribute('data-serialized', beforeHtml);
          const newId = splitBlock(id, beforeHtml, afterHtml);
          requestAnimationFrame(() => {
            const target = refs.current[newId];
            if (target) { target.focus(); restoreCaretOffset(target, 0); }
          });
          return;
        }
        if (e.key === 'Enter' && e.ctrlKey) {
          e.preventDefault();
          const newId = addBlockAfter(id, 'paragraph');
          queueMicrotask(() => refs.current[newId]?.focus());
          return;
        }
        if (e.key === 'Backspace') {
          const html = el.innerHTML.trim();
          // Only delete the block when it is truly empty (no lines),
          // not when it has only newline wrappers like <div><br></div>.
          const isTrulyEmpty = html === '' || /^<br\s*\/?>(?:\s*)?$/i.test(html);
          if (isTrulyEmpty) { e.preventDefault(); removeBlock(id); return; }
          // At the very start of a non-empty block, Backspace merges the
          // block into the one above instead of doing nothing.
          if (selection?.isCollapsed && captureCaretOffset(el) === 0) {
            e.preventDefault();
            const merged = mergeWithPrevious(id);
            if (merged && merged.targetId !== id) {
              requestAnimationFrame(() => {
                const target = refs.current[merged.targetId];
                if (target) { target.focus(); restoreCaretOffset(target, merged.caretOffset); }
              });
            }
          }
          return;
        }
        // Arrow keys cross block boundaries at the edges of the text.
        if (
          (e.key === 'ArrowLeft' || e.key === 'ArrowUp' || e.key === 'ArrowRight' || e.key === 'ArrowDown') &&
          !e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey &&
          selection?.isCollapsed
        ) {
          const offset = captureCaretOffset(el);
          const textLength = el.textContent?.length ?? 0;
          if ((e.key === 'ArrowLeft' || e.key === 'ArrowUp') && offset === 0) {
            const prevId = neighbourBlock(-1);
            if (prevId) {
              e.preventDefault();
              const target = refs.current[prevId];
              if (target) { target.focus(); restoreCaretOffset(target, target.textContent?.length ?? 0); }
            }
          } else if ((e.key === 'ArrowRight' || e.key === 'ArrowDown') && offset === textLength) {
            const nextId = neighbourBlock(1);
            if (nextId) {
              e.preventDefault();
              const target = refs.current[nextId];
              if (target) { target.focus(); restoreCaretOffset(target, 0); }
            }
          }
        }
      }}
      data-placeholder={placeholder}
      style={style}
      /* Initial content is set via useLayoutEffect to avoid caret resets */
    />
  );
}
