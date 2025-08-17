import type { CSSProperties } from 'react';
import './Editable.css';
import { useEditor } from '../../../editor';
import { useLayoutEffect } from 'react';
import { openSlashMenu } from '../../editor/SlashMenu/SlashMenu';

export function Editable({
  id,
  html,
  placeholder,
  className,
  style,
}: {
  id: string;
  html: string;
  placeholder?: string;
  className?: string;
  style?: CSSProperties;
}) {
  const { addBlockAfter, removeBlock, updateHtml, refs, setActive, activeId } = useEditor();

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
      className={['editable', className].filter(Boolean).join(' ')}
      ref={(el) => { refs.current[id] = el; }}
      contentEditable
      suppressContentEditableWarning
      onFocus={(e) => {
        setActive(id);
        // If focus originated inside an AI widget, do not steal focus or move caret
        const origin = e.target as HTMLElement;
        const insideAi = !!origin.closest?.('.ai-suggest, .ai-beat-widget');
        if (insideAi) return;
        const el = e.currentTarget as HTMLDivElement;
        if (!el.innerHTML && (html ?? '') !== '') {
          el.innerHTML = html || '';
        }
        const range = document.createRange();
        range.selectNodeContents(el);
        range.collapse(false);
        const sel = window.getSelection();
        if (sel) { sel.removeAllRanges(); sel.addRange(range); }
      }}
      onClick={() => setActive(id)}
      onBlur={() => setActive(null)}
      onInput={(e) => updateHtml(id, (e.target as HTMLDivElement).innerHTML)}
      onKeyDown={(e) => {
        // If caret or focus is inside an AI UI wrapper, allow normal editing and do not intercept '/'
        const sel = window.getSelection();
        const anchor = sel && sel.anchorNode;
        const anchorEl = (anchor && (anchor.nodeType === 1 ? (anchor as HTMLElement) : (anchor as Node).parentElement)) as HTMLElement | null;
        const inAiSuggest = !!anchorEl?.closest('.ai-suggest');
        const inAiBeat = !!(document.activeElement as HTMLElement | null)?.closest?.('.ai-beat-widget') || !!anchorEl?.closest('.ai-beat-widget');
        if (inAiSuggest || inAiBeat) return;
        if (e.key === '/' && !e.shiftKey && !e.ctrlKey && !e.metaKey && !e.altKey) {
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
