import type { CSSProperties } from 'react';
import { cn } from '@/lib/utils';
import { useEditor } from '../../../editor';
import { useLayoutEffect, useRef } from 'react';
import { openSlashMenu, isSlashMenuOpen } from '../../editor/SlashMenu/SlashMenu';

/**
 * Reduce inline-widget placeholders in *clone* back to empty spans.
 *
 * Widgets are React-rendered into their placeholder, so the live DOM holds
 * their whole UI. Persisting that would store rendered internals as document
 * content — and on the next render the widget would be portalled in on top of
 * its own stale markup.
 */
export function clearChildPlaceholders(clone: HTMLElement): void {
  clone.querySelectorAll('[data-child-id]').forEach((el) => {
    const elh = el as HTMLElement;
    elh.setAttribute('contenteditable', 'false');
    while (elh.firstChild) elh.removeChild(elh.firstChild);
  });
}

export function serializeEditableHtml(root: HTMLDivElement): string {
  const clone = root.cloneNode(true) as HTMLDivElement;
  clearChildPlaceholders(clone);
  return clone.innerHTML;
}

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

export function Editable({
  id,
  html,
  placeholder,
  className,
  style,
  slashEnabled = false,
}: {
  id: string;
  html: string;
  placeholder?: string;
  className?: string;
  style?: CSSProperties;
  slashEnabled?: boolean;
}) {
  const { addBlockAfter, removeBlock, updateHtml, refs, setActive, activeId } = useEditor();
  const pointerDownRef = useRef(false);

  // Keep DOM content in sync only when NOT actively editing this block.
  // When becoming active (focus), ensure content is restored if a re-render replaced the node.
  useLayoutEffect(() => {
    const el = refs.current[id];
    if (!el) return;
    const next = html || '';
    if (activeId !== id) {
      if (el.innerHTML !== next) el.innerHTML = next;
    } else {
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
  }, [html, activeId, id, refs]);
  return (
    <div
      className={cn(
        // `editable` is the hook FloatingToolbar walks the DOM for to decide
        // whether a selection is inside a block. Without it the format and
        // AI-action toolbar never appears.
        "editable",
        "min-h-[1.5em] w-full outline-none whitespace-pre-wrap break-words",
        "focus:outline-none focus-visible:outline-none",
        className
      )}
      ref={(el) => { refs.current[id] = el; }}
      contentEditable
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
        const target = e.currentTarget as HTMLDivElement;
        const serialized = serializeEditableHtml(target);
        if (target.getAttribute('data-serialized') !== serialized) {
          target.setAttribute('data-serialized', serialized);
          updateHtml(id, serialized);
        }
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
        if (slashEnabled && e.key === '/' && !e.shiftKey && !e.ctrlKey && !e.metaKey && !e.altKey) {
          // Open slash menu and prevent literal '/'
          e.preventDefault();
          openSlashMenu(id);
          return;
        }
        if (e.key === 'Enter' && e.ctrlKey) {
          e.preventDefault();
          const newId = addBlockAfter(id, 'paragraph');
          queueMicrotask(() => refs.current[newId]?.focus());
        }
        if (e.key === 'Backspace') {
          const html = (e.currentTarget as HTMLDivElement).innerHTML.trim();
          // Only delete the block when it is truly empty (no lines),
          // not when it has only newline wrappers like <div><br></div>.
          const isTrulyEmpty = html === '' || /^<br\s*\/?>(?:\s*)?$/i.test(html);
          if (isTrulyEmpty) { e.preventDefault(); removeBlock(id); }
        }
      }}
      data-placeholder={placeholder}
      style={style}
      /* Initial content is set via useLayoutEffect to avoid caret resets */
    />
  );
}
