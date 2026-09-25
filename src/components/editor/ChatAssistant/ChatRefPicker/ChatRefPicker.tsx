import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import { cn } from '@/lib/utils';
import { Spinner } from '@/components/ui/spinner';
import { menuItem, menuLabel, menuSurface } from '@/components/ui/menuStyles';
import { ChevronLeft, ChevronRight, FileText, Files } from 'lucide-react';
import type { SetStateAction } from 'react';
import { useEditor } from '../../../../editor';
import type { Block } from '../../../../editor';
import { kindLabel } from '@/editor';
import { blockText } from '../../../../editor/proposals';
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

/** The keys the picker answers to, in the quiet voice of a menu footer. */
function PickerHints({ back, search }: { back: boolean; search?: boolean }) {
  return (
    <p className="-mx-1.5 -mb-1.5 mt-1.5 border-t border-border px-3 py-1.5 text-xs text-muted-foreground">
      {search ? 'Type to search · ' : ''}↑↓ to move · ↵ to pick{back ? ' · ← back' : ''} · esc to close
    </p>
  );
}

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
  const id = document.id;
  if (!id) return null;
  return { _id: id, name: document.name };
}

/** Longest `#query` the picker keeps filtering before it lets go. */
const MAX_QUERY_LENGTH = 48;
const MAX_BLOCK_HITS = 8;
const MAX_DOC_HITS = 5;

type QueryHit =
  | { kind: 'block'; block: Block; index: number; label: string; score: number }
  | { kind: 'doc'; doc: DocSummary; label: string; score: number };

/**
 * How well `text` answers `query`, or null when it does not: a match at the
 * start beats one at a word start, which beats one inside a word.
 */
function matchScore(text: string, query: string): number | null {
  const haystack = text.toLowerCase();
  const at = haystack.indexOf(query);
  if (at === -1) return null;
  if (at === 0) return 3;
  return /[\s\p{P}]/u.test(haystack[at - 1]) ? 2 : 1;
}

/**
 * A block's text around the match: a hit deep in a long paragraph is shown
 * from a word before it, so the part that matched is never truncated away.
 */
function excerpt(text: string, query: string): string {
  const at = text.toLowerCase().indexOf(query);
  let start = 0;
  if (at > 28) {
    const space = text.lastIndexOf(' ', at - 12);
    start = space > 0 ? space + 1 : at - 12;
  }
  const slice = text.slice(start, start + 60);
  return `${start > 0 ? '…' : ''}${slice}${start + 60 < text.length ? '…' : ''}`;
}

/** The label with the part that matched the query set in semibold. */
function Highlighted({ text, query }: { text: string; query: string }) {
  const at = query ? text.toLowerCase().indexOf(query) : -1;
  if (at === -1) return <>{text}</>;
  return (
    <>
      {text.slice(0, at)}
      <span className="font-semibold">{text.slice(at, at + query.length)}</span>
      {text.slice(at + query.length)}
    </>
  );
}

export type ChatRefPickerHandle = {
  openAt: (anchorIndex: number, opts?: { editing?: boolean }) => void;
  close: () => void;
  /**
   * Whether the picker currently owns the keyboard. The composer asks before
   * treating Enter as "send": with a list of documents on screen, Enter picks
   * the highlighted one.
   */
  isOpen: () => boolean;
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
  const { blocks, listRemote, documentId } = useEditor();

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
  const [queryIndex, setQueryIndex] = useState<number>(0);
  const [queryDocs, setQueryDocs] = useState<DocSummary[] | null>(null);
  const refMenuRef = useRef<HTMLDivElement | null>(null);
  const refResultsRef = useRef<HTMLDivElement | null>(null);
  const queryRef = useRef<HTMLDivElement | null>(null);

  /**
   * What was typed after the `#`, which filters blocks and documents the
   * way `@` does in Notion. Only for a fresh `#`: editing an existing chip
   * keeps the browse menu.
   */
  const typed = refAnchorIndex >= 0 && input[refAnchorIndex] === '#' ? input.slice(refAnchorIndex + 1) : null;
  const query = !editingExisting && typed ? typed.toLowerCase() : '';
  const queryMode = refOpen && query.length > 0;
  const trimmedQuery = query.trim();

  const hits = useMemo<QueryHit[]>(() => {
    if (!queryMode || !trimmedQuery) return [];
    const blockHits: QueryHit[] = [];
    blocks.forEach((block, index) => {
      if (block.type === 'divider') return;
      const text = blockText(block).replace(/\s+/g, ' ').trim();
      const kind = kindLabel(block);
      const score = matchScore(text, trimmedQuery) ?? (matchScore(kind, trimmedQuery) !== null ? 0 : null);
      if (score === null) return;
      const label = text ? excerpt(text, trimmedQuery) : `${kind} ${index + 1}`;
      // Headings are what a reference usually means.
      blockHits.push({ kind: 'block', block, index, label, score: score + (block.type === 'heading' ? 0.5 : 0) });
    });
    blockHits.sort((a, b) => b.score - a.score || (a.kind === 'block' && b.kind === 'block' ? a.index - b.index : 0));
    const docHits: QueryHit[] = (queryDocs ?? [])
      .filter((doc) => doc._id !== documentId)
      .flatMap((doc) => {
        const label = doc.name || 'Untitled document';
        const score = matchScore(label, trimmedQuery);
        return score === null ? [] : [{ kind: 'doc' as const, doc, label, score }];
      })
      .sort((a, b) => b.score - a.score);
    return [...blockHits.slice(0, MAX_BLOCK_HITS), ...docHits.slice(0, MAX_DOC_HITS)];
  }, [blocks, documentId, queryDocs, queryMode, trimmedQuery]);

  // A new query starts at the best match. Adjusted during render: it follows
  // the composer's text, not an external system.
  const [lastQuery, setLastQuery] = useState('');
  if (lastQuery !== query) {
    setLastQuery(query);
    setQueryIndex(0);
  }

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
    setQueryIndex(0);
    setQueryDocs(null);
    setRefOpen(true);
  }, []);

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

  // Read through a ref so the handle stays stable while the picker opens and
  // closes — the composer holds it for the lifetime of a conversation.
  const openRef = useRef(false);
  useEffect(() => {
    openRef.current = refOpen || refResultsOpen;
  }, [refOpen, refResultsOpen]);

  useImperativeHandle(ref, () => ({
    openAt: openRefMenu,
    close: closeRefMenu,
    isOpen: () => openRef.current,
  }), [closeRefMenu, openRefMenu]);

  const insertAtHash = useCallback((textToInsert: string) => {
    // hostRef is a contenteditable div; we no longer need DOM selection values here
    const start = Math.max(0, refAnchorIndex);
    // A fresh `#` takes what was typed after it as a search; the reference
    // replaces both.
    let end = Math.min(input.length, start + 1 + (editingExisting ? 0 : (typed?.length ?? 0)));
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
  }, [closeRefMenu, editingExisting, input, refAnchorIndex, setCaretIndex, setInput, typed]);

  const insertDocumentReference = useCallback((doc: DocSummary) => {
    insertAtHash(`#doc/${doc._id}`);
  }, [insertAtHash]);

  const labelForBlock = (b: Block, index: number): string => {
    if (b.type === 'divider') return 'Divider';
    // blockText strips tags by regex: assigning block html to a detached
    // div's innerHTML would fire event handlers (`img onerror`) even
    // off-document.
    const txt = blockText(b).trim();
    return txt ? (txt.length > 60 ? txt.slice(0, 57) + '…' : txt) : `${kindLabel(b)} ${index + 1}`;
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
      const { documents } = await listRemote({ page: 1, limit: 10 });
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

  // Other documents join the matches once the author starts typing a name.
  const needDocs = queryMode && queryDocs === null;
  const queryDocsLoading = needDocs;
  useEffect(() => {
    if (!needDocs) return;
    let cancelled = false;
    listRemote({ page: 1, limit: 50 })
      .then(({ documents }) => {
        if (!cancelled) setQueryDocs(documents.map(toDocSummary).filter((doc): doc is DocSummary => doc !== null));
      })
      .catch(() => {
        // Signed out or offline: this page's blocks are still searchable.
        if (!cancelled) setQueryDocs([]);
      })
    return () => {
      cancelled = true;
    };
  }, [listRemote, needDocs]);

  const pickHit = useCallback((hit: QueryHit | undefined) => {
    if (!hit) return;
    if (hit.kind === 'block') insertAtHash(`#this/${hit.block.id}`);
    else insertDocumentReference(hit.doc);
  }, [insertAtHash, insertDocumentReference]);

  /** Browse a matched document's blocks: the typed query gives way to the list. */
  const exploreHit = useCallback((doc: DocSummary) => {
    const start = Math.max(0, refAnchorIndex);
    setInput(`${input.slice(0, start + 1)}${input.slice(start + 1 + (typed?.length ?? 0))}`);
    requestAnimationFrame(() => setCaretIndex?.(start + 1));
    setRefDocs(queryDocs);
    setNavigationStack([{ type: 'main' }, { type: 'documents' }]);
    void onOpenDocBlocks(doc);
  }, [input, onOpenDocBlocks, queryDocs, refAnchorIndex, setCaretIndex, setInput, typed]);

  const handleEnterKey = useCallback(() => {
    if (queryMode) {
      pickHit(hits[queryIndex]);
      return;
    }
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
    hits,
    menuIndex,
    onOpenDocBlocks,
    onPickBlock,
    pickHit,
    queryIndex,
    queryMode,
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
      const insideResults =
        !!target &&
        ((!!refResultsRef.current && refResultsRef.current.contains(target)) ||
          (!!queryRef.current && queryRef.current.contains(target)));
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

      if (queryMode) {
        maxIndex = hits.length - 1;
        if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
          e.preventDefault();
          const step = e.key === 'ArrowDown' ? 1 : -1;
          setQueryIndex((prev) => Math.min(Math.max(prev + step, 0), Math.max(maxIndex, 0)));
        } else if (e.key === 'Enter' && hits.length > 0) {
          e.preventDefault();
          handleEnterKey();
        } else if (e.key === 'Tab' && hits.length > 0) {
          e.preventDefault();
          handleEnterKey();
        }
        // Everything else — letters, Backspace, the caret keys — is typing.
        return;
      }

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
    hits.length,
    navigateBack,
    queryMode,
    navigationStack.length,
    refBlocks,
    refDocs,
    refOpen,
    refResultsOpen,
    refResultsType,
  ]);

  // Close the picker once the `#` it was opened for is gone, or once what
  // follows it stops reading as a search: a line break, another `#`, a run
  // too long for a name, or words that match nothing (so "issue #12 " stays
  // ordinary text and Enter sends it). Adjusted during render rather than in
  // an effect: this reacts to the composer's text, not to an external
  // system, and `closeRefMenu` only resets state, so React re-renders before
  // committing. The guard converges: `closeRefMenu` clears both open flags.
  const noMatches = queryMode && hits.length === 0 && queryDocs !== null && !queryDocsLoading;
  const queryEnded =
    typed !== null &&
    !editingExisting &&
    (/^\s/.test(typed) ||
      /[\n#]/.test(typed) ||
      typed.length > MAX_QUERY_LENGTH ||
      noMatches);
  if ((refOpen || refResultsOpen) && (typed === null || queryEnded)) {
    closeRefMenu();
  } else if (refResultsOpen && queryMode) {
    // Typing while browsing a list searches instead.
    setRefResultsOpen(false);
    setNavigationStack([{ type: 'main' }]);
  }

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
    host.setAttribute('aria-controls', refResultsOpen || queryMode ? RESULTS_LIST_ID : MENU_LIST_ID);
    if (queryMode && hits.length === 0) host.removeAttribute('aria-activedescendant');
    else
      host.setAttribute(
        'aria-activedescendant',
        queryMode
          ? optionId(RESULTS_LIST_ID, queryIndex)
          : refResultsOpen
            ? optionId(RESULTS_LIST_ID, resultsIndex)
            : optionId(MENU_LIST_ID, menuIndex),
      );

    return () => {
      host.removeAttribute('aria-expanded');
      host.removeAttribute('aria-controls');
      host.removeAttribute('aria-activedescendant');
    };
  }, [getHost, hits.length, menuIndex, queryIndex, queryMode, refOpen, refResultsOpen, resultsIndex]);

  const optionClass = (active: boolean) =>
    cn(menuItem, 'w-full text-left', active && 'bg-hover');

  return (
    <>
      {/* One list at a time, filling the composer's width. The two used to sit
          side by side at a measured offset, which in a narrow panel put the
          results outside the assistant entirely, where they were clipped. */}
      {queryMode && !refResultsOpen && (
        <div
          ref={queryRef}
          className={cn(menuSurface, 'chat-ref-query absolute bottom-full left-0 right-0 z-[var(--z-dropdown)] mb-2')}
        >
          <div
            id={RESULTS_LIST_ID}
            role="listbox"
            aria-label={`References matching “${typed?.trim()}”`}
            className="max-h-[18rem] overflow-y-auto"
          >
            {hits.map((hit, idx) => {
              const firstOfGroup = idx === 0 || hits[idx - 1].kind !== hit.kind;
              const active = queryIndex === idx;
              return (
                <div key={hit.kind === 'block' ? `b-${hit.block.id}` : `d-${hit.doc._id}`} role="presentation">
                  {firstOfGroup && (
                    <div role="presentation" className={cn(menuLabel, idx > 0 && 'mt-1')}>
                      {hit.kind === 'block' ? 'This page' : 'Other documents'}
                    </div>
                  )}
                  {hit.kind === 'block' ? (
                    <button
                      type="button"
                      id={optionId(RESULTS_LIST_ID, idx)}
                      role="option"
                      aria-selected={active}
                      className={optionClass(active)}
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => pickHit(hit)}
                      onMouseEnter={() => setQueryIndex(idx)}
                    >
                      <span className={cn('min-w-0 flex-1 truncate', hit.block.type === 'heading' && 'font-medium')}>
                        <Highlighted text={hit.label} query={trimmedQuery} />
                      </span>
                      <span className="shrink-0 text-xs text-muted-foreground">{kindLabel(hit.block)}</span>
                    </button>
                  ) : (
                    <div className="flex items-center gap-0.5" role="presentation">
                      <button
                        type="button"
                        id={optionId(RESULTS_LIST_ID, idx)}
                        role="option"
                        aria-selected={active}
                        className={optionClass(active)}
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={() => pickHit(hit)}
                        onMouseEnter={() => setQueryIndex(idx)}
                      >
                        <FileText aria-hidden="true" />
                        <span className="min-w-0 flex-1 truncate">
                          <Highlighted text={hit.label} query={trimmedQuery} />
                        </span>
                      </button>
                      <button
                        type="button"
                        tabIndex={-1}
                        className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-hover hover:text-foreground"
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={() => exploreHit(hit.doc)}
                        aria-label={`Explore blocks in ${hit.label}`}
                      >
                        <ChevronRight aria-hidden="true" className="h-4 w-4" />
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
          {hits.length === 0 &&
            (queryDocsLoading ? (
              <LoadingRow label="Searching…" />
            ) : (
              <div className="px-2 py-3 text-center text-sm text-muted-foreground">No matching blocks or documents</div>
            ))}
          <PickerHints back={false} />
        </div>
      )}

      {refOpen && !refResultsOpen && !queryMode && (
        <div
          ref={refMenuRef}
          className={cn(menuSurface, 'chat-ref-menu absolute bottom-full left-0 right-0 z-[var(--z-dropdown)] mb-2')}
        >
          <div id={`${MENU_LIST_ID}-label`} className={menuLabel}>
            Reference
          </div>
          {/* `listbox`, not `menu`: the highlight is virtual and focus stays
              in the composer, which is the listbox pattern. */}
          <div id={MENU_LIST_ID} role="listbox" aria-labelledby={`${MENU_LIST_ID}-label`}>
            <button
              id={optionId(MENU_LIST_ID, 0)}
              role="option"
              aria-selected={menuIndex === 0}
              className={optionClass(menuIndex === 0)}
              onMouseDown={(e) => e.preventDefault()}
              onClick={onSelectThis}
              onMouseEnter={() => setMenuIndex(0)}
            >
              <FileText aria-hidden="true" />
              <span className="min-w-0 flex-1">
                <span className="block">This document</span>
                <span className="block text-xs text-muted-foreground">A block on this page</span>
              </span>
              <ChevronRight aria-hidden="true" />
            </button>
            <button
              id={optionId(MENU_LIST_ID, 1)}
              role="option"
              aria-selected={menuIndex === 1}
              className={optionClass(menuIndex === 1)}
              onMouseDown={(e) => e.preventDefault()}
              onClick={onSelectDocuments}
              onMouseEnter={() => setMenuIndex(1)}
            >
              <Files aria-hidden="true" />
              <span className="min-w-0 flex-1">
                <span className="block">Other documents</span>
                <span className="block text-xs text-muted-foreground">A whole document, or a block in it</span>
              </span>
              <ChevronRight aria-hidden="true" />
            </button>
          </div>
          <PickerHints back={false} search={!editingExisting} />
        </div>
      )}

      {refResultsOpen && (
        <div
          ref={refResultsRef}
          className={cn(menuSurface, 'chat-ref-results absolute bottom-full left-0 right-0 z-[var(--z-dropdown)] mb-2')}
        >
          <div className="flex items-center gap-1">
            {navigationStack.length > 1 && (
              <button
                type="button"
                className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-hover hover:text-foreground"
                onClick={navigateBack}
                onMouseDown={(e) => e.preventDefault()}
                aria-label="Back to the previous list"
              >
                <ChevronLeft aria-hidden="true" className="h-4 w-4" />
              </button>
            )}
            <div id={`${RESULTS_LIST_ID}-label`} className={cn(menuLabel, 'min-w-0 truncate pt-1 pl-1')}>
              {refResultsType === 'documents'
                ? 'Documents'
                : refResultsType === 'this-blocks'
                  ? 'Blocks on this page'
                  : `Blocks in ${refDocContext?.name || refDocContext?._id || 'document'}`}
            </div>
          </div>

          {refLoading && (
            <LoadingRow label={refResultsType === 'documents' ? 'Loading documents…' : 'Loading blocks…'} />
          )}
          {refError && (
            <div role="alert" className="px-2 py-1.5 text-sm text-destructive">
              {refError}
            </div>
          )}

          {refResultsType === 'documents' && !refLoading && !refError && (
            <div
              id={RESULTS_LIST_ID}
              role="listbox"
              aria-labelledby={`${RESULTS_LIST_ID}-label`}
              className="max-h-[14rem] overflow-y-auto"
            >
              {(refDocs || []).map((d, idx) => (
                <div key={d._id} className="flex items-center gap-0.5">
                  <button
                    id={optionId(RESULTS_LIST_ID, idx)}
                    role="option"
                    aria-selected={resultsIndex === idx}
                    className={optionClass(resultsIndex === idx)}
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => insertDocumentReference(d)}
                    onMouseEnter={() => setResultsIndex(idx)}
                  >
                    <FileText aria-hidden="true" />
                    <span className="min-w-0 flex-1 truncate">{d.name || 'Untitled document'}</span>
                  </button>
                  <button
                    type="button"
                    className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-hover hover:text-foreground"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => onOpenDocBlocks(d)}
                    aria-label={`Explore blocks in ${d.name || d._id}`}
                  >
                    <ChevronRight aria-hidden="true" className="h-4 w-4" />
                  </button>
                </div>
              ))}
              {(!refDocs || refDocs.length === 0) && (
                <div className="px-2 py-3 text-center text-sm text-muted-foreground">No documents</div>
              )}
            </div>
          )}

          {(refResultsType === 'this-blocks' || refResultsType === 'doc-blocks') && !refLoading && !refError && (
            <div
              id={RESULTS_LIST_ID}
              role="listbox"
              aria-labelledby={`${RESULTS_LIST_ID}-label`}
              className="max-h-[14rem] overflow-y-auto"
            >
              {(refBlocks || []).map((b, idx) => (
                <button
                  key={b.id}
                  id={optionId(RESULTS_LIST_ID, idx)}
                  role="option"
                  aria-selected={resultsIndex === idx}
                  className={optionClass(resultsIndex === idx)}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => onPickBlock(refResultsType === 'this-blocks' ? 'this' : 'doc', b)}
                  onMouseEnter={() => setResultsIndex(idx)}
                >
                  <span
                    className={cn('min-w-0 flex-1 truncate', b.type === 'heading' && 'font-medium')}
                  >
                    {labelForBlock(b, idx)}
                  </span>
                  <span className="shrink-0 text-xs text-muted-foreground">{kindLabel(b)}</span>
                </button>
              ))}
              {(!refBlocks || refBlocks.length === 0) && (
                <div className="px-2 py-3 text-center text-sm text-muted-foreground">No blocks</div>
              )}
            </div>
          )}
          <PickerHints back={navigationStack.length > 1} />
        </div>
      )}
    </>
  );
});
