import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { cn } from '@/lib/utils';
import type { RefObject, SetStateAction } from 'react';
import { useEditor } from '../../../../editor';
import type { Block } from '../../../../editor';
import { loadDocument as apiLoadDocument } from '../../../../services';

type DocSummary = { _id: string; name?: string };

export type ChatRefPickerHandle = {
  openAt: (anchorIndex: number, opts?: { editing?: boolean }) => void;
  close: () => void;
};

type ChatRefPickerProps = {
  hostRef: RefObject<HTMLElement | null>;
  input: string;
  setInput: (value: SetStateAction<string>) => void;
  setCaretIndex?: (idx: number) => void;
};

export const ChatRefPicker = forwardRef<ChatRefPickerHandle, ChatRefPickerProps>(function ChatRefPicker(
  { hostRef, input, setInput, setCaretIndex },
  ref
) {
  const { blocks, listRemote } = useEditor();

  const [refOpen, setRefOpen] = useState<boolean>(false);
  const [refResultsOpen, setRefResultsOpen] = useState<boolean>(false);
  const [refResultsType, setRefResultsType] = useState<'this-blocks' | 'documents' | 'doc-blocks'>('this-blocks');
  const [refDocs, setRefDocs] = useState<DocSummary[] | null>(null);
  const [refLoading, setRefLoading] = useState<boolean>(false);
  const [refError, setRefError] = useState<string>('');
  const [refDocContext, setRefDocContext] = useState<DocSummary | null>(null);
  const [refBlocks, setRefBlocks] = useState<Block[] | null>(null);
  const [refAnchorIndex, setRefAnchorIndex] = useState<number>(-1);
  const [editingExisting, setEditingExisting] = useState<boolean>(false);
  // Separate selection indices to avoid left menu highlighting when navigating results
  const [menuIndex, setMenuIndex] = useState<number>(0);
  const [resultsIndex, setResultsIndex] = useState<number>(0);
  const [navigationStack, setNavigationStack] = useState<Array<{type: 'main' | 'documents' | 'doc-blocks' | 'this-blocks', data?: any}>>([{type: 'main'}]);
  const refMenuRef = useRef<HTMLDivElement | null>(null);
  const refResultsRef = useRef<HTMLDivElement | null>(null);
  const [refResultsLeft, setRefResultsLeft] = useState<number>(268);

  const measureResultsLeft = () => {
    const menu = refMenuRef.current;
    const wrapper = hostRef.current?.closest('.chat-textarea-wrap') as HTMLElement | null;
    if (!menu || !wrapper) {
      setRefResultsLeft(268);
      return;
    }

    const menuWidth = menu.offsetWidth;
    const wrapperWidth = wrapper.offsetWidth;
    const isSmallScreen = window.innerWidth <= 980;
    const resultsWidth = isSmallScreen ? 280 : 340;
    const gap = 8;

    const rightPos = menuWidth + gap;
    if (rightPos + resultsWidth <= wrapperWidth) {
      setRefResultsLeft(rightPos);
    } else {
      const leftPos = -resultsWidth - gap;
      setRefResultsLeft(Math.max(leftPos, -wrapperWidth + 20));
    }
  };

  const openRefMenu = (anchorIndex: number, opts?: { editing?: boolean }) => {
    setRefAnchorIndex(anchorIndex);
    setRefDocs(null);
    setRefBlocks(null);
    setRefDocContext(null);
    setRefError('');
    setRefResultsOpen(false);
    setMenuIndex(0);
    setResultsIndex(0);
    setNavigationStack([{type: 'main'}]);
    setEditingExisting(!!opts?.editing);
    requestAnimationFrame(measureResultsLeft);
    setRefOpen(true);
  };

  const closeRefMenu = () => {
    setRefOpen(false);
    setRefResultsOpen(false);
    setRefLoading(false);
    setRefError('');
    setMenuIndex(0);
    setResultsIndex(0);
    setNavigationStack([{type: 'main'}]);
    setEditingExisting(false);
  };

  const navigateBack = () => {
    if (navigationStack.length > 1) {
      const newStack = navigationStack.slice(0, -1);
      setNavigationStack(newStack);
      setResultsIndex(0);
      
      const prevLevel = newStack[newStack.length - 1];
      if (prevLevel.type === 'main') {
        setRefResultsOpen(false);
      } else if (prevLevel.type === 'documents') {
        setRefResultsType('documents');
        setRefResultsOpen(true);
      }
    }
  };

  useImperativeHandle(ref, () => ({
    openAt: openRefMenu,
    close: closeRefMenu,
  }), []);

  const insertAtHash = (textToInsert: string) => {
    // hostRef is a contenteditable div; we no longer need DOM selection values here
    const start = Math.max(0, refAnchorIndex);
    let end = Math.min(input.length, start + 1);
    if (editingExisting) {
      const after = input.slice(start);
      const m = after.match(/^#(?:doc\/[A-Za-z0-9_-]+(?:\/[A-Za-z0-9_-]+)?|this\/[A-Za-z0-9_-]+)/);
      if (m) end = start + m[0].length;
    }
    const before = input.slice(0, start);
    const after = input.slice(end);
    const next = `${before}${textToInsert} ${after}`;
    setInput(next);
    requestAnimationFrame(() => {
      const caretPos = (before + textToInsert + ' ').length;
      if (typeof (setCaretIndex as any) === 'function') setCaretIndex!(caretPos);
    });
    closeRefMenu();
  };

  const insertDocumentReference = (doc: DocSummary) => {
    insertAtHash(`#doc/${doc._id}`);
  };

  const labelForBlock = (b: Block, index: number): string => {
    if (b.type === 'heading') return `Heading ${b.level}`;
    if (b.type === 'divider') return `Divider ${index + 1}`;
    const tmp = document.createElement('div');
    tmp.innerHTML = (b as any).html || '';
    const txt = (tmp.textContent || '').trim();
    return txt ? (txt.length > 60 ? txt.slice(0, 57) + '…' : txt) : `Paragraph ${index + 1}`;
  };

  const onSelectThis = () => {
    setRefResultsType('this-blocks');
    setRefBlocks(blocks.slice());
    setNavigationStack(prev => [...prev, {type: 'this-blocks'}]);
    setResultsIndex(0);
    setRefResultsOpen(true);
  };

  const onSelectDocuments = async () => {
    setRefResultsType('documents');
    setRefLoading(true);
    setRefError('');
    setResultsIndex(0);
    try {
      const { documents } = await listRemote(1, 10);
      const docs: DocSummary[] = (documents || []).map((d: any) => ({ _id: d._id, name: d.name }));
      setRefDocs(docs);
      setNavigationStack(prev => [...prev, {type: 'documents', data: docs}]);
    } catch (e: any) {
      setRefError(e?.message || 'Failed to load documents');
    } finally {
      setRefLoading(false);
    }
    setRefResultsOpen(true);
  };

  const onOpenDocBlocks = async (doc: DocSummary) => {
    setRefDocContext(doc);
    setRefResultsType('doc-blocks');
    setRefLoading(true);
    setRefError('');
    setResultsIndex(0);
    try {
      const loaded = await apiLoadDocument(doc._id);
      const loadedBlocks = (loaded?.blocks as Block[]) || [];
      setRefBlocks(loadedBlocks);
      setNavigationStack(prev => [...prev, {type: 'doc-blocks', data: {doc, blocks: loadedBlocks}}]);
    } catch (e: any) {
      setRefError(e?.message || 'Failed to load document');
    } finally {
      setRefLoading(false);
    }
    setRefResultsOpen(true);
  };

  const onPickBlock = (source: 'this' | 'doc', block: Block) => {
    if (source === 'this') {
      insertAtHash(`#this/${block.id}`);
    } else {
      const docId = refDocContext?._id || 'unknown';
      insertAtHash(`#doc/${docId}/${block.id}`);
    }
  };

  useEffect(() => {
    if (!refOpen && !refResultsOpen) return;
    const onClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement | null;
      const insideMenu = !!refMenuRef.current && !!target && refMenuRef.current.contains(target);
      const insideResults = !!refResultsRef.current && !!target && refResultsRef.current.contains(target);
      const isHost = !!hostRef.current && !!target && hostRef.current.contains(target as any);
      if (!insideMenu && !insideResults && !isHost) closeRefMenu();
    };
    
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { 
        closeRefMenu(); 
        return;
      }
      
      // Handle keyboard navigation
      if (!refOpen && !refResultsOpen) return;
      
      let maxIndex = 0;
      
      if (refOpen && !refResultsOpen) {
        maxIndex = 1; // 'this' and 'documents' options
      } else if (refResultsOpen) {
        if (refResultsType === 'documents') {
          maxIndex = (refDocs?.length || 0) - 1;
        } else if (refResultsType === 'this-blocks' || refResultsType === 'doc-blocks') {
          maxIndex = (refBlocks?.length || 0) - 1;
        }
      }
      
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        if (refOpen && !refResultsOpen) {
          setMenuIndex(prev => Math.min(prev + 1, maxIndex));
        } else if (refResultsOpen) {
          setResultsIndex(prev => Math.min(prev + 1, maxIndex));
        }
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        if (refOpen && !refResultsOpen) {
          setMenuIndex(prev => Math.max(prev - 1, 0));
        } else if (refResultsOpen) {
          setResultsIndex(prev => Math.max(prev - 1, 0));
        }
      } else if (e.key === 'Enter') {
        e.preventDefault();
        handleEnterKey();
      } else if (e.key === 'ArrowLeft' && navigationStack.length > 1) {
        e.preventDefault();
        navigateBack();
      }
    };
    
    document.addEventListener('mousedown', onClick);
    document.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('mousedown', onClick);
      document.removeEventListener('keydown', onKey, true);
    };
  }, [refOpen, refResultsOpen, hostRef, menuIndex, resultsIndex, navigationStack, refResultsType, refDocs, refBlocks]);

  // Close the picker unless the caret is immediately after a trailing '#'
  useEffect(() => {
    if (!refOpen && !refResultsOpen) return;
    const shouldStayOpen = input.endsWith('#');
    if (!shouldStayOpen) closeRefMenu();
  }, [refOpen, refResultsOpen, input]);

  const handleEnterKey = () => {
    if (refOpen && !refResultsOpen) {
      // Main menu
      if (menuIndex === 0) {
        onSelectThis();
      } else if (menuIndex === 1) {
        onSelectDocuments();
      }
    } else if (refResultsOpen) {
      if (refResultsType === 'documents' && refDocs) {
        const doc = refDocs[resultsIndex];
        if (doc) onOpenDocBlocks(doc);
      } else if ((refResultsType === 'this-blocks' || refResultsType === 'doc-blocks') && refBlocks) {
        const block = refBlocks[resultsIndex];
        if (block) {
          onPickBlock(refResultsType === 'this-blocks' ? 'this' : 'doc', block);
        }
      }
    }
  };

  useEffect(() => {
    const on = () => requestAnimationFrame(measureResultsLeft);
    on();
    window.addEventListener('resize', on);
    return () => window.removeEventListener('resize', on);
  }, [refOpen, refResultsOpen]);

  return (
    <>
      {refOpen && (
        <div 
          ref={refMenuRef} 
          className="chat-ref-menu absolute bottom-full mb-1 left-0 z-50 bg-popover border border-border rounded-lg shadow-lg min-w-[220px]" 
          role="menu"
        >
          <div className="p-2">
            <div className="text-xs font-semibold text-muted-foreground mb-2 px-2">References</div>
            <div className="space-y-0.5">
              <button 
                className={cn(
                  "w-full flex flex-col items-start px-2 py-1.5 rounded text-left",
                  "hover:bg-accent transition-colors",
                  menuIndex === 0 && "bg-accent"
                )}
                onMouseDown={(e) => e.preventDefault()} 
                onClick={onSelectThis}
                onMouseEnter={() => setMenuIndex(0)}
              >
                <span className="text-sm font-medium">this</span>
                <span className="text-xs text-muted-foreground">Reference current document</span>
              </button>
              <button 
                className={cn(
                  "w-full flex flex-col items-start px-2 py-1.5 rounded text-left",
                  "hover:bg-accent transition-colors",
                  menuIndex === 1 && "bg-accent"
                )}
                onMouseDown={(e) => e.preventDefault()} 
                onClick={onSelectDocuments}
                onMouseEnter={() => setMenuIndex(1)}
              >
                <span className="text-sm font-medium">documents</span>
                <span className="text-xs text-muted-foreground">Reference another document</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {refResultsOpen && (
        <div 
          ref={refResultsRef} 
          className="chat-ref-results absolute bottom-full mb-1 z-50 bg-popover border border-border rounded-lg shadow-lg min-w-[280px] max-w-[340px]" 
          style={{ left: refResultsLeft }} 
          role="menu"
        >
          <div className="p-2">
            {navigationStack.length > 1 && (
              <div className="mb-2">
                <button 
                  className="text-xs text-muted-foreground hover:text-foreground transition-colors" 
                  onClick={navigateBack}
                  onMouseDown={(e) => e.preventDefault()}
                  title="Go back"
                >
                  ← Back
                </button>
              </div>
            )}
            {refResultsType === 'documents' && (
              <>
                <div className="text-xs font-semibold text-muted-foreground mb-2 px-2">Documents</div>
                {refLoading && <div className="text-sm text-muted-foreground px-2 py-4 text-center">Loading documents…</div>}
                {refError && <div className="text-sm text-destructive px-2">{refError}</div>}
                {!refLoading && !refError && (
                  <div className="space-y-0.5">
                    {(refDocs || []).map((d, idx) => (
                      <div key={d._id} className="flex items-center gap-1">
                        <button 
                          className={cn(
                            "flex-1 flex flex-col items-start px-2 py-1.5 rounded text-left",
                            "hover:bg-accent transition-colors",
                            resultsIndex === idx && "bg-accent"
                          )}
                          onMouseDown={(e) => e.preventDefault()} 
                          onClick={() => insertDocumentReference(d)}
                          onMouseEnter={() => setResultsIndex(idx)}
                          title="Select this document"
                        >
                          <span className="text-sm font-medium truncate max-w-[200px]">{d.name || d._id}</span>
                          <span className="text-xs text-muted-foreground truncate max-w-[200px]">{d._id}</span>
                        </button>
                        <button 
                          className="px-2 py-1 text-muted-foreground hover:text-foreground hover:bg-accent rounded transition-colors" 
                          onMouseDown={(e) => e.preventDefault()} 
                          onClick={() => onOpenDocBlocks(d)}
                          title="Explore document blocks"
                        >
                          →
                        </button>
                      </div>
                    ))}
                    {(!refDocs || refDocs.length === 0) && <div className="text-sm text-muted-foreground px-2 py-4 text-center">No documents</div>}
                  </div>
                )}
              </>
            )}

            {(refResultsType === 'this-blocks' || refResultsType === 'doc-blocks') && (
              <>
                <div className="text-xs font-semibold text-muted-foreground mb-2 px-2">
                  {refResultsType === 'this-blocks' ? 'This document blocks' : `Blocks: ${refDocContext?.name || refDocContext?._id || ''}`}
                </div>
                {refLoading && <div className="text-sm text-muted-foreground px-2 py-4 text-center">Loading blocks…</div>}
                {refError && <div className="text-sm text-destructive px-2">{refError}</div>}
                {!refLoading && !refError && (
                  <div className="space-y-0.5 max-h-[200px] overflow-auto">
                    {(refBlocks || []).map((b, idx) => (
                      <button
                        key={b.id}
                        className={cn(
                          "w-full flex flex-col items-start px-2 py-1.5 rounded text-left",
                          "hover:bg-accent transition-colors",
                          resultsIndex === idx && "bg-accent"
                        )}
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={() => onPickBlock(refResultsType === 'this-blocks' ? 'this' : 'doc', b)}
                        onMouseEnter={() => setResultsIndex(idx)}
                      >
                        <span className="text-sm truncate max-w-full">{labelForBlock(b, idx)}</span>
                        <span className="text-xs text-muted-foreground">{b.type}</span>
                      </button>
                    ))}
                    {(!refBlocks || refBlocks.length === 0) && <div className="text-sm text-muted-foreground px-2 py-4 text-center">No blocks</div>}
                  </div>
                )}
              </>
            )}
          </div>
          <div className="border-t border-border px-2 py-1.5">
            <div className="flex items-center gap-3 text-[10px] text-muted-foreground">
              <span>↑↓ Navigate</span>
              <span>← Back</span>
              <span>Enter Select</span>
              <span>Esc Close</span>
            </div>
          </div>
        </div>
      )}
    </>
  );
});


