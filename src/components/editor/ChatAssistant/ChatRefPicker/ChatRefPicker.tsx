import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { cn } from '@/lib/utils';
import { Spinner } from '@/components/ui/spinner';
import type { SetStateAction } from 'react';
import { useEditor } from '../../../../editor';
import type { Block } from '../../../../editor';
import { loadDocument as apiLoadDocument } from '../../../../services';
import type { DocumentSummary } from '../../../../services';
import { errorMessage } from '../../../../services';

type DocSummary = { _id: string; name?: string };
type NavigationLevel = { type: 'main' | 'documents' | 'doc-blocks' | 'this-blocks' };

/* Only one picker is ever mounted (it belongs to the single composer), so
   fixed ids are safe and keep the activedescendant wiring readable. */
const MENU_LIST_ID = 'chat-ref-menu';
const RESULTS_LIST_ID = 'chat-ref-results';

const optionId = (listId: string, index: number) => `${listId}-option-${index}`;

/** Loading states here were bare text while every other panel used `Spinner`. */
function LoadingRow({ label }: { label: string }) {
  return (
    <div
      role="status"
      className="flex items-center justify-center gap-2 px-2 py-4 text-sm text-muted-foreground"
    >
      <Spinner />
      {label}
    </div>
  );
}

function toDocSummary(document: DocumentSummary): DocSummary | null {
  const id = String(document._id ?? document.id ?? document.document_id ?? '');
  if (!id) return null;
  const name =
    (typeof document.name === 'string' && document.name) ||
    (typeof document.title === 'string' && document.title) ||
    undefined;
  return { _id: id, name };
}

export type ChatRefPickerHandle = {
  openAt: (anchorIndex: number, opts?: { editing?: boolean }) => void;
  close: () => void;
};

type ChatRefPickerProps = {
  getHost: () => HTMLElement | null;
  input: string;
  setInput: (value: SetStateAction<string>) => void;
  setCaretIndex?: (idx: number) => void;
};

export const ChatRefPicker = forwardRef<ChatRefPickerHandle, ChatRefPickerProps>(function ChatRefPicker(
  { getHost, input, setInput, setCaretIndex },
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
  const [navigationStack, setNavigationStack] = useState<NavigationLevel[]>([{type: 'main'}]);
  const refMenuRef = useRef<HTMLDivElement | null>(null);
  const refResultsRef = useRef<HTMLDivElement | null>(null);
  const [refResultsLeft, setRefResultsLeft] = useState<number>(268);

  const measureResultsLeft = useCallback(() => {
    const menu = refMenuRef.current;
    const wrapper = getHost()?.closest('.chat-textarea-wrap') as HTMLElement | null;
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
  }, [getHost]);

  const openRefMenu = useCallback((anchorIndex: number, opts?: { editing?: boolean }) => {
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
  }, [measureResultsLeft]);

  const closeRefMenu = useCallback(() => {
    setRefOpen(false);
    setRefResultsOpen(false);
    setRefLoading(false);
    setRefError('');
    setMenuIndex(0);
    setResultsIndex(0);
    setNavigationStack([{type: 'main'}]);
    setEditingExisting(false);
  }, []);

  const navigateBack = useCallback(() => {
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
  }, [navigationStack]);

  useImperativeHandle(ref, () => ({
    openAt: openRefMenu,
    close: closeRefMenu,
  }), [closeRefMenu, openRefMenu]);

  const insertAtHash = useCallback((textToInsert: string) => {
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
      setCaretIndex?.(caretPos);
    });
    closeRefMenu();
  }, [closeRefMenu, editingExisting, input, refAnchorIndex, setCaretIndex, setInput]);

  const insertDocumentReference = useCallback((doc: DocSummary) => {
    insertAtHash(`#doc/${doc._id}`);
  }, [insertAtHash]);

  const labelForBlock = (b: Block, index: number): string => {
    if (b.type === 'heading') return `Heading ${b.level}`;
    if (b.type === 'divider') return `Divider ${index + 1}`;
    const tmp = document.createElement('div');
    tmp.innerHTML = b.html || '';
    const txt = (tmp.textContent || '').trim();
    return txt ? (txt.length > 60 ? txt.slice(0, 57) + '…' : txt) : `Paragraph ${index + 1}`;
  };

  const onSelectThis = useCallback(() => {
    setRefResultsType('this-blocks');
    setRefBlocks(blocks.slice());
    setNavigationStack(prev => [...prev, { type: 'this-blocks' }]);
    setResultsIndex(0);
    setRefResultsOpen(true);
  }, [blocks]);

  const onSelectDocuments = useCallback(async () => {
    setRefResultsType('documents');
    setRefLoading(true);
    setRefError('');
    setResultsIndex(0);
    try {
      const { documents } = await listRemote(1, 10);
      const docs = documents.map(toDocSummary).filter((doc): doc is DocSummary => doc !== null);
      setRefDocs(docs);
      setNavigationStack(prev => [...prev, { type: 'documents' }]);
    } catch (error: unknown) {
      setRefError(errorMessage(error, 'Failed to load documents'));
    } finally {
      setRefLoading(false);
    }
    setRefResultsOpen(true);
  }, [listRemote]);

  const onOpenDocBlocks = useCallback(async (doc: DocSummary) => {
    setRefDocContext(doc);
    setRefResultsType('doc-blocks');
    setRefLoading(true);
    setRefError('');
    setResultsIndex(0);
    try {
      const loaded = await apiLoadDocument(doc._id);
      const loadedBlocks = loaded.blocks;
      setRefBlocks(loadedBlocks);
      setNavigationStack(prev => [...prev, { type: 'doc-blocks' }]);
    } catch (error: unknown) {
      setRefError(errorMessage(error, 'Failed to load document'));
    } finally {
      setRefLoading(false);
    }
    setRefResultsOpen(true);
  }, []);

  const onPickBlock = useCallback((source: 'this' | 'doc', block: Block) => {
    if (source === 'this') {
      insertAtHash(`#this/${block.id}`);
    } else {
      const docId = refDocContext?._id || 'unknown';
      insertAtHash(`#doc/${docId}/${block.id}`);
    }
  }, [insertAtHash, refDocContext]);

  const handleEnterKey = useCallback(() => {
    if (refOpen && !refResultsOpen) {
      if (menuIndex === 0) {
        onSelectThis();
      } else if (menuIndex === 1) {
        void onSelectDocuments();
      }
    } else if (refResultsOpen) {
      if (refResultsType === 'documents' && refDocs) {
        const doc = refDocs[resultsIndex];
        if (doc) void onOpenDocBlocks(doc);
      } else if ((refResultsType === 'this-blocks' || refResultsType === 'doc-blocks') && refBlocks) {
        const block = refBlocks[resultsIndex];
        if (block) {
          onPickBlock(refResultsType === 'this-blocks' ? 'this' : 'doc', block);
        }
      }
    }
  }, [
    menuIndex,
    onOpenDocBlocks,
    onPickBlock,
    onSelectDocuments,
    onSelectThis,
    refBlocks,
    refDocs,
    refOpen,
    refResultsOpen,
    refResultsType,
    resultsIndex,
  ]);

  useEffect(() => {
    if (!refOpen && !refResultsOpen) return;
    const onClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement | null;
      const insideMenu = !!refMenuRef.current && !!target && refMenuRef.current.contains(target);
      const insideResults = !!refResultsRef.current && !!target && refResultsRef.current.contains(target);
      const host = getHost();
      const isHost = !!host && !!target && host.contains(target);
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
  }, [
    closeRefMenu,
    handleEnterKey,
    getHost,
    navigateBack,
    navigationStack.length,
    refBlocks,
    refDocs,
    refOpen,
    refResultsOpen,
    refResultsType,
  ]);

  // Close the picker unless the caret is immediately after a trailing '#'.
  // Adjusted during render rather than in an effect: this reacts to the
  // composer's text, not to an external system, and `closeRefMenu` only resets
  // state — so React re-renders before committing instead of painting the
  // stale-open picker for a frame and then cascading a second render.
  // The guard converges: `closeRefMenu` clears both open flags.
  if ((refOpen || refResultsOpen) && !input.endsWith('#')) {
    closeRefMenu();
  }

  useEffect(() => {
    const on = () => requestAnimationFrame(measureResultsLeft);
    on();
    window.addEventListener('resize', on);
    return () => window.removeEventListener('resize', on);
  }, [measureResultsLeft, refOpen, refResultsOpen]);

  /**
   * Announce the highlighted option through the composer.
   *
   * Arrow keys move a purely visual highlight while DOM focus stays in the
   * text field, so without `aria-activedescendant` none of this navigation
   * existed for a screen reader. The attributes are set imperatively because
   * the composer element belongs to `ChatTaggedInput`, not to this component.
   */
  useEffect(() => {
    const host = getHost();
    if (!host) return;

    const open = refOpen || refResultsOpen;
    if (!open) {
      host.removeAttribute('aria-expanded');
      host.removeAttribute('aria-controls');
      host.removeAttribute('aria-activedescendant');
      return;
    }

    host.setAttribute('aria-expanded', 'true');
    host.setAttribute('aria-controls', refResultsOpen ? RESULTS_LIST_ID : MENU_LIST_ID);
    host.setAttribute(
      'aria-activedescendant',
      refResultsOpen ? optionId(RESULTS_LIST_ID, resultsIndex) : optionId(MENU_LIST_ID, menuIndex),
    );

    return () => {
      host.removeAttribute('aria-expanded');
      host.removeAttribute('aria-controls');
      host.removeAttribute('aria-activedescendant');
    };
  }, [getHost, menuIndex, refOpen, refResultsOpen, resultsIndex]);

  return (
    <>
      {refOpen && (
        <div
          ref={refMenuRef}
          className="chat-ref-menu absolute bottom-full mb-1 left-0 z-[var(--z-dropdown)] bg-popover border border-border rounded-lg shadow-lg min-w-[220px]"
        >
          <div className="p-2">
            <div id={`${MENU_LIST_ID}-label`} className="text-xs font-semibold text-muted-foreground mb-2 px-2">
              References
            </div>
            {/* `listbox`, not `menu`: the highlight is virtual and focus stays
                in the composer, which is the listbox pattern. `role="menu"`
                also requires `menuitem` children, which these never were. */}
            <div
              id={MENU_LIST_ID}
              role="listbox"
              aria-labelledby={`${MENU_LIST_ID}-label`}
              className="space-y-0.5"
            >
              <button
                id={optionId(MENU_LIST_ID, 0)}
                role="option"
                aria-selected={menuIndex === 0}
                className={cn(
                  "w-full flex flex-col items-start px-2 py-1.5 rounded-sm text-left",
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
                id={optionId(MENU_LIST_ID, 1)}
                role="option"
                aria-selected={menuIndex === 1}
                className={cn(
                  "w-full flex flex-col items-start px-2 py-1.5 rounded-sm text-left",
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
          className="chat-ref-results absolute bottom-full mb-1 z-[var(--z-dropdown)] bg-popover border border-border rounded-lg shadow-lg min-w-[280px] max-w-[340px]"
          style={{ left: refResultsLeft }}
        >
          <div className="p-2">
            {navigationStack.length > 1 && (
              <div className="mb-2">
                <button
                  className="text-xs text-muted-foreground hover:text-foreground transition-colors"
                  onClick={navigateBack}
                  onMouseDown={(e) => e.preventDefault()}
                  aria-label="Back to the previous list"
                  title="Go back"
                >
                  ← Back
                </button>
              </div>
            )}
            {refResultsType === 'documents' && (
              <>
                <div id={`${RESULTS_LIST_ID}-label`} className="text-xs font-semibold text-muted-foreground mb-2 px-2">
                  Documents
                </div>
                {refLoading && <LoadingRow label="Loading documents…" />}
                {refError && <div role="alert" className="text-sm text-destructive px-2">{refError}</div>}
                {!refLoading && !refError && (
                  <div
                    id={RESULTS_LIST_ID}
                    role="listbox"
                    aria-labelledby={`${RESULTS_LIST_ID}-label`}
                    className="space-y-0.5"
                  >
                    {(refDocs || []).map((d, idx) => (
                      <div key={d._id} className="flex items-center gap-1">
                        <button
                          id={optionId(RESULTS_LIST_ID, idx)}
                          role="option"
                          aria-selected={resultsIndex === idx}
                          className={cn(
                            "flex-1 flex flex-col items-start px-2 py-1.5 rounded-sm text-left",
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
                          className="px-2 py-1 text-muted-foreground hover:text-foreground hover:bg-accent rounded-sm transition-colors"
                          onMouseDown={(e) => e.preventDefault()}
                          onClick={() => onOpenDocBlocks(d)}
                          aria-label={`Explore blocks in ${d.name || d._id}`}
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
                <div id={`${RESULTS_LIST_ID}-label`} className="text-xs font-semibold text-muted-foreground mb-2 px-2">
                  {refResultsType === 'this-blocks' ? 'This document blocks' : `Blocks: ${refDocContext?.name || refDocContext?._id || ''}`}
                </div>
                {refLoading && <LoadingRow label="Loading blocks…" />}
                {refError && <div role="alert" className="text-sm text-destructive px-2">{refError}</div>}
                {!refLoading && !refError && (
                  <div
                    id={RESULTS_LIST_ID}
                    role="listbox"
                    aria-labelledby={`${RESULTS_LIST_ID}-label`}
                    className="space-y-0.5 max-h-[200px] overflow-auto"
                  >
                    {(refBlocks || []).map((b, idx) => (
                      <button
                        key={b.id}
                        id={optionId(RESULTS_LIST_ID, idx)}
                        role="option"
                        aria-selected={resultsIndex === idx}
                        className={cn(
                          "w-full flex flex-col items-start px-2 py-1.5 rounded-sm text-left",
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
            <div className="flex items-center gap-3 text-2xs text-muted-foreground">
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
