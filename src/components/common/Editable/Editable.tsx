import type { CSSProperties } from 'react';
import './Editable.css';
import { useEditor } from '../../../editor';

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
  const { addBlockAfter, removeBlock, updateHtml, refs, setActive } = useEditor();
  return (
    <div
      className={['editable', className].filter(Boolean).join(' ')}
      ref={(el) => { refs.current[id] = el; }}
      contentEditable
      suppressContentEditableWarning
      onFocus={() => setActive(id)}
      onClick={() => setActive(id)}
      onBlur={() => setActive(null)}
      onInput={(e) => updateHtml(id, (e.target as HTMLDivElement).innerHTML)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault();
          const newId = addBlockAfter(id, 'paragraph');
          queueMicrotask(() => refs.current[newId]?.focus());
        }
        if (e.key === 'Backspace') {
          const text = (e.currentTarget as HTMLDivElement).innerText.trim();
          if (!text) { e.preventDefault(); removeBlock(id); }
        }
      }}
      data-placeholder={placeholder}
      style={style}
      dangerouslySetInnerHTML={{ __html: html || '' }}
    />
  );
}
