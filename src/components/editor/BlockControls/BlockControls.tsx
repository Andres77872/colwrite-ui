import './BlockControls.css';
import { useEditor } from '../../../editor';
import { useEffect, useRef, useState, type KeyboardEventHandler } from 'react';

export function BlockControls({ id }: { id: string }) {
  const { addBlockAfter, moveBlock, removeBlock } = useEditor();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);
  const addBtnRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const onDocClick = (e: MouseEvent) => {
      if (!ref.current) return;
      if (!ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, []);

  const add = (type: Parameters<typeof addBlockAfter>[1]) => {
    addBlockAfter(id, type);
    setOpen(false);
  };

  // When menu opens, focus first item
  useEffect(() => {
    if (!open) return;
    const first = menuRef.current?.querySelector<HTMLButtonElement>('button');
    first?.focus();
  }, [open]);

  const onAddKeyDown: KeyboardEventHandler = (e) => {
    if (!open) return;
    const items = Array.from(menuRef.current?.querySelectorAll<HTMLButtonElement>('button') || []);
    const currentIndex = items.findIndex((el) => el === document.activeElement);
    if (e.key === 'Escape') {
      setOpen(false);
      addBtnRef.current?.focus();
      e.preventDefault();
    } else if (e.key === 'ArrowDown') {
      const next = items[(currentIndex + 1) % items.length];
      next?.focus();
      e.preventDefault();
    } else if (e.key === 'ArrowUp') {
      const prev = items[(currentIndex - 1 + items.length) % items.length];
      prev?.focus();
      e.preventDefault();
    } else if (e.key === 'Home') {
      items[0]?.focus();
      e.preventDefault();
    } else if (e.key === 'End') {
      items[items.length - 1]?.focus();
      e.preventDefault();
    }
  };

  return (
    <div className="block-controls" ref={ref}>
      <button
        ref={addBtnRef}
        className="icon"
        title="Add block"
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen(v => !v)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown' && !open) {
            setOpen(true);
            e.preventDefault();
          } else if (e.key === 'Escape' && open) {
            setOpen(false);
            e.preventDefault();
          }
        }}
      >
        ＋
      </button>
      <button className="icon" title="Move up" type="button" aria-label="Move block up" onClick={() => moveBlock(id, -1)}>↑</button>
      <button className="icon" title="Move down" type="button" aria-label="Move block down" onClick={() => moveBlock(id, 1)}>↓</button>
      <button className="icon danger" title="Delete" type="button" aria-label="Delete block" onClick={() => removeBlock(id)}>🗑</button>
      {open && (
        <div className="block-menu" role="menu" ref={menuRef} onKeyDown={onAddKeyDown}>
          <button role="menuitem" onClick={() => add('paragraph')}><span className="mi">✍️</span> Text</button>
          <button role="menuitem" onClick={() => add('heading')}><span className="mi">🔠</span> Heading</button>
          <button role="menuitem" onClick={() => add('todo')}><span className="mi">☑️</span> Todo</button>
          <button role="menuitem" onClick={() => add('counter')}><span className="mi">🔢</span> Counter</button>
          <button role="menuitem" onClick={() => add('divider')}><span className="mi">━</span> Divider</button>
        </div>
      )}
    </div>
  );
}
