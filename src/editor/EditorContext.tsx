import { useCallback, useEffect, useEffectEvent, useMemo, useRef, useState, type ReactNode } from 'react';
import type { Block, Doc, ParagraphChild, ToolOperation } from './types';
import { buildBibliography, citationFingerprint } from './citations';
import { BibliographyContext } from './bibliographyContextState';
import { loadDoc, saveDoc, loadDocumentId, saveDocumentId } from './storage';
import {
  applyPatchToBlocks,
  coerceBlock,
  describeSaveError,
  placeholderIds,
  reconcileBlocks,
  withoutOrphanChildren,
  type ApplyPatchResult,
} from './docOps';
import { createDocument as apiCreateDocument, saveDocument as apiSaveDocument, loadDocument as apiLoadDocument, deleteDocument as apiDeleteDocument, listDocuments as apiListDocuments } from '../services';
import type {
  DocumentInput,
  DocumentListOptions,
  DocumentListResult,
} from '../services';
import { uid } from '../lib/uid';
import {
  EditorActionsContext,
  EditorActiveBlockContext,
  EditorContext,
  type EditorActionsContextValue,
  type EditorActiveBlockContextValue,
  type EditorContextValue,
  type EditorStateContextValue,
} from './editorContextState';
import { serializeEditableHtml } from '@/components/common/Editable/editableHtml';
import { emitDocumentTransitionStart } from './documentTransition';
export type { EditorContextValue } from './editorContextState';

/** How many document states undo can walk back. */
const UNDO_LIMIT = 100;

type HistoryEntry = {
  before: Doc;
  after: Doc;
  /** Typing steps with the same key merge while the burst lasts. */
  key: string | null;
  time: number;
};

/**
 * An empty block of the given type.
 *
 * The same three-way expression was written out in each insertion helper, so a
 * new block type — or a change to a paragraph's defaults — had to be made in
 * every one of them or the block came out shaped differently depending on
 * which affordance created it.
 */
function blankBlock(id: string, type: Block['type']): Block {
  if (type === 'paragraph') return { id, type: 'paragraph', html: '', children: [], columns: 1 };
  if (type === 'heading') return { id, type: 'heading', level: 2, html: '' };
  return { id, type: 'divider' };
}

function makeDefaultDoc(): Doc {
  return {
    version: 1,
    name: 'Untitled document',
    blocks: [
      { id: uid(), type: 'heading', level: 2, html: 'Your document' },
      { id: uid(), type: 'paragraph', html: 'Write something here. Select text to format. Use the + to insert blocks.', children: [], columns: 1 },
    ],
  };
}

function documentInputToDoc(input: DocumentInput): Doc {
  if (Array.isArray(input)) {
    return { version: 1, blocks: input };
  }
  return {
    version: typeof input.version === 'number' ? input.version : 1,
    blocks: Array.isArray(input.blocks) ? input.blocks : [],
    name:
      typeof input.name === 'string'
        ? input.name
        : 'title' in input && typeof input.title === 'string'
          ? input.title
          : undefined,
  };
}

function migrateLegacyInlineAiBeats(doc: Doc): Doc {
  if (typeof document === 'undefined') return doc;
  try {
    let changed = false;
    const blocks = doc.blocks.map((block) => {
      if (block.type !== 'paragraph') return block;
      if (block.html.includes('data-child-id') || !/ai-beat-widget/.test(block.html)) return block;

      const container = document.createElement('div');
      container.innerHTML = block.html;
      const children: ParagraphChild[] = Array.isArray(block.children) ? [...block.children] : [];
      const widgets = Array.from(container.querySelectorAll<HTMLElement>('.ai-beat-widget'));
      for (const element of widgets) {
        const id = uid();
        const output = (element.querySelector('.ai-beat-output')?.textContent || '').trim();
        const collapsed = element.getAttribute('data-collapsed') === '1';
        const placeholder = document.createElement('span');
        placeholder.setAttribute('data-child-id', id);
        placeholder.setAttribute('contenteditable', 'false');
        element.replaceWith(placeholder);
        children.push({ id, type: 'aiBeat', message: '', prompt: '', output, collapsed });
        changed = true;
      }
      return { ...block, html: container.innerHTML, children };
    });
    return changed ? { ...doc, blocks } : doc;
  } catch {
    return doc;
  }
}

function urlDocumentId(): string | null {
  if (typeof window === 'undefined') return null;
  const requested = new URLSearchParams(window.location.search).get('doc');
  return requested || null;
}

type MountDocumentSelection = {
  committedDocumentId: string | null;
  committedDocument: Doc;
  requestedDocumentId: string | null;
};

function mountDocumentSelection(): MountDocumentSelection {
  const cachedDocumentId = loadDocumentId();
  const requestedDocumentId = urlDocumentId();
  const targetDocumentId = requestedDocumentId ?? cachedDocumentId;
  const targetDocument = targetDocumentId ? loadDoc(targetDocumentId) : null;
  const cachedDocument = cachedDocumentId ? loadDoc(cachedDocumentId) : null;
  const localDocument = loadDoc(null);

  // A remote id is committed only when the body beside it is keyed to that
  // exact id. Otherwise the editor owns a safe cached/local body while the
  // remote id remains merely requested.
  const committedDocumentId = targetDocument
    ? targetDocumentId
    : cachedDocument
      ? cachedDocumentId
      : null;
  const committedDocument = targetDocument ?? cachedDocument ?? localDocument ?? makeDefaultDoc();

  return {
    committedDocumentId,
    committedDocument,
    requestedDocumentId: targetDocumentId,
  };
}

export function EditorProvider({ children }: { children: ReactNode }) {
  // A shared document link is more specific than the last locally cached id.
  // Selecting it before either provider runs an effect also means mount
  // hydration performs one request for the URL document instead of briefly
  // reopening the cached one.
  const [mountSelection] = useState<MountDocumentSelection>(mountDocumentSelection);
  const initialDocumentId = mountSelection.committedDocumentId;
  const initialRequestedDocumentId = mountSelection.requestedDocumentId;
  const [doc, setDoc] = useState<Doc>(
    () => migrateLegacyInlineAiBeats(mountSelection.committedDocument),
  );
  const blocks = doc.blocks;
  const refs = useRef<Record<string, HTMLDivElement | null>>({});
  const registerEditable = useCallback((id: string, element: HTMLDivElement | null) => {
    // React re-calls the ref with null on unmount; storing `{id: null}` would
    // grow the map by one dead entry for every block ever removed.
    if (element) refs.current[id] = element;
    else delete refs.current[id];
  }, []);
  const [lastSavedAt, setLastSavedAt] = useState<number | null>(null);
  const [documentId, setDocumentId] = useState<string | null>(initialDocumentId);
  /**
   * Identity of the document the workspace is *on*, as opposed to the id the
   * server knows it by.
   *
   * The two differ for exactly one transition: saving a local draft gives the
   * open document an id without changing which document it is. Anything keyed
   * on `documentId` alone — the assistant's transcript, most of all — would
   * treat that as navigating away and throw the session out mid-sentence.
   */
  const [documentSessionId, setDocumentSessionId] = useState<string>(uid);
  const startDocumentSession = useCallback(() => setDocumentSessionId(uid()), []);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [isAutoSaving, setIsAutoSaving] = useState<boolean>(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [loadingDocumentId, setLoadingDocumentId] = useState<string | null>(
    initialRequestedDocumentId,
  );
  const loadingDocumentIdRef = useRef<string | null>(initialRequestedDocumentId);
  const noticeSequenceRef = useRef(0);
  const [documentLoadNotice, setDocumentLoadNotice] = useState<
    EditorContextValue['documentLoadNotice']
  >(null);

  // Saves are optimistically locked on the version. The authoritative value
  // lives in a ref rather than in `doc`, because adopting a new version has to
  // NOT look like a content change — `doc` is an autosave dependency, so
  // writing the version back into it would re-arm the timer and the editor
  // would save itself forever.
  const versionRef = useRef<number>(doc.version ?? 1);

  // Revisions distinguish real edits from navigation. A document is dirty
  // only while its edit revision is newer than the revision last confirmed by
  // the server. Merely opening or leaving a document must not change
  // `updated_at`.
  const [dirtyTick, setDirtyTick] = useState(0);
  const editRevisionRef = useRef(0);
  const persistedRevisionRef = useRef(0);
  const saveInFlightRef = useRef<Promise<void> | null>(null);
  const [documentListRevision, setDocumentListRevision] = useState(0);
  const [restoreEpoch, setRestoreEpoch] = useState(0);
  const autoSaveTimerRef = useRef<number | null>(null);
  // Mirrors `isAutoSaving` for readers that run outside React's render cycle —
  // specifically the beforeunload guard, which has to answer "is there
  // unsaved work" synchronously at event time.
  const isAutoSavingRef = useRef(false);

  // Latest doc/id without waiting for a re-render. Callbacks captured by the
  // chat stream can outlive several renders, and saving from a stale closure
  // is how edits get silently reverted.
  //
  // Every writer below goes through `commitDoc`, so this ref is current the
  // moment a change is made rather than one commit later. `applyPatch` depends
  // on that: it has to report which blocks it touched to its caller, and it
  // cannot learn that from inside a `setState` updater React runs whenever it
  // likes.
  const docRef = useRef(doc);
  const documentIdRef = useRef(documentId);
  useEffect(() => {
    docRef.current = doc;
    documentIdRef.current = documentId;
  }, [doc, documentId]);

  const commitDoc = useCallback((next: Doc) => {
    docRef.current = next;
    setDoc(next);
  }, []);

  // Which document the in-state `doc` was actually loaded for. Without this a
  // PUT can write one document's body over another's — the id and the body are
  // separate pieces of state that briefly disagree while switching documents.
  const loadedForIdRef = useRef<string | null>(documentId);
  // All document loads share one sequence. A transition reserves its token
  // before doing any asynchronous work; only that token may later commit or
  // report a failure. Mount hydration owns token zero.
  const documentRequestRef = useRef(0);
  const documentLoadControllerRef = useRef<AbortController | null>(null);
  const beginDocumentTransition = useCallback((id: string | null) => {
    documentRequestRef.current += 1;
    emitDocumentTransitionStart();
    documentLoadControllerRef.current?.abort();
    documentLoadControllerRef.current = null;
    loadingDocumentIdRef.current = id;
    setLoadingDocumentId(id);
    setDocumentLoadNotice(null);
    if (autoSaveTimerRef.current !== null) {
      clearTimeout(autoSaveTimerRef.current);
      autoSaveTimerRef.current = null;
    }
    return documentRequestRef.current;
  }, []);
  const finishDocumentTransition = useCallback((requestToken: number) => {
    if (requestToken !== documentRequestRef.current) return;
    loadingDocumentIdRef.current = null;
    setLoadingDocumentId(null);
    documentLoadControllerRef.current = null;
  }, []);
  const reportDocumentLoadFailure = useCallback((
    error: unknown,
    options?: { mount?: boolean; source?: 'selection' | 'history' },
  ) => {
    const detail = error instanceof Error && error.message
      ? error.message
      : 'The request failed.';
    const title = options?.source === 'history'
      ? 'Could not open that document from history'
      : 'Could not open document';
    setDocumentLoadNotice({
      id: ++noticeSequenceRef.current,
      title,
      description: options?.mount
        ? `${detail} Showing your local copy.`
        : `${detail} Your current document remains open.`,
    });
  }, []);
  // Global menu state - only one block menu open at a time
  const [openMenuBlockId, setOpenMenuBlockId] = useState<string | null>(null);
  const [openMenuType, setOpenMenuType] = useState<'add' | 'options' | null>(null);
  
  const setBlockMenu = useCallback((blockId: string | null, type: 'add' | 'options' | null) => {
    setOpenMenuBlockId(blockId);
    setOpenMenuType(type);
  }, []);
  const [lastSaveSource, setLastSaveSource] = useState<'auto' | 'manual' | null>(null);

  /**
   * Capture the DOM-backed editable values synchronously before export.
   *
   * React state normally follows on the next frame. Export is user-initiated
   * and must include the character still visible under the caret even when
   * that state update has not committed yet.
   */
  const getExportSnapshot = useCallback((): {
    document: Doc;
    baseVersion: number;
    localRevision: number;
    dirty: boolean;
  } => {
    // Reads `docRef` rather than closing over `doc`: the snapshot must be of
    // the document as it is at click time, and a state closure would also
    // make this action change identity on every edit.
    const document = structuredClone(docRef.current);
    document.version = versionRef.current;
    document.blocks = document.blocks.map((block) => {
      if (block.type === 'divider') return block;
      const editable = refs.current[block.id];
      return editable ? { ...block, html: serializeEditableHtml(editable) } : block;
    });
    return {
      document,
      baseVersion: versionRef.current,
      localRevision: editRevisionRef.current,
      dirty: editRevisionRef.current > persistedRevisionRef.current
        || autoSaveTimerRef.current !== null
        || isAutoSavingRef.current,
    };
  }, []);

  const [hasAnyRemoteDocs, setHasAnyRemoteDocs] = useState<boolean | null>(null);
  // `save` reads this at event time. Mirrored into a ref so the action can
  // stay referentially stable instead of closing over state.
  const hasAnyRemoteDocsRef = useRef(hasAnyRemoteDocs);
  useEffect(() => {
    hasAnyRemoteDocsRef.current = hasAnyRemoteDocs;
  }, [hasAnyRemoteDocs]);

  // Local draft cache, keyed by the document it belongs to.
  useEffect(() => {
    if (loadingDocumentId !== null) return;
    const raf = requestAnimationFrame(() => {
      if (loadingDocumentIdRef.current === null) saveDoc(doc, documentId);
    });
    return () => cancelAnimationFrame(raf);
  }, [doc, documentId, loadingDocumentId]);

  // Persist current document id
  useEffect(() => {
    if (loadingDocumentId !== null) return;
    saveDocumentId(documentId);
  }, [documentId, loadingDocumentId]);

  // Determine whether the account has any remote documents to tailor
  // the initial Canvas experience and gate autosave behavior.
  useEffect(() => {
    let canceled = false;
    (async () => {
      try {
        const res = await apiListDocuments({ page: 1, limit: 1 });
        if (!canceled) setHasAnyRemoteDocs((res.count || 0) > 0);
      } catch {
        // On error, assume true to avoid blocking normal autosave flows.
        if (!canceled) setHasAnyRemoteDocs(true);
      }
    })();
    return () => { canceled = true; };
  }, []);

  /** Apply a content change and arm the autosave timer. */
  const historyRef = useRef<{ undo: HistoryEntry[]; redo: HistoryEntry[] }>({
    undo: [],
    redo: [],
  });
  /** Set while undo/redo replays a state, so the replay is not itself journaled. */
  const applyingHistoryRef = useRef(false);

  const mutateDoc = useCallback((updater: (prev: Doc) => Doc, options?: { coalesceKey?: string }) => {
    if (loadingDocumentIdRef.current !== null) return;
    const before = docRef.current;
    editRevisionRef.current += 1;
    const next = updater(before);
    commitDoc(next);
    setDirtyTick(editRevisionRef.current);
    // Journal for undo. Typing bursts coalesce per block (a pause of a second
    // starts a fresh step); structural changes always start a new entry.
    if (
      !applyingHistoryRef.current &&
      (next.blocks !== before.blocks || next.name !== before.name)
    ) {
      const key = options?.coalesceKey ?? null;
      const now = Date.now();
      const stack = historyRef.current.undo;
      const top = stack[stack.length - 1];
      if (key && top && top.key === key && now - top.time < 1000) {
        top.after = next;
        top.time = now;
      } else {
        stack.push({ before, after: next, key, time: now });
        if (stack.length > UNDO_LIMIT) stack.shift();
      }
      historyRef.current.redo = [];
    }
  }, [commitDoc]);

  const setBlocks = useCallback((updater: (prev: Block[]) => Block[], coalesceKey?: string) =>
    mutateDoc(
      d => ({ ...d, blocks: updater(d.blocks) }),
      coalesceKey ? { coalesceKey } : undefined,
    ), [mutateDoc]);

  const setDocMeta = useCallback((meta: Partial<Doc>) => mutateDoc(prev => ({ ...prev, ...meta })), [mutateDoc]);
  const setDocName = useCallback((name: string) => setDocMeta({ name }), [setDocMeta]);

  /**
   * Record the version the server now holds, without marking the doc dirty.
   *
   * Called after our own saves and after the assistant edits the document
   * server-side. Skipping this is what made every save after the first fail:
   * the client kept optimistically locking on the version it first loaded.
   */
  const applyServerVersion = useCallback((
    version: number | undefined | null,
    invalidateList: boolean,
  ): boolean => {
    if (typeof version !== 'number' || Number.isNaN(version)) return true;
    // Never move backwards: a response to a save that was in flight while the
    // user restored to a newer version would drag the optimistic lock below
    // the server's head, and every later save would 409 until reload. The
    // persisted-revision guard below is monotonic for the same reason.
    if (version < versionRef.current) return false;
    const changed = versionRef.current !== version;
    versionRef.current = version;
    if (docRef.current.version !== version) {
      commitDoc({ ...docRef.current, version });
    }
    if (invalidateList && changed) {
      setDocumentListRevision(revision => revision + 1);
    }
    return true;
  }, [commitDoc]);

  const adoptServerVersion = useCallback((version: number | undefined | null) => {
    applyServerVersion(version, true);
  }, [applyServerVersion]);

  /**
   * Adopt a server-side restore of the open document.
   *
   * A restore is written by the server outside the editor's save path, so the
   * restored content and version become the new persisted baseline. That is
   * neither an edit (autosave must not re-save what the server just wrote)
   * nor a navigation (the document session — and with it the assistant
   * transcript — must survive), so neither path can be reused here.
   */
  const adoptRestoredDocument = useCallback((next: Doc, serverVersion: number) => {
    if (autoSaveTimerRef.current !== null) {
      clearTimeout(autoSaveTimerRef.current);
      autoSaveTimerRef.current = null;
    }
    commitDoc({
      ...next,
      version: serverVersion,
      blocks: reconcileBlocks(next.blocks),
    });
    editRevisionRef.current = 0;
    persistedRevisionRef.current = 0;
    setDirtyTick(0);
    versionRef.current = serverVersion;
    setSaveError(null);
    // The document is now a different version of its tree: anything staged
    // against the pre-restore content (pending proposals, in-flight agent
    // streams) must not apply to it.
    setRestoreEpoch(epoch => epoch + 1);
    // The restore changed `updated_at` server-side, so list order can change.
    setDocumentListRevision(revision => revision + 1);
  }, [commitDoc]);

  const addBlockAtStart = useCallback((type: Block['type']): string => {
    const newId = uid();
    setBlocks(prev => [blankBlock(newId, type), ...prev]);
    return newId;
  }, [setBlocks]);

  const addBlockAfter = useCallback((afterId: string, type: Block['type']): string => {
    const newId = uid();
    setBlocks(prev => {
      const idx = prev.findIndex(b => b.id === afterId);
      const out = [...prev];
      out.splice(idx + 1, 0, blankBlock(newId, type));
      return out;
    });
    return newId;
  }, [setBlocks]);

  /**
   * Insert above a given block.
   *
   * The gutter menu could only ever insert below, so nothing could be put in
   * front of the first block: `addBlockAtStart` reached the same place but was
   * surfaced only on the empty-document screen.
   */
  const addBlockBefore = useCallback((beforeId: string, type: Block['type']): string => {
    const newId = uid();
    setBlocks(prev => {
      const idx = prev.findIndex(b => b.id === beforeId);
      const out = [...prev];
      out.splice(idx === -1 ? 0 : idx, 0, blankBlock(newId, type));
      return out;
    });
    return newId;
  }, [setBlocks]);

  // --- Exact placement helpers (preserve provided id and full block data) ---
  const insertBlockAtStartExact = useCallback((block: Block) => setBlocks(prev => [block, ...prev]), [setBlocks]);
  const appendBlockExact = useCallback((block: Block) => setBlocks(prev => [...prev, block]), [setBlocks]);
  const insertBlockAfterExact = useCallback((afterId: string, block: Block) => setBlocks(prev => {
    const idx = prev.findIndex(b => b.id === afterId);
    const out = [...prev];
    if (idx === -1) {
      out.push(block);
    } else {
      out.splice(idx + 1, 0, block);
    }
    return out;
  }), [setBlocks]);
  const insertBlockBeforeExact = useCallback((beforeId: string, block: Block) => setBlocks(prev => {
    const idx = prev.findIndex(b => b.id === beforeId);
    const out = [...prev];
    if (idx === -1) {
      out.unshift(block);
    } else {
      out.splice(idx, 0, block);
    }
    return out;
  }), [setBlocks]);

  const moveBlock = useCallback((id: string, dir: -1 | 1) => setBlocks(prev => {
    const idx = prev.findIndex(b => b.id === id);
    if (idx < 0) return prev;
    const j = idx + dir;
    if (j < 0 || j >= prev.length) return prev;
    const out = [...prev];
    const [blk] = out.splice(idx, 1);
    out.splice(j, 0, blk);
    return out;
  }), [setBlocks]);

  /**
   * Split a text block at the caret (Enter): `beforeHtml` stays in the block,
   * `afterHtml` becomes a new paragraph below it. Inline widgets travel with
   * whichever half holds their placeholder span.
   */
  const splitBlock = useCallback((id: string, beforeHtml: string, afterHtml: string): string => {
    const newId = uid();
    setBlocks(prev => {
      const idx = prev.findIndex(b => b.id === id && 'html' in b);
      if (idx === -1) return prev;
      const b = prev[idx];
      const children = b.type === 'paragraph' ? b.children ?? [] : [];
      const afterIds = placeholderIds(afterHtml);
      const before: Block = (b.type === 'paragraph'
        ? withoutOrphanChildren({
            ...b,
            html: beforeHtml,
            children: children.filter(c => !afterIds.has(c.id)),
          } as Block)
        : ({ ...b, html: beforeHtml } as Block));
      const after = withoutOrphanChildren({
        id: newId,
        type: 'paragraph',
        html: afterHtml,
        children: children.filter(c => afterIds.has(c.id)),
        columns: b.type === 'paragraph' ? b.columns ?? 1 : 1,
      } as Block);
      const out = [...prev];
      out.splice(idx, 1, before, after);
      return out;
    });
    return newId;
  }, [setBlocks]);

  /**
   * Merge a block into the one above it (Backspace at the start of a block).
   * Returns the surviving block id and the caret's text offset at the
   * junction, or null when there is nothing to merge with.
   */
  const mergeWithPrevious = useCallback((
    id: string,
  ): { targetId: string; caretOffset: number } | null => {
    const list = docRef.current.blocks;
    const idx = list.findIndex(b => b.id === id);
    if (idx <= 0) return null;
    const current = list[idx];
    if (!('html' in current)) return null;
    const prev = list[idx - 1];
    if (prev.type === 'divider') {
      // The block after a divider backspaces the divider away rather than
      // into it — a divider has no text to merge with.
      setBlocks(blocks => blocks.filter(b => b.id !== prev.id));
      return { targetId: id, caretOffset: 0 };
    }
    if (prev.type === 'heading' && current.type === 'paragraph' && (current.children ?? []).length > 0) {
      // A heading does not render children; merging a widget-bearing
      // paragraph into it would orphan the widgets' placeholders.
      return null;
    }
    // Text length of the survivor's own content: where the caret belongs.
    const caretOffset = prev.html.replace(/<[^>]*>/g, '').length;
    const mergedHtml = prev.html + current.html;
    const merged: Block = prev.type === 'paragraph'
      ? {
          ...prev,
          html: mergedHtml,
          children: [
            ...(prev.children ?? []),
            ...(current.type === 'paragraph' ? current.children ?? [] : []),
          ],
        }
      : ({ ...prev, html: mergedHtml } as Block);
    setBlocks(blocks => {
      const i = blocks.findIndex(b => b.id === id);
      if (i <= 0) return blocks;
      const out = [...blocks];
      out.splice(i - 1, 2, merged);
      return out;
    });
    return { targetId: prev.id, caretOffset };
  }, [setBlocks]);

  const reorderBlock = useCallback((id: string, toIndex: number) => setBlocks(prev => {
    const fromIndex = prev.findIndex(b => b.id === id);
    if (fromIndex < 0) return prev;
    const out = [...prev];
    const [blk] = out.splice(fromIndex, 1);
    const clamped = Math.max(0, Math.min(toIndex, out.length));
    out.splice(clamped, 0, blk);
    return out;
  }), [setBlocks]);

  const removeBlock = useCallback((id: string) => setBlocks(prev => prev.filter(b => b.id !== id)), [setBlocks]);

  const updateHtml = useCallback((id: string, html: string) => setBlocks(prev => {
    const idx = prev.findIndex(b => b.id === id && 'html' in b);
    if (idx === -1) return prev;
    const b = prev[idx];
    if (b.type === 'divider') return prev;
    if (b.html === html) return prev;
    const out = prev.slice();
    // Deleting an inline widget removes its placeholder span from the html but
    // left the child in `children`. That orphan is invisible in the editor and
    // used to make every subsequent AI edit of the document fail validation.
    out[idx] = withoutOrphanChildren({ ...b, html } as Block);
    return out;
  }, `html:${id}`), [setBlocks]);

  const setParagraphColumns = useCallback((id: string, columns: number) => setBlocks(prev => prev.map(b => (
    b.id === id && b.type === 'paragraph'
      ? ({ ...b, columns: Math.max(1, Math.min(6, Math.floor(columns || 1))) })
      : b
  ))), [setBlocks]);

  // Generic helper to toggle a boolean meta key on any block
  const toggleMeta = useCallback((id: string, key: 'aiHidden' | 'locked' | 'collapsed') => setBlocks(prev => prev.map(b => (
    b.id === id ? ({ ...b, [key]: !(b[key] ?? false) }) : b
  ))), [setBlocks]);

  const toggleAiHidden = useCallback((id: string) => toggleMeta(id, 'aiHidden'), [toggleMeta]);
  const toggleLocked = useCallback((id: string) => toggleMeta(id, 'locked'), [toggleMeta]);
  const toggleCollapsed = useCallback((id: string) => toggleMeta(id, 'collapsed'), [toggleMeta]);

  const addParagraphChild: EditorContextValue['addParagraphChild'] = useCallback((blockId, child) => {
    setBlocks(prev => prev.map(b => {
      if (b.id !== blockId || b.type !== 'paragraph') return b;
      const children = Array.isArray(b.children) ? b.children.slice() : [];
      const exists = children.find(c => c.id === child.id);
      if (!exists) children.push(child);
      return { ...b, children } as Block;
    }));
    return child.id;
  }, [setBlocks]);

  const updateParagraphChild: EditorContextValue['updateParagraphChild'] = useCallback((blockId, childId, next) => {
    setBlocks(prev => {
      const bIndex = prev.findIndex(b => b.id === blockId && b.type === 'paragraph');
      if (bIndex === -1) return prev;
      const blk = prev[bIndex];
      if (blk.type !== 'paragraph') return prev;
      const children: ParagraphChild[] = Array.isArray(blk.children) ? blk.children : [];
      const cIndex = children.findIndex((c: ParagraphChild) => c.id === childId);
      if (cIndex === -1) return prev;
      const cur = children[cIndex];
      const merged: ParagraphChild = { ...cur, ...next } as ParagraphChild;
      const equal = JSON.stringify(cur) === JSON.stringify(merged);
      if (equal) return prev;
      const nextChildren = children.slice();
      nextChildren[cIndex] = merged;
      const out = prev.slice();
      out[bIndex] = { ...blk, children: nextChildren } as Block;
      return out;
    });
  }, [setBlocks]);

  const removeParagraphChild: EditorContextValue['removeParagraphChild'] = useCallback((blockId, childId) => {
    setBlocks(prev => prev.map(b => {
      if (b.id !== blockId || b.type !== 'paragraph') return b;
      const existing = b.children || [];
      const filtered = existing.filter(c => c.id !== childId);
      if (filtered.length === existing.length) return b;
      return { ...b, children: filtered };
    }));
  }, [setBlocks]);

  const setHeadingLevel = useCallback((id: string, level: 1 | 2 | 3) => setBlocks(prev => prev.map(b => (
    b.id === id && b.type === 'heading' ? ({ ...b, level }) : b
  ))), [setBlocks]);

  /**
   * A contenteditable command. `value` carries the argument the few commands
   * that take one need — `createLink` above all, which was unreachable while
   * this signature had nowhere to put a URL.
   */
  const exec = useCallback(
    (cmd: string, value?: string) => document.execCommand(cmd, false, value),
    [],
  );

  const newLocal = useCallback(() => {
    const requestToken = beginDocumentTransition(null);
    const next = makeDefaultDoc();
    startDocumentSession();
    commitDoc(next);
    editRevisionRef.current = 0;
    persistedRevisionRef.current = 0;
    setDirtyTick(0);
    setDocumentId(null);
    documentIdRef.current = null;
    loadedForIdRef.current = null;
    versionRef.current = 1;
    setLastSavedAt(null);
    setSaveError(null);
    setActiveId(null);
    setOpenMenuBlockId(null);
    setOpenMenuType(null);
    finishDocumentTransition(requestToken);
  }, [beginDocumentTransition, startDocumentSession, commitDoc, finishDocumentTransition]);

  // API-backed persistence
  const createRemote = useCallback(async (docOverride?: DocumentInput): Promise<string> => {
    const requestToken = beginDocumentTransition(null);
    const payload = docOverride ?? docRef.current;
    const revisionAtStart = editRevisionRef.current;
    const res = await apiCreateDocument(payload);
    const version = res.version ?? 1;

    // The creation itself succeeded even if navigation moved on while it was
    // in flight, so list metadata still changes. Only the still-current
    // transition may adopt the created document into the editor.
    if (requestToken === documentRequestRef.current) {
      setDocumentId(res.document_id);
      documentIdRef.current = res.document_id;
      loadedForIdRef.current = res.document_id;
      versionRef.current = version;
      persistedRevisionRef.current = revisionAtStart;
      // Deliberately not a new document session: this is the document that was
      // already open, now with an id the server recognises.
      if (docRef.current.version !== version) {
        commitDoc({ ...docRef.current, version });
      }
      setSaveError(null);
      // The caret stays where it is. Clearing the active block unconditionally
      // made saving a draft mid-edit look like a document switch to `Editable`,
      // which then rewrote the paragraph's DOM from state — throwing away an AI
      // suggestion or a streaming widget the author was in the middle of. Only
      // a caller that replaced the body on screen has invalidated it.
      if (docOverride !== undefined) {
        setActiveId(null);
        setOpenMenuBlockId(null);
        setOpenMenuType(null);
      }
    }
    setHasAnyRemoteDocs(true);
    setDocumentListRevision(revision => revision + 1);
    return res.document_id;
  }, [beginDocumentTransition, commitDoc]);

  // Serialize saves so a switch can wait for an active autosave, then
  // re-check whether a newer edit still needs its own write.
  const doRemoteSave = useCallback(async (source: 'auto' | 'manual', docOverride?: DocumentInput): Promise<void> => {
    // Cancel any pending autosave timer to avoid duplicate saves
    if (autoSaveTimerRef.current !== null) {
      clearTimeout(autoSaveTimerRef.current);
      autoSaveTimerRef.current = null;
    }
    // Snapshot before any await: an override is a body snapshot of the
    // document open *at call time*, and the workspace can move to another
    // document while a queued save below is awaited.
    const originId = documentIdRef.current;
    const pendingSave = saveInFlightRef.current;
    if (pendingSave) {
      try {
        await pendingSave;
      } catch {
        // The caller that started the failed request reports it. Re-evaluate
        // the current dirty revision here so an explicit retry can proceed.
      }
    }

    const targetId = documentIdRef.current;
    if (!targetId) {
      if (docOverride !== undefined && documentIdRef.current !== originId) return;
      const createdId = await createRemote(docOverride ?? docRef.current);
      if (
        documentIdRef.current === createdId
        && loadedForIdRef.current === createdId
      ) {
        setLastSavedAt(Date.now());
        setLastSaveSource(source);
      }
      return;
    }

    // Never write the in-state body to a document it did not come from. The id
    // and the body are separate state, and they disagree for a moment while
    // switching documents — long enough for a queued autosave to land.
    if (loadedForIdRef.current !== targetId) {
      return;
    }
    // An override body came from the document that was open at call time; if
    // the workspace moved on, this PUT would write that body over the newly
    // active document — and the optimistic lock would not catch it, because
    // versionRef moved with the switch.
    if (docOverride !== undefined && targetId !== originId) {
      return;
    }

    const revisionAtStart = editRevisionRef.current;
    const hasUnsavedRevision = revisionAtStart > persistedRevisionRef.current;
    if (!hasUnsavedRevision && docOverride === undefined) {
      if (source === 'manual') {
        setSaveError(null);
        setLastSavedAt(Date.now());
        setLastSaveSource(source);
      }
      return;
    }

    const base = docOverride ?? docRef.current;
    const payload: DocumentInput = Array.isArray(base)
      ? { blocks: base, version: versionRef.current }
      : { ...base, version: versionRef.current };

    const request = (async () => {
      const res = await apiSaveDocument(targetId, payload);
      setDocumentListRevision(revision => revision + 1);

      // A local reset can happen while a request is in flight. The old
      // document was still saved, but its response must not alter the newly
      // active document's version or clean revision.
      if (
        documentIdRef.current !== targetId
        || loadedForIdRef.current !== targetId
      ) {
        return;
      }

      const adopted = applyServerVersion(res?.version, false);
      if (adopted) {
        // A stale response (a save that was in flight across a restore) must
        // not mark its revision persisted either: the server head no longer
        // contains it, so the next edit would wrongly count as already saved.
        persistedRevisionRef.current = Math.max(
          persistedRevisionRef.current,
          revisionAtStart,
        );
      }
      setSaveError(null);
      setLastSavedAt(Date.now());
      setLastSaveSource(source);
    })();

    saveInFlightRef.current = request;
    try {
      await request;
    } finally {
      if (saveInFlightRef.current === request) {
        saveInFlightRef.current = null;
      }
    }
  }, [createRemote, applyServerVersion]);

  const saveRemote = useCallback(async (docOverride?: DocumentInput): Promise<void> => {
    await doRemoteSave('manual', docOverride);
  }, [doRemoteSave]);

  /**
   * Give the open document a server id, creating it if it does not have one.
   *
   * Everything the assistant does is addressed by document id: the agent reads
   * and edits `document_id`, and a chat session is stored against it. A draft
   * that exists only in this browser therefore has nothing to talk about — the
   * old behaviour was to refuse and tell the author to save first, which is a
   * chore in the middle of a sentence they are asking for help with.
   *
   * Concurrent callers share one creation. Returning `null` means the document
   * could not be created, which the caller reports; it never throws past here
   * because the writing surface stays usable either way.
   */
  const attachInFlightRef = useRef<Promise<string | null> | null>(null);
  const ensureRemoteDocument = useCallback(async (): Promise<string | null> => {
    if (documentIdRef.current) return documentIdRef.current;
    if (attachInFlightRef.current) return attachInFlightRef.current;

    const request = (async () => {
      try {
        return await createRemote();
      } catch (error) {
        setSaveError(describeSaveError(error));
        return null;
      }
    })();

    attachInFlightRef.current = request;
    try {
      return await request;
    } finally {
      if (attachInFlightRef.current === request) attachInFlightRef.current = null;
    }
  }, [createRemote]);

  const loadRemoteForRequest = useCallback(async (
    id: string,
    requestToken: number,
  ): Promise<boolean> => {
    // A newer transition can supersede this one while it is waiting for a dirty
    // save to flush. Do not start an obsolete GET afterward.
    if (requestToken !== documentRequestRef.current) return false;

    let fetched: Doc;
    const controller = new AbortController();
    documentLoadControllerRef.current = controller;
    try {
      fetched = await apiLoadDocument(id, { signal: controller.signal });
    } catch (error) {
      // Callers surface only the latest failure. An older request failing after
      // the author has moved on is no longer actionable.
      if (requestToken !== documentRequestRef.current || controller.signal.aborted) return false;
      throw error;
    }
    if (requestToken !== documentRequestRef.current || controller.signal.aborted) return false;

    // Self-heal documents saved before html/children were kept in step, so an
    // old orphan does not keep failing the agent's edits forever.
    const loaded: Doc = { ...fetched, blocks: reconcileBlocks(fetched.blocks) };
    startDocumentSession();
    commitDoc(loaded);
    editRevisionRef.current = 0;
    persistedRevisionRef.current = 0;
    setDirtyTick(0);
    setDocumentId(id);
    documentIdRef.current = id;
    loadedForIdRef.current = id;
    versionRef.current = loaded.version ?? 1;
    setSaveError(null);
    setActiveId(null);
    setOpenMenuBlockId(null);
    setOpenMenuType(null);
    return true;
  }, [startDocumentSession, commitDoc]);

  const loadRemote = useCallback(async (id: string): Promise<boolean> => {
    if (id === documentIdRef.current && loadingDocumentIdRef.current === null) return true;
    if (id === loadingDocumentIdRef.current) return false;
    const requestToken = beginDocumentTransition(id);
    try {
      return await loadRemoteForRequest(id, requestToken);
    } catch (error) {
      if (requestToken === documentRequestRef.current) {
        reportDocumentLoadFailure(error);
      }
      throw error;
    } finally {
      finishDocumentTransition(requestToken);
    }
  }, [beginDocumentTransition, loadRemoteForRequest, reportDocumentLoadFailure, finishDocumentTransition]);

  const hydrateRemote = useEffectEvent(
    (id: string, requestToken: number) => loadRemoteForRequest(id, requestToken),
  );
  const autoSave = useEffectEvent(() => doRemoteSave('auto'));
  const autoSaveRetryRef = useRef(0);
  const autoSaveAttempt = useEffectEvent(async function attemptAutoSave() {
    isAutoSavingRef.current = true;
    setIsAutoSaving(true);
    try {
      await autoSave();
      autoSaveRetryRef.current = 0;
    } catch (error) {
      setSaveError(describeSaveError(error));
      // A transient failure used to leave the server stale until the next
      // keystroke. Retry with capped backoff (15s, 30s, 60s); a new edit
      // re-arms the normal debounce via `dirtyTick` and resets the backoff.
      if (editRevisionRef.current > persistedRevisionRef.current) {
        const attempt = autoSaveRetryRef.current++;
        const delay = Math.min(15000 * 2 ** attempt, 60000);
        autoSaveTimerRef.current = window.setTimeout(() => {
          autoSaveTimerRef.current = null;
          void attemptAutoSave();
        }, delay);
      }
    } finally {
      isAutoSavingRef.current = false;
      setIsAutoSaving(false);
    }
  });

  // Hydrate from the server on mount. The cached draft is a fallback for going
  // offline, not a source of truth: adopting it unconditionally meant a stale
  // (or another account's) body could be saved over the real document.
  useEffect(() => {
    const id = initialRequestedDocumentId;
    if (!id) return;

    let cancelled = false;
    const hydrationToken = 0;
    void hydrateRemote(id, hydrationToken)
      .catch((error) => {
        if (!cancelled && hydrationToken === documentRequestRef.current) {
          // The committed state was selected synchronously from a body keyed to
          // its own id, so failure only has to reveal it again.
          reportDocumentLoadFailure(error, { mount: true });
        }
      })
      .finally(() => {
        if (!cancelled && hydrationToken === documentRequestRef.current) {
          finishDocumentTransition(hydrationToken);
        }
      });
    return () => {
      cancelled = true;
      if (hydrationToken === documentRequestRef.current) {
        documentLoadControllerRef.current?.abort();
        documentLoadControllerRef.current = null;
      }
    };
    // Mount only: later document switches go through loadRemote/switchTo.
    // The two transition helpers are stable callbacks; listing them does not
    // re-arm the effect.
  }, [initialRequestedDocumentId, reportDocumentLoadFailure, finishDocumentTransition]);

  // Debounced remote auto-save (5 seconds after last change).
  // Keyed on `dirtyTick` rather than `doc` so adopting a server version does
  // not count as a change and re-arm the timer.
  useEffect(() => {
    if (
      hasAnyRemoteDocs === null
      || loadingDocumentId !== null
      || dirtyTick === 0
      || editRevisionRef.current <= persistedRevisionRef.current
    ) {
      return;
    }

    if (autoSaveTimerRef.current !== null) {
      clearTimeout(autoSaveTimerRef.current);
      autoSaveTimerRef.current = null;
    }

    if (hasAnyRemoteDocs === false && !documentId) return;

    // A new edit supersedes any pending retry and starts the backoff over.
    autoSaveRetryRef.current = 0;
    autoSaveTimerRef.current = window.setTimeout(() => {
      autoSaveTimerRef.current = null;
      void autoSaveAttempt();
    }, 5000);
    return () => {
      if (autoSaveTimerRef.current !== null) {
        clearTimeout(autoSaveTimerRef.current);
        autoSaveTimerRef.current = null;
      }
    };
  }, [dirtyTick, documentId, hasAnyRemoteDocs, loadingDocumentId]);

  /** Flush pending local edits, then switch to another document. */
  const switchTo = useCallback(async (
    id: string,
    options?: { source?: 'selection' | 'history' },
  ): Promise<boolean> => {
    if (id === documentIdRef.current && loadingDocumentIdRef.current === null) return true;
    // Duplicate activation is ignored without disabling the row, so focus stays
    // where the author put it and a different row can still supersede the load.
    if (id === loadingDocumentIdRef.current) return false;
    let requestToken = beginDocumentTransition(id);
    // Switching used to drop whatever had not hit the 5s autosave yet. The
    // assistant creating a document made that a routine occurrence. A draft
    // without a server id is flushed too — creating it remotely — where it
    // used to be silently abandoned in the local cache with no way back.
    if (
      editRevisionRef.current > persistedRevisionRef.current
      && (documentIdRef.current
        ? loadedForIdRef.current === documentIdRef.current
        : editRevisionRef.current > 0)
    ) {
      try {
        await doRemoteSave('auto');
      } catch (error) {
        // A failed flush must not block the switch — the error is already
        // retained in the keyed local draft, and the user asked to move on.
        if (requestToken === documentRequestRef.current) {
          setSaveError(describeSaveError(error));
        }
      }
      // Creating the draft remotely ran its own document transition, which
      // superseded this switch's token. Re-mark the pending switch before
      // loading; harmless when the flush kept the token all along.
      requestToken = beginDocumentTransition(id);
    }
    try {
      return await loadRemoteForRequest(id, requestToken);
    } catch (error) {
      if (requestToken === documentRequestRef.current) {
        reportDocumentLoadFailure(error, { source: options?.source });
      }
      throw error;
    } finally {
      finishDocumentTransition(requestToken);
    }
  }, [beginDocumentTransition, doRemoteSave, loadRemoteForRequest, reportDocumentLoadFailure, finishDocumentTransition]);

  const createAndSwitch = useCallback(async (input: DocumentInput): Promise<string> => {
    if (
      editRevisionRef.current > persistedRevisionRef.current
      && (documentIdRef.current || editRevisionRef.current > 0)
    ) {
      await doRemoteSave('auto');
    }

    const requestToken = beginDocumentTransition(null);
    const next = documentInputToDoc(input);
    const res = await apiCreateDocument(input);
    const adopted = { ...next, version: res.version ?? 1 };

    if (requestToken === documentRequestRef.current) {
      startDocumentSession();
      commitDoc(adopted);
      setDocumentId(res.document_id);
      documentIdRef.current = res.document_id;
      loadedForIdRef.current = res.document_id;
      versionRef.current = adopted.version;
      editRevisionRef.current = 0;
      persistedRevisionRef.current = 0;
      setDirtyTick(0);
      setLastSavedAt(Date.now());
      setLastSaveSource('manual');
      setSaveError(null);
      setActiveId(null);
      setOpenMenuBlockId(null);
      setOpenMenuType(null);
    }
    setHasAnyRemoteDocs(true);
    setDocumentListRevision(revision => revision + 1);
    return res.document_id;
  }, [doRemoteSave, beginDocumentTransition, startDocumentSession, commitDoc]);

  const deleteRemote = useCallback(async (id: string): Promise<void> => {
    const deletingActiveDocument = documentIdRef.current === id;
    const requestToken = deletingActiveDocument
      ? beginDocumentTransition(null)
      : documentRequestRef.current;
    // The open document's adopted version says exactly which state is being
    // deleted; for any other document the service presents the current ETag.
    await apiDeleteDocument(
      id,
      deletingActiveDocument ? { version: versionRef.current } : {},
    );
    if (
      deletingActiveDocument
      && requestToken === documentRequestRef.current
      && documentIdRef.current === id
    ) {
      newLocal();
    }
    setDocumentListRevision(revision => revision + 1);
    try {
      const res = await apiListDocuments({ page: 1, limit: 1 });
      setHasAnyRemoteDocs((res.count || 0) > 0);
    } catch {
      // On error, leave the previous value; UX will rely on existing state.
    }
  }, [beginDocumentTransition, newLocal]);

  const listRemote = useCallback(
    (
      options: DocumentListOptions = {},
      init?: { signal?: AbortSignal },
    ): Promise<DocumentListResult> => apiListDocuments(options, init),
    [],
  );

  // `docRef` rather than a `doc` closure: the JSON must be of the document as
  // it is at call time, and closing over state would make the action change
  // identity on every edit.
  const getJSON = useCallback(() => JSON.stringify(docRef.current, null, 2), []);
  const setFromJSON = useCallback((json: string) => {
    const parsed = JSON.parse(json);
    if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.blocks)) throw new Error('Invalid JSON structure');
    // Every block must survive the same coercion as wire data. The old cast
    // let an unknown block type reach the canvas, where it rendered as an
    // empty row the author could not select, edit, or delete.
    const blocks: Block[] = [];
    for (const raw of parsed.blocks) {
      const block = coerceBlock(raw);
      if (!block) throw new Error('Invalid block in JSON');
      blocks.push(block);
    }
    const next: Doc = {
      version: typeof parsed.version === 'number' ? parsed.version : 1,
      name: typeof parsed.name === 'string' ? parsed.name : undefined,
      blocks,
    };
    mutateDoc(() => next);
  }, [mutateDoc]);

  /**
   * Apply agent tool operations in a single pass.
   *
   * `persist: true` is the accept path — the operation exists nowhere but this
   * browser until autosave runs, so it has to arm the timer like any other
   * edit. `persist: false` is a replay of something the server already holds
   * and deliberately leaves the document clean.
   *
   * Ops that cannot be applied against the local copy are reported back so the
   * caller can say the two have diverged, rather than silently putting content
   * somewhere the agent never asked for.
   */
  const applyPatch = useCallback((
    ops: ToolOperation[],
    options?: { persist?: boolean; base?: Block[] },
  ): ApplyPatchResult => {
    if (loadingDocumentIdRef.current !== null) {
      return { blocks: docRef.current.blocks, desynced: ops, touched: [], stale: true };
    }

    // Computed against the ref rather than inside a `setState` updater. The
    // caller needs `touched` to highlight what moved and `desynced` to say the
    // two copies have diverged, and React runs an updater when it pleases —
    // both used to come back empty for anything but the first update in a tick.
    const base = docRef.current;

    // A caller that computed a plan (positions, absolute indexes) against a
    // rendered snapshot tags it with `base`. If the document moved since —
    // the author kept typing between render and click — replaying that plan
    // could half-apply, so refuse atomically and hand back the live blocks
    // for one recompute-and-retry.
    if (options?.base !== undefined && base.blocks !== options.base) {
      return { blocks: base.blocks, desynced: ops, touched: [], stale: true };
    }

    const outcome = applyPatchToBlocks(base.blocks, ops);

    let nextDoc: Doc = { ...base, blocks: outcome.blocks };
    for (const op of ops) {
      if (op.op === 'update_meta' && op.meta?.name) {
        nextDoc = { ...nextDoc, name: op.meta.name };
      }
    }

    if (options?.persist) mutateDoc(() => nextDoc);
    else commitDoc(nextDoc);

    return outcome;
  }, [mutateDoc, commitDoc]);

  /**
   * Blocks an accepted change just landed on.
   *
   * Accepting from the review bar can change text far off screen; without a
   * lingering highlight the author has no way to see what moved.
   */
  const [recentlyChanged, setRecentlyChanged] = useState<ReadonlySet<string>>(() => new Set());
  const recentlyChangedTimer = useRef<number | null>(null);

  const markRecentlyChanged = useCallback((ids: string[]) => {
    if (ids.length === 0) return;
    setRecentlyChanged(new Set(ids));
    if (recentlyChangedTimer.current !== null) clearTimeout(recentlyChangedTimer.current);
    recentlyChangedTimer.current = window.setTimeout(() => {
      setRecentlyChanged(new Set());
      recentlyChangedTimer.current = null;
    }, 4000);
  }, []);

  useEffect(() => () => {
    if (recentlyChangedTimer.current !== null) clearTimeout(recentlyChangedTimer.current);
  }, []);

  /**
   * Walk the document back or forward one journaled state.
   *
   * The replay goes through `mutateDoc` so it dirties the revision and arms
   * autosave like any edit; `applyingHistoryRef` keeps the replay itself out
   * of the journal. `Editable` rebases an active block whose state changed
   * underneath it, so the canvas follows the walk without extra wiring.
   */
  const undo = useCallback(() => {
    const entry = historyRef.current.undo.pop();
    if (!entry) return;
    historyRef.current.redo.push(entry);
    applyingHistoryRef.current = true;
    try {
      mutateDoc(() => entry.before);
    } finally {
      applyingHistoryRef.current = false;
    }
  }, [mutateDoc]);

  const redo = useCallback(() => {
    const entry = historyRef.current.redo.pop();
    if (!entry) return;
    historyRef.current.undo.push(entry);
    applyingHistoryRef.current = true;
    try {
      mutateDoc(() => entry.after);
    } finally {
      applyingHistoryRef.current = false;
    }
  }, [mutateDoc]);

  // Another document's history is meaningless here, and a restore replaces
  // the tree wholesale — walking back across it would resurrect text the
  // server has already moved past.
  useEffect(() => {
    historyRef.current = { undo: [], redo: [] };
  }, [documentSessionId, restoreEpoch]);

  const save = useCallback(() => {
    if (loadingDocumentIdRef.current !== null) return;
    // Refs rather than state closures: the save must describe the document as
    // it is at call time, and closing over `doc`/`documentId` would make this
    // action change identity on every edit.
    saveDoc(docRef.current, documentIdRef.current);
    saveDocumentId(documentIdRef.current);
    // Ctrl+S must mean what the header shows: a save the server actually
    // received. Writing only the local cache here used to flash "Saved" while
    // the server copy stayed stale until the next autosave.
    const shouldPersistRemote =
      documentIdRef.current !== null ||
      (hasAnyRemoteDocsRef.current !== false &&
        editRevisionRef.current > persistedRevisionRef.current);
    if (shouldPersistRemote) {
      void doRemoteSave('manual').catch((error) => setSaveError(describeSaveError(error)));
      return;
    }
    setLastSavedAt(Date.now());
    setLastSaveSource('manual');
  }, [doRemoteSave]);

  const hasPendingEditsNow = useCallback(() => (
    editRevisionRef.current > persistedRevisionRef.current
    || autoSaveTimerRef.current !== null
    || isAutoSavingRef.current
  ), []);

  /**
   * Block order at call time, for event handlers that need it without
   * subscribing to `blocks` (an editable's arrow-key neighbour walk).
   */
  const getBlockIds = useCallback(() => docRef.current.blocks.map(b => b.id), []);

  const savedHeadSeq = useCallback(() => (documentIdRef.current ? versionRef.current : null), []);
  const clearSaveError = useCallback(() => setSaveError(null), []);
  const clearDocumentLoadNotice = useCallback(() => setDocumentLoadNotice(null), []);

  // Numbering, ordering and back-links are all derived from the same scan, so
  // it happens once here rather than inside each citation widget.
  //
  // `blocks` gets a new identity on every keystroke, which used to re-run the
  // whole scan just as often. The fingerprint captures exactly the fields the
  // scan reads, so the rebuild only happens when a citation actually changes.
  const bibliographyFingerprint = useMemo(() => citationFingerprint(blocks), [blocks]);
  const bibliography = useMemo(
    () => buildBibliography(blocks),
    // The fingerprint stands in for `blocks`: identical fingerprint means
    // identical scan inputs, hence an identical bibliography.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [bibliographyFingerprint],
  );

  /**
   * The context is split so a keystroke re-renders only what renders document
   * state. Every action closes over refs or stable setters, which keeps this
   * value referentially stable across edits; consumers that only dispatch —
   * the per-block editables most of all — subscribe to it alone and skip the
   * per-keystroke render entirely.
   */
  const actionsValue: EditorActionsContextValue = useMemo(() => ({
    refs,
    registerEditable,
    setActive: setActiveId,
    setBlockMenu,
    setDocMeta,
    setDocName,
    addBlockAtStart,
    addBlockAfter,
    addBlockBefore,
    insertBlockAtStartExact,
    insertBlockAfterExact,
    insertBlockBeforeExact,
    appendBlockExact,
    moveBlock,
    reorderBlock,
    splitBlock,
    mergeWithPrevious,
    removeBlock,
    updateHtml,
    setParagraphColumns,
    toggleAiHidden,
    toggleLocked,
    toggleCollapsed,
    addParagraphChild,
    updateParagraphChild,
    removeParagraphChild,
    setHeadingLevel,
    exec,
    getBlockIds,
    getJSON,
    setFromJSON,
    save,
    undo,
    redo,
    newLocal,
    getExportSnapshot,
    createRemote,
    createAndSwitch,
    ensureRemoteDocument,
    saveRemote,
    loadRemote,
    switchTo,
    deleteRemote,
    listRemote,
    hasPendingEdits: hasPendingEditsNow,
    savedHeadSeq,
    clearSaveError,
    clearDocumentLoadNotice,
    adoptServerVersion,
    adoptRestoredDocument,
    applyPatch,
    markRecentlyChanged,
  }), [
    registerEditable,
    setBlockMenu,
    setDocMeta,
    setDocName,
    addBlockAtStart,
    addBlockAfter,
    addBlockBefore,
    insertBlockAtStartExact,
    insertBlockAfterExact,
    insertBlockBeforeExact,
    appendBlockExact,
    moveBlock,
    reorderBlock,
    splitBlock,
    mergeWithPrevious,
    removeBlock,
    updateHtml,
    setParagraphColumns,
    toggleAiHidden,
    toggleLocked,
    toggleCollapsed,
    addParagraphChild,
    updateParagraphChild,
    removeParagraphChild,
    setHeadingLevel,
    exec,
    getBlockIds,
    getJSON,
    setFromJSON,
    save,
    undo,
    redo,
    newLocal,
    getExportSnapshot,
    createRemote,
    createAndSwitch,
    ensureRemoteDocument,
    saveRemote,
    loadRemote,
    switchTo,
    deleteRemote,
    listRemote,
    hasPendingEditsNow,
    savedHeadSeq,
    clearSaveError,
    clearDocumentLoadNotice,
    adoptServerVersion,
    adoptRestoredDocument,
    applyPatch,
    markRecentlyChanged,
  ]);

  const stateValue: EditorStateContextValue = useMemo(() => ({
    doc,
    blocks,
    documentId,
    documentSessionId,
    loadingDocumentId,
    activeId,
    openMenuBlockId,
    openMenuType,
    documentListRevision,
    lastSavedAt,
    isAutoSaving,
    lastSaveSource,
    saveError,
    documentLoadNotice,
    restoreEpoch,
    hasAnyRemoteDocs,
    recentlyChanged,
  }), [
    doc,
    blocks,
    documentId,
    documentSessionId,
    loadingDocumentId,
    activeId,
    openMenuBlockId,
    openMenuType,
    documentListRevision,
    lastSavedAt,
    isAutoSaving,
    lastSaveSource,
    saveError,
    documentLoadNotice,
    restoreEpoch,
    hasAnyRemoteDocs,
    recentlyChanged,
  ]);

  // Focus moves are rare next to keystrokes, so the one piece of state an
  // editable needs reactively gets its own context: subscribing to the full
  // state value would re-render every editable on every edit.
  const activeBlockValue: EditorActiveBlockContextValue = useMemo(() => ({
    activeId,
    setActive: setActiveId,
  }), [activeId]);

  return (
    <EditorContext.Provider value={stateValue}>
      <EditorActionsContext.Provider value={actionsValue}>
        <EditorActiveBlockContext.Provider value={activeBlockValue}>
          <BibliographyContext.Provider value={bibliography}>{children}</BibliographyContext.Provider>
        </EditorActiveBlockContext.Provider>
      </EditorActionsContext.Provider>
    </EditorContext.Provider>
  );
}
