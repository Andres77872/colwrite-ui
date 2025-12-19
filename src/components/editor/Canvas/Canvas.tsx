import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { DocumentHeader } from '../DocumentChrome';
import { useEditor } from '../../../editor';
import { Fragment, useRef, useState } from 'react';
import type { Doc } from '../../../editor/types';
import { uid } from '../../../lib/uid';
import type { DragEvent } from 'react';
import { BlockControls } from '../BlockControls';
import { ParagraphBlock } from '../blocks/ParagraphBlock';
import { HeadingBlock } from '../blocks/HeadingBlock';
import { DividerBlock } from '../blocks/DividerBlock';
import { Plus, ChevronRight, Type, Heading2, Minus } from 'lucide-react';

// Add block bar component at the bottom of the editor
function AddBlockBar({ 
  onAdd, 
  insertIndex, 
  blocksLength, 
  onDragOver 
}: { 
  onAdd: (type: 'paragraph' | 'heading' | 'divider') => void;
  insertIndex: number | null;
  blocksLength: number;
  onDragOver: (e: React.DragEvent) => void;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // Close menu on outside click
  useState(() => {
    const handleClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  });

  return (
    <div
      ref={ref}
      className={cn(
        "relative py-4 pl-10",
        insertIndex === blocksLength && "before:content-[''] before:absolute before:left-10 before:right-0 before:top-2 before:h-0.5 before:bg-primary before:rounded-full"
      )}
      onDragOver={onDragOver}
    >
      <div className="relative inline-block">
        <button
          className={cn(
            "flex items-center gap-2 text-muted-foreground text-sm",
            "hover:text-foreground px-3 py-1.5 rounded-md",
            "border border-transparent hover:border-border hover:bg-accent/50",
            "transition-colors",
            menuOpen && "border-border bg-accent text-foreground"
          )}
          onClick={() => setMenuOpen(v => !v)}
        >
          <Plus className="h-4 w-4" />
          <span>Add a block</span>
        </button>

        {menuOpen && (
          <div className={cn(
            "absolute top-full left-0 mt-1 z-50",
            "bg-popover border border-border rounded-lg shadow-xl",
            "py-1 min-w-[180px]",
            "animate-in fade-in-0 zoom-in-95 duration-100"
          )}>
            <button
              className="w-full flex items-center gap-2.5 px-3 py-2 text-sm text-left hover:bg-accent"
              onClick={() => { onAdd('paragraph'); setMenuOpen(false); }}
            >
              <Type className="h-4 w-4 text-muted-foreground" />
              <span>Paragraph</span>
            </button>
            <button
              className="w-full flex items-center gap-2.5 px-3 py-2 text-sm text-left hover:bg-accent"
              onClick={() => { onAdd('heading'); setMenuOpen(false); }}
            >
              <Heading2 className="h-4 w-4 text-muted-foreground" />
              <span>Heading</span>
            </button>
            <button
              className="w-full flex items-center gap-2.5 px-3 py-2 text-sm text-left hover:bg-accent"
              onClick={() => { onAdd('divider'); setMenuOpen(false); }}
            >
              <Minus className="h-4 w-4 text-muted-foreground" />
              <span>Divider</span>
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

export function Canvas() {
  const { blocks, activeId, setActive, reorderBlock, addBlockAtStart, addBlockAfter, refs, updateHtml, documentId, createRemote, setFromJSON, hasAnyRemoteDocs } = useEditor();
  const [overId, setOverId] = useState<string | null>(null);
  const [overPos, setOverPos] = useState<'before' | 'after' | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [insertIndex, setInsertIndex] = useState<number | null>(null);
  const [creating, setCreating] = useState<boolean>(false);

  const showLanding = (hasAnyRemoteDocs === false) && !documentId;
  const isCheckingDocs = (hasAnyRemoteDocs === null) && !documentId;

  const clearDnd = () => {
    setOverId(null);
    setOverPos(null);
    setInsertIndex(null);
  };

  const handleDragOver = (e: DragEvent<HTMLDivElement>, idx: number) => {
    const types = Array.from(e.dataTransfer.types || []);
    const isBlockDrag = types.includes('application/x-block-id') || types.includes('text/plain');
    if (!isBlockDrag) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    const rect = (e.currentTarget as HTMLDivElement).getBoundingClientRect();
    const pos = e.clientY < rect.top + rect.height / 2 ? 'before' : 'after';
    setOverId(blocks[idx].id);
    setOverPos(pos);
    setInsertIndex(pos === 'before' ? idx : idx + 1);
  };

  const updateIndicatorFromPoint = (y: number) => {
    const root = containerRef.current;
    if (!root) return;
    const rows = Array.from(root.querySelectorAll<HTMLDivElement>('.block-row'));
    if (rows.length === 0) return;
    let updated = false;
    for (let i = 0; i < rows.length; i++) {
      const el = rows[i];
      const rect = el.getBoundingClientRect();
      if (y < rect.top) {
        setOverId(el.dataset.blockId || null);
        setOverPos('before');
        setInsertIndex(i);
        updated = true;
        break;
      }
      if (y <= rect.bottom) {
        const pos = y < rect.top + rect.height / 2 ? 'before' : 'after';
        setOverId(el.dataset.blockId || null);
        setOverPos(pos);
        setInsertIndex(pos === 'before' ? i : i + 1);
        updated = true;
        break;
      }
    }
    if (!updated) {
      setOverId(null);
      setOverPos(null);
      setInsertIndex(rows.length);
    }
  };

  const buildIntroDoc = (): Doc => ({
    version: 1,
    name: 'Welcome to ColWrite',
    blocks: [
      { id: uid(), type: 'heading', level: 2, html: 'Welcome to ColWrite' },
      { id: uid(), type: 'paragraph', html: 'This is your workspace. Use the / key to insert blocks like headings, equations, citations, and more. Select text to format.' , children: [], columns: 1 },
      { id: uid(), type: 'divider' },
      { id: uid(), type: 'heading', level: 3, html: 'Quick things you can do' },
      { id: uid(), type: 'paragraph', html: '• Ask the Assistant for outlines, rewrites, and summaries.\n• Insert citations and equations inline.\n• Organize with headings and dividers.' , children: [], columns: 1 },
    ],
  });

  const createFirstDoc = async () => {
    try {
      setCreating(true);
      const intro = buildIntroDoc();
      setFromJSON(JSON.stringify(intro));
      await createRemote(intro);
    } finally {
      setCreating(false);
    }
  };

  const startBlank = async () => {
    try {
      setCreating(true);
      const blank: Doc = { version: 1, name: 'Untitled document', blocks: [] };
      setFromJSON(JSON.stringify(blank));
      await createRemote(blank);
    } finally {
      setCreating(false);
    }
  };

  return (
    <div
      className="canvas min-h-full flex flex-col outline-none"
      ref={containerRef}
      tabIndex={0}
      onDragEnd={clearDnd}
      onDragOverCapture={(e) => {
        if (Array.from(e.dataTransfer.types || []).includes('application/x-block-id')) {
          e.preventDefault();
          updateIndicatorFromPoint(e.clientY);
        }
      }}
      onMouseDown={(e) => {
        if (showLanding) return;
        if (blocks.length === 0) {
          const target = e.target as HTMLElement | null;
          const insideUi = !!target?.closest?.('.empty-card, button, .floating-toolbar, .slash-menu');
          if (!insideUi) {
            (e.currentTarget as HTMLDivElement).focus();
          }
        }
      }}
      onKeyDown={(e) => {
        if (showLanding) return;
        if (blocks.length > 0) return;
        if (e.ctrlKey || e.metaKey || e.altKey) return;
        if (e.key === 'Enter') {
          e.preventDefault();
          const id = addBlockAtStart('paragraph');
          queueMicrotask(() => refs.current[id]?.focus());
          return;
        }
        if (e.key.length === 1) {
          e.preventDefault();
          const initial = e.key;
          const id = addBlockAtStart('paragraph');
          queueMicrotask(() => {
            const el = refs.current[id];
            if (!el) return;
            el.textContent = initial;
            updateHtml(id, el.innerHTML);
            try {
              const r = document.createRange();
              r.selectNodeContents(el);
              r.collapse(false);
              const s = window.getSelection();
              s?.removeAllRanges();
              s?.addRange(r);
            } catch {}
            el.focus();
          });
        }
      }}
      onDropCapture={(e) => {
        const fromId = e.dataTransfer.getData('application/x-block-id') || e.dataTransfer.getData('text/plain');
        if (!fromId) return;
        e.preventDefault();
        if (insertIndex != null) {
          const fromIndex = blocks.findIndex(b => b.id === fromId);
          if (fromIndex !== -1) {
            let targetIndex = insertIndex;
            if (fromIndex < targetIndex) targetIndex -= 1;
            if (fromIndex !== targetIndex) reorderBlock(fromId, targetIndex);
          }
        }
        clearDnd();
      }}
    >
      {isCheckingDocs ? (
        <div className="flex justify-center pt-12 px-4 pb-4">
          <div className="max-w-[720px] w-full border border-dashed border-border rounded-lg bg-accent p-6 text-center">
            <div className="text-muted-foreground">Preparing your workspace…</div>
          </div>
        </div>
      ) : showLanding ? (
        <div className="flex justify-center pt-12 px-4 pb-4">
          <div className="max-w-[720px] w-full border border-dashed border-border rounded-lg bg-accent p-6">
            <div className="flex items-center gap-3">
              <div className="w-7 h-7 rounded-md grid place-items-center bg-gradient-to-br from-primary to-primary/80 text-white font-bold text-sm">
                CW
              </div>
              <div>
                <div className="font-bold text-xl">ColWrite</div>
                <div className="text-muted-foreground">Assistant writer for arXiv papers</div>
              </div>
            </div>
            <div className="flex flex-col gap-3 mt-4">
              <p>
                Create your first document to get started. ColWrite combines a clean canvas with an AI assistant and quick insert commands.
              </p>
              <ul className="list-none space-y-1 text-sm">
                <li>📝 Block-based editor with "/" commands</li>
                <li>🤖 Inline Assistant for outlines, rewrites, and summaries</li>
                <li>🔗 Citations and references support</li>
                <li>∑ Equations and simple graphs</li>
                <li>💾 Autosave and versioned remote storage</li>
              </ul>
            </div>
            <div className="flex gap-2 flex-wrap mt-4">
              <Button onClick={createFirstDoc} disabled={creating}>
                {creating ? 'Creating…' : 'Create your first document'}
              </Button>
              <Button variant="outline" onClick={startBlank} disabled={creating}>Start blank</Button>
            </div>
          </div>
        </div>
      ) : (
        <div className="document-container max-w-[800px] w-full mx-auto px-4">
          <DocumentHeader />
          
          {blocks.length === 0 && (
            <div className="py-8">
              <div className="empty-card border border-dashed border-border rounded-lg bg-accent/50 p-8 text-center">
                <h3 className="font-semibold text-lg text-foreground mb-2">Start writing</h3>
                <p className="text-muted-foreground text-sm mb-6">
                  Add your first block to begin. Use '/' to open the command menu.
                </p>
                <div className="flex gap-3 justify-center flex-wrap">
                  <Button
                    onClick={() => {
                      const id = addBlockAtStart('paragraph');
                      queueMicrotask(() => refs.current[id]?.focus());
                    }}
                  >
                    <Plus className="h-4 w-4 mr-2" />
                    New text block
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() => {
                      const id = addBlockAtStart('heading');
                      queueMicrotask(() => refs.current[id]?.focus());
                    }}
                  >Add heading</Button>
                </div>
              </div>
            </div>
          )}

          {/* Blocks container */}
          <div className="blocks-container py-4">
            {blocks.map((b, i) => {
              const isCollapsed = (b as any).collapsed === true;
              const isAiHidden = (b as any).aiHidden === true;
              const isLocked = (b as any).locked === true;
              return (
                <Fragment key={b.id}>
                  {insertIndex === i && <div className="h-0.5 bg-primary rounded-full my-1 ml-8" />}
                  <div
                    className={cn(
                      "block-row group relative pl-10",
                      "py-1 pr-2",
                      "rounded-sm transition-colors duration-75",
                      "hover:bg-accent/20",
                      b.id === activeId && "bg-primary/5",
                      isCollapsed && "bg-muted/20",
                      isAiHidden && "bg-pink-950/10 border-l-2 border-pink-500/50",
                      isLocked && !isAiHidden && "bg-amber-950/10 border-l-2 border-amber-500/50",
                      isAiHidden && isLocked && "bg-red-950/10 border-l-2 border-red-500/50",
                      overId === b.id && overPos === 'before' && "before:content-[''] before:absolute before:left-8 before:right-0 before:-top-0.5 before:h-0.5 before:bg-primary before:rounded-full",
                      overId === b.id && overPos === 'after' && "after:content-[''] after:absolute after:left-8 after:right-0 after:-bottom-0.5 after:h-0.5 after:bg-primary after:rounded-full",
                    )}
                    data-block-id={b.id}
                    onClick={() => setActive(b.id)}
                    onDragEnter={(e) => handleDragOver(e as unknown as DragEvent<HTMLDivElement>, i)}
                    onDragOver={(e) => handleDragOver(e, i)}
                  >
                    {/* Block controls - positioned in left gutter */}
                    <BlockControls id={b.id} />

                    {/* Block content */}
                    <div className="block-content w-full min-h-[1.5rem]">
                      {isCollapsed ? (
                        <div className={cn(
                          "inline-flex items-center gap-2 text-muted-foreground text-sm",
                          "px-3 py-1.5 rounded bg-card/60 border border-border/50",
                          "hover:bg-card hover:border-border cursor-pointer"
                        )}>
                          <ChevronRight className="h-3 w-3" />
                          <span className="font-medium text-foreground/80 text-[13px]">
                            {b.type === 'paragraph' ? 'Paragraph' : b.type === 'heading' ? 'Heading' : 'Divider'}
                          </span>
                          {('html' in b) && (b as any).html && (
                            <span className="opacity-60 max-w-[400px] truncate text-[13px]" dangerouslySetInnerHTML={{ __html: ((b as any).html || '').replace(/<[^>]*>/g, '').slice(0, 50) }} />
                          )}
                        </div>
                      ) : (
                        <>
                          {b.type === 'paragraph' && <ParagraphBlock block={b} />}
                          {b.type === 'heading' && <HeadingBlock block={b} />}
                          {b.type === 'divider' && <DividerBlock />}
                        </>
                      )}
                    </div>
                  </div>
                </Fragment>
              );
            })}
          </div>

          {/* Bottom add block area */}
          {blocks.length > 0 && (
            <AddBlockBar 
              onAdd={(type) => {
                const lastBlock = blocks[blocks.length - 1];
                const id = addBlockAfter(lastBlock.id, type);
                queueMicrotask(() => refs.current[id]?.focus());
              }}
              insertIndex={insertIndex}
              blocksLength={blocks.length}
              onDragOver={(e) => {
                const types = Array.from(e.dataTransfer.types || []);
                const isBlockDrag = types.includes('application/x-block-id') || types.includes('text/plain');
                if (!isBlockDrag) return;
                e.preventDefault();
                e.dataTransfer.dropEffect = 'move';
                setOverId(null);
                setOverPos(null);
                setInsertIndex(blocks.length);
              }}
            />
          )}

          {/* Bottom padding for scrolling */}
          <div className="h-32" />
        </div>
      )}
    </div>
  );
}
