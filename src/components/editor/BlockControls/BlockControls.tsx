import { useEditor } from '../../../editor';
import { useEffect, useRef, useState, type KeyboardEventHandler } from 'react';

export function BlockControls({ id }: { id: string }) {
  const { addBlockAfter, moveBlock, removeBlock, toggleAiHidden, toggleLocked, toggleCollapsed, blocks, setParagraphColumns, setHeadingLevel } = useEditor();
  const [open, setOpen] = useState(false);
  const [colsOpen, setColsOpen] = useState(false);
  const [headingOpen, setHeadingOpen] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);
  const addBtnRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const colsRef = useRef<HTMLDivElement | null>(null);
  const headingRef = useRef<HTMLDivElement | null>(null);
  const block = blocks.find(b => b.id === id);

  useEffect(() => {
    const onDocClick = (e: MouseEvent) => {
      if (!ref.current) return;
      const target = e.target as Node;
      if (!ref.current.contains(target)) {
        setOpen(false);
        setColsOpen(false);
        setHeadingOpen(false);
      }
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
    <div className={["block-controls", open ? "open" : ""].filter(Boolean).join(" ")} ref={ref}>
      <div className="bc-left">
        <button
          className="icon drag-handle"
          title="Drag to reorder"
          type="button"
          aria-label="Drag to reorder"
          draggable
          data-drag-handle="true"
          onMouseDown={(e) => e.stopPropagation()}
          onClick={(e) => e.preventDefault()}
          onDragStart={(e) => {
            e.dataTransfer.setData('text/plain', id);
            e.dataTransfer.setData('application/x-block-id', id);
            e.dataTransfer.effectAllowed = 'move';
            if (e.currentTarget) {
              e.dataTransfer.setDragImage(e.currentTarget as Element, 8, 8);
            }
          }}
        >
          ⋮⋮
        </button>
      </div>
      {/* Centered editor controls (edition) */}
      {(block?.type === 'paragraph' || block?.type === 'heading') && (
        <div className="bc-center-editor" role="group" aria-label="Block editor" onMouseDown={(e) => e.stopPropagation()}>
          <div className="bc-editor-card" role="toolbar" aria-label="Block edition">
            {block?.type === 'paragraph' && (
              <div style={{ position: 'relative' }} ref={colsRef}>
                <button
                  className={["editor-btn", colsOpen ? "is-open" : ""].filter(Boolean).join(" ")}
                  title="Columns"
                  type="button"
                  aria-haspopup="menu"
                  aria-expanded={colsOpen}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => { setColsOpen(v => !v); setHeadingOpen(false); }}
                >
                  <span className="editor-icon" aria-hidden>▦</span>
                  <span className="editor-label">Columns</span>
                  <span className="editor-value">{String((block as any)?.columns || 1)}</span>
                </button>
                {colsOpen && (
                  <div className="editor-menu" role="menu">
                    <div className="segmented" role="group" aria-label="Columns options">
                      {[1,2,3,4].map(n => (
                        <button
                          role="menuitemradio"
                          aria-checked={n === (block as any)?.columns || (n===1 && !(block as any)?.columns)}
                          key={n}
                          className={["seg-btn", n === ((block as any)?.columns || 1) ? "active" : ""].filter(Boolean).join(" ")}
                          type="button"
                          title={`${n} column${n>1?'s':''}`}
                          onClick={() => { setParagraphColumns(id, n); setColsOpen(false); }}
                        >
                          {n}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
            {block?.type === 'heading' && (
              <div style={{ position: 'relative' }} ref={headingRef}>
                <button
                  className={["editor-btn", headingOpen ? "is-open" : ""].filter(Boolean).join(" ")}
                  title="Heading level"
                  type="button"
                  aria-haspopup="menu"
                  aria-expanded={headingOpen}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => { setHeadingOpen(v => !v); setColsOpen(false); }}
                >
                  <span className="editor-icon" aria-hidden>H</span>
                  <span className="editor-label">Level</span>
                  <span className="editor-value">{String((block as any)?.level || 2)}</span>
                </button>
                {headingOpen && (
                  <div className="editor-menu" role="menu">
                    <div className="segmented" role="group" aria-label="Heading level">
                      {[1,2,3].map(l => (
                        <button
                          role="menuitemradio"
                          aria-checked={l === (block as any)?.level}
                          key={l}
                          className={["seg-btn", l === (block as any)?.level ? "active" : ""].filter(Boolean).join(" ")}
                          type="button"
                          title={`Heading ${l}`}
                          onClick={() => { setHeadingLevel(id, l as 1|2|3); setHeadingOpen(false); }}
                        >
                          H{l}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Right-aligned actions */}
      <div className="bc-top-right">
        <button 
          className={["icon", (block as any)?.aiHidden ? "active-ai-hidden" : ""].filter(Boolean).join(" ")} 
          title={(block as any)?.aiHidden ? 'Show to AI' : 'Hide from AI'} 
          type="button" 
          onClick={() => toggleAiHidden(id)}
        >
          {(block as any)?.aiHidden ? '🙈' : '👁️'}
        </button>
        <button 
          className={["icon", (block as any)?.locked ? "active-locked" : ""].filter(Boolean).join(" ")} 
          title={(block as any)?.locked ? 'Unlock' : 'Lock'} 
          type="button" 
          onClick={() => toggleLocked(id)}
        >
          {(block as any)?.locked ? '🔓' : '🔒'}
        </button>
        <button 
          className={["icon", (block as any)?.collapsed ? "active-collapsed" : ""].filter(Boolean).join(" ")} 
          title={(block as any)?.collapsed ? 'Expand' : 'Collapse'} 
          type="button" 
          onClick={() => toggleCollapsed(id)}
        >
          {(block as any)?.collapsed ? '▾' : '▸'}
        </button>
        <button className="icon danger" title="Delete" type="button" aria-label="Delete block" onClick={() => removeBlock(id)}>🗑</button>
      </div>
      <div className={["block-add-inline", open ? "open" : ""].filter(Boolean).join(" ")}>
        <div className="bottom-controls">
          <button className="icon" title="Move up" type="button" aria-label="Move block up" onClick={() => moveBlock(id, -1)}>↑</button>
          <button
            ref={addBtnRef}
            className="icon add-inline-btn"
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
          <button className="icon" title="Move down" type="button" aria-label="Move block down" onClick={() => moveBlock(id, 1)}>↓</button>
        </div>
        {open && (
          <div className="block-menu" role="menu" ref={menuRef} onKeyDown={onAddKeyDown}>
            <button role="menuitem" onClick={() => add('paragraph')}><span className="mi">✍️</span> Text</button>
            <button role="menuitem" onClick={() => add('heading')}><span className="mi">🔠</span> Heading</button>
            <button role="menuitem" onClick={() => add('divider')}><span className="mi">━</span> Divider</button>
          </div>
        )}
      </div>
    </div>
  );
}
