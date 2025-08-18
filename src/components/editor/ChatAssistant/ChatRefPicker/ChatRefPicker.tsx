import './ChatRefPicker.css';
import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import type { RefObject, SetStateAction } from 'react';
import { useEditor } from '../../../../editor';
import type { Block } from '../../../../editor';
import { loadDocument as apiLoadDocument } from '../../../../services';

type DocSummary = { _id: string; name?: string };

export type ChatRefPickerHandle = {
  openAt: (anchorIndex: number) => void;
  close: () => void;
};

type ChatRefPickerProps = {
  textareaRef: RefObject<HTMLTextAreaElement | null>;
  input: string;
  setInput: (value: SetStateAction<string>) => void;
};

export const ChatRefPicker = forwardRef<ChatRefPickerHandle, ChatRefPickerProps>(function ChatRefPicker(
  { textareaRef, input, setInput },
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
  // Separate selection indices to avoid left menu highlighting when navigating results
  const [menuIndex, setMenuIndex] = useState<number>(0);
  const [resultsIndex, setResultsIndex] = useState<number>(0);
  const [navigationStack, setNavigationStack] = useState<Array<{type: 'main' | 'documents' | 'doc-blocks' | 'this-blocks', data?: any}>>([{type: 'main'}]);
  const refMenuRef = useRef<HTMLDivElement | null>(null);
  const refResultsRef = useRef<HTMLDivElement | null>(null);
  const [refResultsLeft, setRefResultsLeft] = useState<number>(268);

  const measureResultsLeft = () => {
    const menu = refMenuRef.current;
    const wrapper = textareaRef.current?.closest('.chat-textarea-wrap') as HTMLElement | null;
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

  const openRefMenu = (anchorIndex: number) => {
    setRefAnchorIndex(anchorIndex);
    setRefDocs(null);
    setRefBlocks(null);
    setRefDocContext(null);
    setRefError('');
    setRefResultsOpen(false);
    setMenuIndex(0);
    setResultsIndex(0);
    setNavigationStack([{type: 'main'}]);
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
    const el = textareaRef.current;
    const start = Math.max(0, refAnchorIndex);
    const end = Math.min(input.length, start + 1);
    const before = input.slice(0, start);
    const after = input.slice(end);
    const next = `${before}${textToInsert} ${after}`;
    setInput(next);
    requestAnimationFrame(() => {
      if (!el) return;
      const caretPos = (before + textToInsert + ' ').length;
      el.selectionStart = el.selectionEnd = caretPos;
      el.focus();
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
      const isTextArea = !!textareaRef.current && !!target && textareaRef.current.contains(target as any);
      if (!insideMenu && !insideResults && !isTextArea) closeRefMenu();
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
  }, [refOpen, refResultsOpen, textareaRef, menuIndex, resultsIndex, navigationStack, refResultsType, refDocs, refBlocks]);

  // Close the picker unless the caret is immediately after a trailing '#'
  useEffect(() => {
    if (!refOpen && !refResultsOpen) return;
    const el = textareaRef.current;
    const check = () => {
      const textarea = textareaRef.current;
      if (!textarea) { closeRefMenu(); return; }
      const caret = textarea.selectionStart ?? 0;
      const shouldStayOpen = caret === input.length && input.endsWith('#');
      if (!shouldStayOpen) closeRefMenu();
    };
    // Run once on mount and whenever input changes
    check();
    // Also react to caret/selection changes while open
    const textarea = el;
    if (textarea) {
      textarea.addEventListener('keyup', check);
      textarea.addEventListener('mouseup', check);
      textarea.addEventListener('input', check);
    }
    const onSelectionChange = () => {
      if (document.activeElement === textareaRef.current) check();
    };
    document.addEventListener('selectionchange', onSelectionChange);
    return () => {
      if (textarea) {
        textarea.removeEventListener('keyup', check);
        textarea.removeEventListener('mouseup', check);
        textarea.removeEventListener('input', check);
      }
      document.removeEventListener('selectionchange', onSelectionChange);
    };
  }, [refOpen, refResultsOpen, input, textareaRef]);

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
        <div ref={refMenuRef} className="chat-ref-menu" role="menu">
          <div className="ref-section">
            <div className="ref-title">References</div>
            <div className="ref-items">
              <button 
                className={`ref-item ${menuIndex === 0 ? 'selected' : ''}`} 
                onMouseDown={(e) => e.preventDefault()} 
                onClick={onSelectThis}
                onMouseEnter={() => setMenuIndex(0)}
              >
                <span className="ref-item-title">this</span>
                <span className="ref-item-desc">Reference current document</span>
              </button>
              <button 
                className={`ref-item ${menuIndex === 1 ? 'selected' : ''}`} 
                onMouseDown={(e) => e.preventDefault()} 
                onClick={onSelectDocuments}
                onMouseEnter={() => setMenuIndex(1)}
              >
                <span className="ref-item-title">documents</span>
                <span className="ref-item-desc">Reference another document</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {refResultsOpen && (
        <div ref={refResultsRef} className="chat-ref-results" style={{ left: refResultsLeft }} role="menu">
          <div className="ref-section">
            {navigationStack.length > 1 && (
              <div className="ref-header">
                <button 
                  className="ref-back-btn" 
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
                <div className="ref-title">Documents</div>
                {refLoading && <div className="ref-loading">Loading documents…</div>}
                {refError && <div className="ref-error">{refError}</div>}
                {!refLoading && !refError && (
                  <div className="ref-list">
                    {(refDocs || []).map((d, idx) => (
                      <div key={d._id} className="ref-item-wrapper">
                        <button 
                          className={`ref-item ${resultsIndex === idx ? 'selected' : ''}`} 
                          onMouseDown={(e) => e.preventDefault()} 
                          onClick={() => insertDocumentReference(d)}
                          onMouseEnter={() => setResultsIndex(idx)}
                          title="Select this document"
                        >
                          <span className="ref-item-title">{d.name || d._id}</span>
                          <span className="ref-item-desc">{d._id}</span>
                        </button>
                        <button 
                          className="ref-item-action" 
                          onMouseDown={(e) => e.preventDefault()} 
                          onClick={() => onOpenDocBlocks(d)}
                          title="Explore document blocks"
                        >
                          →
                        </button>
                      </div>
                    ))}
                    {(!refDocs || refDocs.length === 0) && <div className="ref-empty">No documents</div>}
                  </div>
                )}
              </>
            )}

            {(refResultsType === 'this-blocks' || refResultsType === 'doc-blocks') && (
              <>
                <div className="ref-title">{refResultsType === 'this-blocks' ? 'This document blocks' : `Blocks: ${refDocContext?.name || refDocContext?._id || ''}`}</div>
                {refLoading && <div className="ref-loading">Loading blocks…</div>}
                {refError && <div className="ref-error">{refError}</div>}
                {!refLoading && !refError && (
                  <div className="ref-list scroll">
                    {(refBlocks || []).map((b, idx) => (
                      <button
                        key={b.id}
                        className={`ref-item ${resultsIndex === idx ? 'selected' : ''}`}
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={() => onPickBlock(refResultsType === 'this-blocks' ? 'this' : 'doc', b)}
                        onMouseEnter={() => setResultsIndex(idx)}
                      >
                        <span className="ref-item-title">{labelForBlock(b, idx)}</span>
                        <span className="ref-item-desc">{b.type}</span>
                      </button>
                    ))}
                    {(!refBlocks || refBlocks.length === 0) && <div className="ref-empty">No blocks</div>}
                  </div>
                )}
              </>
            )}
          </div>
          <div className="ref-footer">
            <div className="ref-hints">
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


