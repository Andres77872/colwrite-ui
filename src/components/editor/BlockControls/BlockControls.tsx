import { useEditor } from '../../../editor';
import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';

export function BlockControls({ id }: { id: string }) {
  const { addBlockAfter, moveBlock, removeBlock, toggleAiHidden, toggleLocked, toggleCollapsed, blocks, setParagraphColumns, setHeadingLevel } = useEditor();
  const [open, setOpen] = useState(false);
  const [colsOpen, setColsOpen] = useState(false);
  const [headingOpen, setHeadingOpen] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);
  const addBtnRef = useRef<HTMLButtonElement | null>(null);
  const colsRef = useRef<HTMLDivElement | null>(null);
  const headingRef = useRef<HTMLDivElement | null>(null);
  const block = blocks.find(b => b.id === id);
  const collapsed = (block as any)?.collapsed === true;

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

  // Radix handles menu focus/keyboard for add-inline menu.

  return (
    <div className={["inline-flex gap-1", open ? "open" : ""].filter(Boolean).join(" ")} ref={ref}>
      <div className={collapsed ? "absolute left-2 top-1/2 -translate-y-1/2 z-20" : "absolute left-4 top-1/2 -translate-y-1/2 z-20"}>
        <button
          className={[
            "inline-grid place-items-center rounded-md border border-border bg-background shadow-sm hover:shadow-md hover:bg-accent active:translate-y-[1px] cursor-grab active:cursor-grabbing opacity-60 hover:opacity-100 transition",
            collapsed ? "w-6 h-6 text-xs rounded-[4px]" : "w-7 h-7 text-sm"
          ].join(" ")}
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
        <div className="bc-center-editor pointer-events-none absolute left-0 right-0 -top-6 grid place-items-center opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 z-[1000]" role="group" aria-label="Block editor" onMouseDown={(e) => e.stopPropagation()}>
          <div className="bg-background border border-border rounded-full shadow-md p-1.5 inline-flex items-center gap-2 pointer-events-auto" role="toolbar" aria-label="Block edition">
            {block?.type === 'paragraph' && (
              <div style={{ position: 'relative' }} ref={colsRef}>
                <button
                  className={["inline-flex items-center gap-2 rounded-full px-3 py-2 min-w-24 text-sm hover:bg-muted", colsOpen ? "bg-muted" : ""].filter(Boolean).join(" ")}
                  title="Columns"
                  type="button"
                  aria-haspopup="menu"
                  aria-expanded={colsOpen}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => { setColsOpen(v => !v); setHeadingOpen(false); }}
                >
                  <span className="opacity-70 font-bold" aria-hidden>▦</span>
                  <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Columns</span>
                  <span className="text-sm font-bold text-foreground">{String((block as any)?.columns || 1)}</span>
                </button>
                {colsOpen && (
                  <div className="editor-menu absolute left-1/2 -translate-x-1/2 top-[calc(100%+6px)] bg-background border border-border rounded-lg shadow-md p-2 z-50" role="menu">
                    <div className="inline-flex border border-border rounded-md overflow-hidden bg-muted/40 shadow-inner" role="group" aria-label="Columns options">
                      {[1,2,3,4].map(n => (
                        <button
                          role="menuitemradio"
                          aria-checked={n === (block as any)?.columns || (n===1 && !(block as any)?.columns)}
                          key={n}
                          className={["px-3 py-1.5 text-sm font-semibold text-slate-600 min-w-9 transition", n === ((block as any)?.columns || 1) ? "bg-primary text-primary-foreground shadow" : "hover:bg-background"].filter(Boolean).join(" ")}
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
                  className={["inline-flex items-center gap-2 rounded-full px-3 py-2 min-w-24 text-sm hover:bg-muted", headingOpen ? "bg-muted" : ""].filter(Boolean).join(" ")}
                  title="Heading level"
                  type="button"
                  aria-haspopup="menu"
                  aria-expanded={headingOpen}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => { setHeadingOpen(v => !v); setColsOpen(false); }}
                >
                  <span className="opacity-70 font-bold" aria-hidden>H</span>
                  <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Level</span>
                  <span className="text-sm font-bold text-foreground">{String((block as any)?.level || 2)}</span>
                </button>
                {headingOpen && (
                  <div className="editor-menu absolute left-1/2 -translate-x-1/2 top-[calc(100%+6px)] bg-background border border-border rounded-lg shadow-md p-2 z-50" role="menu">
                    <div className="inline-flex border border-border rounded-md overflow-hidden bg-muted/40 shadow-inner" role="group" aria-label="Heading level">
                      {[1,2,3].map(l => (
                        <button
                          role="menuitemradio"
                          aria-checked={l === (block as any)?.level}
                          key={l}
                          className={["px-3 py-1.5 text-sm font-semibold text-slate-600 min-w-9 transition", l === (block as any)?.level ? "bg-primary text-primary-foreground shadow" : "hover:bg-background"].filter(Boolean).join(" ")}
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
      <div className="absolute right-2 -top-6 inline-flex gap-1 items-center px-1.5 py-1 bg-background/95 border border-border rounded-md shadow-md backdrop-blur opacity-0 invisible group-hover:opacity-100 group-hover:visible group-focus-within:opacity-100 group-focus-within:visible transition-opacity pointer-events-auto z-[1002]">
        <button 
          className={[ (block as any)?.aiHidden ? "inline-grid place-items-center w-6 h-6 rounded-sm bg-pink-500 text-white hover:bg-pink-600 border border-pink-500 transition" : "inline-grid place-items-center w-6 h-6 rounded-sm border border-transparent hover:bg-black/5 transition"].filter(Boolean).join(" ")} 
          title={(block as any)?.aiHidden ? 'Show to AI' : 'Hide from AI'} 
          type="button" 
          onClick={() => toggleAiHidden(id)}
        >
          {(block as any)?.aiHidden ? '🙈' : '👁️'}
        </button>
        <button 
          className={[ (block as any)?.locked ? "inline-grid place-items-center w-6 h-6 rounded-sm bg-amber-500 text-white hover:bg-amber-600 border border-amber-500 transition" : "inline-grid place-items-center w-6 h-6 rounded-sm border border-transparent hover:bg-black/5 transition"].filter(Boolean).join(" ")} 
          title={(block as any)?.locked ? 'Unlock' : 'Lock'} 
          type="button" 
          onClick={() => toggleLocked(id)}
        >
          {(block as any)?.locked ? '🔓' : '🔒'}
        </button>
        <button 
          className={[ (block as any)?.collapsed ? "inline-grid place-items-center w-6 h-6 rounded-sm bg-indigo-500 text-white hover:bg-indigo-600 border border-indigo-500 transition" : "inline-grid place-items-center w-6 h-6 rounded-sm border border-transparent hover:bg-black/5 transition"].filter(Boolean).join(" ")} 
          title={(block as any)?.collapsed ? 'Expand' : 'Collapse'} 
          type="button" 
          onClick={() => toggleCollapsed(id)}
        >
          {(block as any)?.collapsed ? '▾' : '▸'}
        </button>
        <button className="inline-grid place-items-center w-6 h-6 rounded-sm text-destructive border border-destructive hover:bg-destructive/10 transition" title="Delete" type="button" aria-label="Delete block" onClick={() => removeBlock(id)}>🗑</button>
      </div>
      <div className={["absolute left-1/2 -translate-x-1/2 -bottom-3 grid place-items-center opacity-0 pointer-events-none z-20 group-hover:opacity-100 group-hover:pointer-events-auto group-focus-within:opacity-100 group-focus-within:pointer-events-auto", open ? "opacity-100 pointer-events-auto" : ""].filter(Boolean).join(" ")}>
        <div className="inline-flex gap-1 items-center">
          <button className="inline-grid place-items-center w-6 h-6 rounded-sm border border-border bg-background shadow-sm hover:bg-accent transition" title="Move up" type="button" aria-label="Move block up" onClick={() => moveBlock(id, -1)}>↑</button>
          <DropdownMenu open={open} onOpenChange={setOpen}>
            <DropdownMenuTrigger asChild>
              <Button
                ref={addBtnRef}
                className="rounded-full w-7 h-7 shadow-sm hover:shadow-md"
                size="icon"
                variant="secondary"
                title="Add block"
                aria-label="Add block"
              >
                ＋
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="center">
              <DropdownMenuItem onClick={() => add('paragraph')}><span className="inline-block w-5 text-center opacity-80">✍️</span> Text</DropdownMenuItem>
              <DropdownMenuItem onClick={() => add('heading')}><span className="inline-block w-5 text-center opacity-80">🔠</span> Heading</DropdownMenuItem>
              <DropdownMenuItem onClick={() => add('divider')}><span className="inline-block w-5 text-center opacity-80">━</span> Divider</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <button className="inline-grid place-items-center w-6 h-6 rounded-sm border border-border bg-background shadow-sm hover:bg-accent transition" title="Move down" type="button" aria-label="Move block down" onClick={() => moveBlock(id, 1)}>↓</button>
        </div>
      </div>
    </div>
  );
}
