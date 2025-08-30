// Tailwind migration: inline utility classes; removed CSS import
import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
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
  const resultsItemRefs = useRef<HTMLButtonElement[]>([]);

  const measureResultsLeft = () => {
    const menu = refMenuRef.current;
    // Prefer the positioned ancestor of the floating menu; fallback to the host's parent
    const wrapper = (menu?.offsetParent as HTMLElement | null) || (hostRef.current?.parentElement as HTMLElement | null);
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
    if (opts?.editing) initializeForEditing(anchorIndex);
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

  // When editing an existing reference, detect its kind and pre-open the most relevant view
  const initializeForEditing = async (anchorIndex: number) => {
    try {
      const start = Math.max(0, anchorIndex);
      const after = input.slice(start);
      // Match in priority order: doc+block, this+block, doc only
      const m = after.match(/^#doc\/([A-Za-z0-9_-]+)\/([A-Za-z0-9_-]+)|^#this\/([A-Za-z0-9_-]+)|^#doc\/([A-Za-z0-9_-]+)/);
      if (!m) return;
      if (m[1] && m[2]) {
        // #doc/<docId>/<blockId> → open doc-blocks and select block
        const docId = m[1];
        const blockId = m[2];
        setRefDocContext({ _id: docId });
        setRefResultsType('doc-blocks');
        setRefLoading(true);
        setRefError('');
        setResultsIndex(0);
        try {
          const loaded = await apiLoadDocument(docId);
          const loadedBlocks = (loaded?.blocks as Block[]) || [];
          setRefBlocks(loadedBlocks);
          const idx = loadedBlocks.findIndex(b => b.id === blockId);
          if (idx >= 0) setResultsIndex(idx);
          setNavigationStack(prev => [...prev, { type: 'doc-blocks', data: { doc: { _id: docId }, blocks: loadedBlocks } }]);
        } catch (e: any) {
          setRefError(e?.message || 'Failed to load document');
        } finally {
          setRefLoading(false);
          setRefResultsOpen(true);
        }
      } else if (m[3]) {
        // #this/<blockId> → open this-blocks and select block
        const blockId = m[3];
        setRefResultsType('this-blocks');
        const bs = blocks.slice();
        setRefBlocks(bs);
        const idx = bs.findIndex(b => b.id === blockId);
        if (idx >= 0) setResultsIndex(idx);
        setNavigationStack(prev => [...prev, { type: 'this-blocks' }]);
        setRefResultsOpen(true);
      } else if (m[4]) {
        // #doc/<docId> → open documents and select doc
        const docId = m[4];
        setRefResultsType('documents');
        setRefLoading(true);
        setRefError('');
        setResultsIndex(0);
        try {
          // Query with docId to increase odds of inclusion
          const { documents } = await listRemote(1, 10, docId);
          const docs: DocSummary[] = (documents || []).map((d: any) => ({ _id: d._id, name: d.name }));
          setRefDocs(docs);
          const idx = docs.findIndex(d => d._id === docId);
          if (idx >= 0) setResultsIndex(idx);
          setNavigationStack(prev => [...prev, { type: 'documents', data: docs }]);
        } catch (e: any) {
          setRefError(e?.message || 'Failed to load documents');
        } finally {
          setRefLoading(false);
          setRefResultsOpen(true);
        }
      }
    } catch {}
  };

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
      
      // Compute selectable length and clamp index bounds to avoid negatives
      let itemsLength = 0;
      if (refOpen && !refResultsOpen) {
        itemsLength = 2; // 'this' and 'documents'
      } else if (refResultsOpen) {
        if (refResultsType === 'documents') itemsLength = refDocs?.length || 0;
        else if (refResultsType === 'this-blocks' || refResultsType === 'doc-blocks') itemsLength = refBlocks?.length || 0;
      }
      const maxIndex = Math.max(0, itemsLength - 1);
      
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        if (itemsLength === 0) return;
        if (refOpen && !refResultsOpen) setMenuIndex(prev => Math.min(prev + 1, maxIndex));
        else if (refResultsOpen) setResultsIndex(prev => Math.min(prev + 1, maxIndex));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        if (itemsLength === 0) return;
        if (refOpen && !refResultsOpen) setMenuIndex(prev => Math.max(prev - 1, 0));
        else if (refResultsOpen) setResultsIndex(prev => Math.max(prev - 1, 0));
      } else if (e.key === 'Enter') {
        e.preventDefault();
        handleEnterKey();
      } else if (e.key === 'ArrowLeft' && navigationStack.length > 1) {
        e.preventDefault();
        navigateBack();
      } else if (e.key === 'ArrowRight') {
        // Explore blocks for selected document
        if (refResultsOpen && refResultsType === 'documents' && refDocs && refDocs[resultsIndex]) {
          e.preventDefault();
          onOpenDocBlocks(refDocs[resultsIndex]);
        }
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
    // Keep open if editing an existing reference or when just typed '#'
    const shouldStayOpen = editingExisting || input.endsWith('#');
    if (!shouldStayOpen) closeRefMenu();
  }, [refOpen, refResultsOpen, input, editingExisting]);

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
        if (doc) insertDocumentReference(doc);
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

  // Reset and auto-scroll selected result into view as the user navigates
  useEffect(() => {
    resultsItemRefs.current = [];
  }, [refResultsType, refDocs, refBlocks]);

  useEffect(() => {
    if (!refResultsOpen) return;
    const el = resultsItemRefs.current[resultsIndex];
    if (el && typeof (el as any).scrollIntoView === 'function') {
      try { el.scrollIntoView({ block: 'nearest' }); } catch {}
    }
  }, [resultsIndex, refResultsOpen, refResultsType, refDocs, refBlocks]);

  return (
    <>
      {refOpen && (
        <div
          ref={refMenuRef}
          role="menu"
          className="absolute bottom-[calc(100%+8px)] left-0 min-w-[260px] max-w-[360px] max-h-[280px] overflow-hidden bg-[var(--color-card)] border border-[var(--color-border)] rounded-[var(--radius-md)] shadow-[var(--shadow-lg)] z-[110] animate-[fadeInUp_0.15s_ease-out]"
          style={{ animationName: undefined }}
        >
          <div className="flex flex-col">
            <div className="py-2 px-[10px] border-b border-[var(--color-border)] text-[var(--text-sm)] font-semibold bg-[var(--color-panel)]">References</div>
            <div className="grid grid-cols-1 gap-1 p-2">
              <button
                className={[
                  'flex flex-col items-start gap-[2px] w-full text-left py-2 px-[10px] rounded-[var(--radius-sm)] border border-transparent bg-transparent cursor-pointer transition-all duration-150',
                  'hover:bg-[var(--color-elev)] hover:border-[var(--color-border)] focus:outline focus:outline-2 focus:outline-[var(--color-accent)] focus:outline-offset-2',
                  menuIndex === 0 ? 'bg-[var(--color-accent)] text-[var(--color-accent-foreground)] border-[var(--color-accent)]' : '',
                ].filter(Boolean).join(' ')}
                onMouseDown={(e) => e.preventDefault()}
                onClick={onSelectThis}
                onMouseEnter={() => setMenuIndex(0)}
              >
                <span className="text-[var(--text-sm)] font-semibold">this</span>
                <span className={[
                  'text-[var(--text-xs)] text-[var(--color-muted)]',
                  menuIndex === 0 ? 'text-[var(--color-accent-foreground)] opacity-80' : '',
                ].filter(Boolean).join(' ')}>Reference current document</span>
              </button>
              <button
                className={[
                  'flex flex-col items-start gap-[2px] w-full text-left py-2 px-[10px] rounded-[var(--radius-sm)] border border-transparent bg-transparent cursor-pointer transition-all duration-150',
                  'hover:bg-[var(--color-elev)] hover:border-[var(--color-border)] focus:outline focus:outline-2 focus:outline-[var(--color-accent)] focus:outline-offset-2',
                  menuIndex === 1 ? 'bg-[var(--color-accent)] text-[var(--color-accent-foreground)] border-[var(--color-accent)]' : '',
                ].filter(Boolean).join(' ')}
                onMouseDown={(e) => e.preventDefault()}
                onClick={onSelectDocuments}
                onMouseEnter={() => setMenuIndex(1)}
              >
                <span className="text-[var(--text-sm)] font-semibold">documents</span>
                <span className={[
                  'text-[var(--text-xs)] text-[var(--color-muted)]',
                  menuIndex === 1 ? 'text-[var(--color-accent-foreground)] opacity-80' : '',
                ].filter(Boolean).join(' ')}>Reference another document</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {refResultsOpen && (
        <div
          ref={refResultsRef}
          role="menu"
          className="absolute bottom-[calc(100%+8px)] min-w-[340px] max-w-[560px] max-h-[360px] overflow-hidden bg-[var(--color-card)] border border-[var(--color-border)] rounded-[var(--radius-md)] shadow-[var(--shadow-lg)] z-[111] max-[980px]:min-w-[280px] max-[980px]:max-w-[320px]"
          style={{ left: refResultsLeft }}
        >
          <div className="flex flex-col">
            {navigationStack.length > 1 && (
              <div className="px-3 py-2 border-b border-[var(--color-border)] bg-[var(--color-panel)]">
                <button
                  className="inline-flex items-center gap-1 px-2 py-1 border border-[var(--color-border)] rounded-[var(--radius-sm)] bg-[var(--color-card)] text-[var(--color-muted)] text-[var(--text-xs)] transition-all duration-150 hover:bg-[var(--color-elev)] hover:text-[var(--color-text)] focus:outline focus:outline-2 focus:outline-[var(--color-accent)] focus:outline-offset-2"
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
                <div className="py-[10px] px-3 border-b border-[var(--color-border)] text-[var(--text-sm)] font-semibold bg-[var(--color-panel)]">Documents</div>
                {refLoading && (
                  <div className="flex items-center justify-center p-5 text-[var(--color-muted)] text-[var(--text-sm)]">
                    <span className="inline-block w-4 h-4 mr-2 border-2 border-[var(--color-border)] border-t-[var(--color-accent)] rounded-full animate-spin" />
                    Loading documents…
                  </div>
                )}
                {refError && <div className="p-3 text-[var(--text-sm)] text-[var(--color-danger)] text-center">{refError}</div>}
                {!refLoading && !refError && (
                  <div className="flex flex-col p-2 max-h-[280px] overflow-auto">
                    {(refDocs || []).map((d, idx) => (
                      <div key={d._id} className="flex items-stretch gap-[2px]">
                        <button
                          ref={(el) => { if (el) resultsItemRefs.current[idx] = el; }}
                          className={[
                            'flex flex-col items-start gap-[2px] flex-1 text-left py-2 px-[10px] rounded-[var(--radius-sm)] border border-transparent bg-transparent cursor-pointer transition-all duration-150',
                            'hover:bg-[var(--color-elev)] hover:border-[var(--color-border)] focus:outline focus:outline-2 focus:outline-[var(--color-accent)] focus:outline-offset-2',
                            resultsIndex === idx ? 'bg-[var(--color-accent)] text-[var(--color-accent-foreground)] border-[var(--color-accent)]' : '',
                          ].filter(Boolean).join(' ')}
                          onMouseDown={(e) => e.preventDefault()}
                          onClick={() => insertDocumentReference(d)}
                          onMouseEnter={() => setResultsIndex(idx)}
                          title="Select this document"
                        >
                          <span className="text-[var(--text-sm)] font-semibold">{d.name || d._id}</span>
                          <span className={[
                            'text-[var(--text-xs)] text-[var(--color-muted)]',
                            resultsIndex === idx ? 'text-[var(--color-accent-foreground)] opacity-80' : '',
                          ].filter(Boolean).join(' ')}>{d._id}</span>
                        </button>
                        <button
                          className="flex items-center justify-center w-8 px-1 py-2 border border-[var(--color-border)] rounded-[var(--radius-sm)] bg-[var(--color-card)] text-[var(--color-muted)] text-[var(--text-sm)] transition-all duration-150 hover:bg-[var(--color-accent)] hover:text-[var(--color-accent-foreground)] hover:border-[var(--color-accent)] focus:outline focus:outline-2 focus:outline-[var(--color-accent)] focus:outline-offset-2"
                          onMouseDown={(e) => e.preventDefault()}
                          onClick={() => onOpenDocBlocks(d)}
                          title="Explore document blocks"
                        >
                          →
                        </button>
                      </div>
                    ))}
                    {(!refDocs || refDocs.length === 0) && <div className="p-3 text-[var(--text-sm)] text-[var(--color-muted)] text-center">No documents</div>}
                  </div>
                )}
              </>
            )}

            {(refResultsType === 'this-blocks' || refResultsType === 'doc-blocks') && (
              <>
                <div className="py-[10px] px-3 border-b border-[var(--color-border)] text-[var(--text-sm)] font-semibold bg-[var(--color-panel)]">{refResultsType === 'this-blocks' ? 'This document blocks' : `Blocks: ${refDocContext?.name || refDocContext?._id || ''}`}</div>
                {refLoading && (
                  <div className="flex items-center justify-center p-5 text-[var(--color-muted)] text-[var(--text-sm)]">
                    <span className="inline-block w-4 h-4 mr-2 border-2 border-[var(--color-border)] border-t-[var(--color-accent)] rounded-full animate-spin" />
                    Loading blocks…
                  </div>
                )}
                {refError && <div className="p-3 text-[var(--text-sm)] text-[var(--color-danger)] text-center">{refError}</div>}
                {!refLoading && !refError && (
                  <div className="flex flex-col p-2 max-h-[300px] overflow-auto">
                    {(refBlocks || []).map((b, idx) => (
                      <button
                        key={b.id}
                        ref={(el) => { if (el) resultsItemRefs.current[idx] = el; }}
                        className={[
                          'flex flex-col items-start gap-[2px] w-full text-left py-2 px-[10px] rounded-[var(--radius-sm)] border border-transparent bg-transparent cursor-pointer transition-all duration-150',
                          'hover:bg-[var(--color-elev)] hover:border-[var(--color-border)] focus:outline focus:outline-2 focus:outline-[var(--color-accent)] focus:outline-offset-2',
                          resultsIndex === idx ? 'bg-[var(--color-accent)] text-[var(--color-accent-foreground)] border-[var(--color-accent)]' : '',
                        ].filter(Boolean).join(' ')}
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={() => onPickBlock(refResultsType === 'this-blocks' ? 'this' : 'doc', b)}
                        onMouseEnter={() => setResultsIndex(idx)}
                      >
                        <span className="text-[var(--text-sm)] font-semibold">{labelForBlock(b, idx)}</span>
                        <span className={[
                          'text-[var(--text-xs)] text-[var(--color-muted)]',
                          resultsIndex === idx ? 'text-[var(--color-accent-foreground)] opacity-80' : '',
                        ].filter(Boolean).join(' ')}>{b.type}</span>
                      </button>
                    ))}
                    {(!refBlocks || refBlocks.length === 0) && <div className="p-3 text-[var(--text-sm)] text-[var(--color-muted)] text-center">No blocks</div>}
                  </div>
                )}
              </>
            )}
          </div>
            <div className="flex gap-3 text-[var(--text-xs)] text-[var(--color-muted)] max-[980px]:flex-wrap max-[980px]:gap-2">
              <span className="flex items-center gap-[2px]">↑↓ Navigate</span>
              <span className="flex items-center gap-[2px]">← Back</span>
              <span className="flex items-center gap-[2px]">→ Explore blocks</span>
              <span className="flex items-center gap-[2px]">Enter Select</span>
              <span className="flex items-center gap-[2px]">Esc Close</span>
            </div>
        </div>
      )}
    </>
  );
});


