import { useCallback, useEffect, useEffectEvent, useRef, useState, type ReactNode } from 'react';
import type { Block, Doc, ParagraphChild, ToolOperation } from './types';
import { loadDoc, saveDoc, loadDocumentId, saveDocumentId } from './storage';
import {
  applyPatchToBlocks,
  describeSaveError,
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
import { EditorContext, type EditorContextValue } from './editorContextState';
import { serializeEditableHtml } from '@/components/common/Editable/editableHtml';
import { emitDocumentTransitionStart } from './documentTransition';
export type { EditorContextValue } from './editorContextState';

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
  const registerEditable = (id: string, element: HTMLDivElement | null) => {
    refs.current[id] = element;
  };
  const [lastSavedAt, setLastSavedAt] = useState<number | null>(null);
  const [documentId, setDocumentId] = useState<string | null>(initialDocumentId);
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
  const autoSaveTimerRef = useRef<number | null>(null);
  // Mirrors `isAutoSaving` for readers that run outside React's render cycle —
  // specifically the beforeunload guard, which has to answer "is there
  // unsaved work" synchronously at event time.
  const isAutoSavingRef = useRef(false);

  // Latest doc/id without waiting for a re-render. Callbacks captured by the
  // chat stream can outlive several renders, and saving from a stale closure
  // is how edits get silently reverted.
  const docRef = useRef(doc);
  const documentIdRef = useRef(documentId);
  useEffect(() => {
    docRef.current = doc;
    documentIdRef.current = documentId;
  }, [doc, documentId]);

  // Which document the in-state `doc` was actually loaded for. Without this a
  // PUT can write one document's body over another's — the id and the body are
  // separate pieces of state that briefly disagree while switching documents.
  const loadedForIdRef = useRef<string | null>(documentId);
  // All document loads share one sequence. A transition reserves its token
  // before doing any asynchronous work; only that token may later commit or
  // report a failure. Mount hydration owns token zero.
  const documentRequestRef = useRef(0);
  const documentLoadControllerRef = useRef<AbortController | null>(null);
  const beginDocumentTransition = (id: string | null) => {
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
  };
  const finishDocumentTransition = (requestToken: number) => {
    if (requestToken !== documentRequestRef.current) return;
    loadingDocumentIdRef.current = null;
    setLoadingDocumentId(null);
    documentLoadControllerRef.current = null;
  };
  const reportDocumentLoadFailure = (
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
  };
  // Global menu state - only one block menu open at a time
  const [openMenuBlockId, setOpenMenuBlockId] = useState<string | null>(null);
  const [openMenuType, setOpenMenuType] = useState<'add' | 'options' | null>(null);
  
  const setBlockMenu = (blockId: string | null, type: 'add' | 'options' | null) => {
    setOpenMenuBlockId(blockId);
    setOpenMenuType(type);
  };
  const [lastSaveSource, setLastSaveSource] = useState<'auto' | 'manual' | null>(null);

  /**
   * Capture the DOM-backed editable values synchronously before export.
   *
   * React state normally follows on the next frame. Export is user-initiated
   * and must include the character still visible under the caret even when
   * that state update has not committed yet.
   */
  const getExportSnapshot = (): {
    document: Doc;
    baseVersion: number;
    localRevision: number;
    dirty: boolean;
  } => {
    const document = structuredClone(doc);
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
  };

  const [hasAnyRemoteDocs, setHasAnyRemoteDocs] = useState<boolean | null>(null);

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
  const mutateDoc = (updater: (prev: Doc) => Doc) => {
    if (loadingDocumentIdRef.current !== null) return;
    editRevisionRef.current += 1;
    setDoc(updater);
    setDirtyTick(editRevisionRef.current);
  };

  const setBlocks = (updater: (prev: Block[]) => Block[]) =>
    mutateDoc(d => ({ ...d, blocks: updater(d.blocks) }));

  const setDocMeta = (meta: Partial<Doc>) => mutateDoc(prev => ({ ...prev, ...meta }));
  const setDocName = (name: string) => setDocMeta({ name });

  /**
   * Record the version the server now holds, without marking the doc dirty.
   *
   * Called after our own saves and after the assistant edits the document
   * server-side. Skipping this is what made every save after the first fail:
   * the client kept optimistically locking on the version it first loaded.
   */
  const applyServerVersion = (
    version: number | undefined | null,
    invalidateList: boolean,
  ) => {
    if (typeof version !== 'number' || Number.isNaN(version)) return;
    const changed = versionRef.current !== version;
    versionRef.current = version;
    setDoc(prev => (prev.version === version ? prev : { ...prev, version }));
    if (invalidateList && changed) {
      setDocumentListRevision(revision => revision + 1);
    }
  };

  const adoptServerVersion = (version: number | undefined | null) => {
    applyServerVersion(version, true);
  };

  const addBlockAtStart = (type: Block['type']): string => {
    const newId = uid();
    setBlocks(prev => {
      const next: Block =
        type === 'paragraph' ? { id: newId, type: 'paragraph', html: '', children: [], columns: 1 } :
        type === 'heading' ? { id: newId, type: 'heading', level: 2, html: '' } :
        { id: newId, type: 'divider' };
      return [next, ...prev];
    });
    return newId;
  };

  const addBlockAfter = (afterId: string, type: Block['type']): string => {
    const newId = uid();
    setBlocks(prev => {
      const idx = prev.findIndex(b => b.id === afterId);
      const next: Block =
        type === 'paragraph' ? { id: newId, type: 'paragraph', html: '', children: [], columns: 1 } :
        type === 'heading' ? { id: newId, type: 'heading', level: 2, html: '' } :
        { id: newId, type: 'divider' };
      const out = [...prev];
      out.splice(idx + 1, 0, next);
      return out;
    });
    return newId;
  };

  // --- Exact placement helpers (preserve provided id and full block data) ---
  const insertBlockAtStartExact = (block: Block) => setBlocks(prev => [block, ...prev]);
  const appendBlockExact = (block: Block) => setBlocks(prev => [...prev, block]);
  const insertBlockAfterExact = (afterId: string, block: Block) => setBlocks(prev => {
    const idx = prev.findIndex(b => b.id === afterId);
    const out = [...prev];
    if (idx === -1) {
      out.push(block);
    } else {
      out.splice(idx + 1, 0, block);
    }
    return out;
  });
  const insertBlockBeforeExact = (beforeId: string, block: Block) => setBlocks(prev => {
    const idx = prev.findIndex(b => b.id === beforeId);
    const out = [...prev];
    if (idx === -1) {
      out.unshift(block);
    } else {
      out.splice(idx, 0, block);
    }
    return out;
  });

  const moveBlock = (id: string, dir: -1 | 1) => setBlocks(prev => {
    const idx = prev.findIndex(b => b.id === id);
    if (idx < 0) return prev;
    const j = idx + dir;
    if (j < 0 || j >= prev.length) return prev;
    const out = [...prev];
    const [blk] = out.splice(idx, 1);
    out.splice(j, 0, blk);
    return out;
  });

  const reorderBlock = (id: string, toIndex: number) => setBlocks(prev => {
    const fromIndex = prev.findIndex(b => b.id === id);
    if (fromIndex < 0) return prev;
    const out = [...prev];
    const [blk] = out.splice(fromIndex, 1);
    const clamped = Math.max(0, Math.min(toIndex, out.length));
    out.splice(clamped, 0, blk);
    return out;
  });

  const removeBlock = (id: string) => setBlocks(prev => prev.filter(b => b.id !== id));

  const updateHtml = (id: string, html: string) => setBlocks(prev => {
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
  });

  const setParagraphColumns = (id: string, columns: number) => setBlocks(prev => prev.map(b => (
    b.id === id && b.type === 'paragraph'
      ? ({ ...b, columns: Math.max(1, Math.min(6, Math.floor(columns || 1))) })
      : b
  )));

  // Generic helper to toggle a boolean meta key on any block
  const toggleMeta = (id: string, key: 'aiHidden' | 'locked' | 'collapsed') => setBlocks(prev => prev.map(b => (
    b.id === id ? ({ ...b, [key]: !(b[key] ?? false) }) : b
  )));

  const toggleAiHidden = (id: string) => toggleMeta(id, 'aiHidden');
  const toggleLocked = (id: string) => toggleMeta(id, 'locked');
  const toggleCollapsed = (id: string) => toggleMeta(id, 'collapsed');

  const addParagraphChild: EditorContextValue['addParagraphChild'] = (blockId, child) => {
    setBlocks(prev => prev.map(b => {
      if (b.id !== blockId || b.type !== 'paragraph') return b;
      const children = Array.isArray(b.children) ? b.children.slice() : [];
      const exists = children.find(c => c.id === child.id);
      if (!exists) children.push(child);
      return { ...b, children } as Block;
    }));
    return child.id;
  };

  const updateParagraphChild: EditorContextValue['updateParagraphChild'] = (blockId, childId, next) => {
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
  };

  const removeParagraphChild: EditorContextValue['removeParagraphChild'] = (blockId, childId) => {
    setBlocks(prev => prev.map(b => {
      if (b.id !== blockId || b.type !== 'paragraph') return b;
      const existing = b.children || [];
      const filtered = existing.filter(c => c.id !== childId);
      if (filtered.length === existing.length) return b;
      return { ...b, children: filtered };
    }));
  };

  const setHeadingLevel = (id: string, level: 1 | 2 | 3) => setBlocks(prev => prev.map(b => (
    b.id === id && b.type === 'heading' ? ({ ...b, level }) : b
  )));

  const exec = (cmd: string) => document.execCommand(cmd, false);

  const newLocal = () => {
    const requestToken = beginDocumentTransition(null);
    const next = makeDefaultDoc();
    setDoc(next);
    docRef.current = next;
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
  };

  // API-backed persistence
  const createRemote = async (docOverride?: DocumentInput): Promise<string> => {
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
      setDoc(previous => (
        previous.version === version ? previous : { ...previous, version }
      ));
      setSaveError(null);
      setActiveId(null);
      setOpenMenuBlockId(null);
      setOpenMenuType(null);
    }
    setHasAnyRemoteDocs(true);
    setDocumentListRevision(revision => revision + 1);
    return res.document_id;
  };

  // Serialize saves so a switch can wait for an active autosave, then
  // re-check whether a newer edit still needs its own write.
  const doRemoteSave = async (source: 'auto' | 'manual', docOverride?: DocumentInput): Promise<void> => {
    // Cancel any pending autosave timer to avoid duplicate saves
    if (autoSaveTimerRef.current !== null) {
      clearTimeout(autoSaveTimerRef.current);
      autoSaveTimerRef.current = null;
    }
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
    if (!docOverride && loadedForIdRef.current !== targetId) {
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

      applyServerVersion(res?.version, false);
      persistedRevisionRef.current = Math.max(
        persistedRevisionRef.current,
        revisionAtStart,
      );
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
  };

  const saveRemote = async (docOverride?: DocumentInput): Promise<void> => {
    await doRemoteSave('manual', docOverride);
  };

  const loadRemoteForRequest = async (
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
    setDoc(loaded);
    editRevisionRef.current = 0;
    persistedRevisionRef.current = 0;
    setDirtyTick(0);
    setDocumentId(id);
    documentIdRef.current = id;
    docRef.current = loaded;
    loadedForIdRef.current = id;
    versionRef.current = loaded.version ?? 1;
    setSaveError(null);
    setActiveId(null);
    setOpenMenuBlockId(null);
    setOpenMenuType(null);
    return true;
  };

  const loadRemote = async (id: string): Promise<boolean> => {
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
  };

  const hydrateRemote = useEffectEvent(
    (id: string, requestToken: number) => loadRemoteForRequest(id, requestToken),
  );
  const autoSave = useEffectEvent(() => doRemoteSave('auto'));

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
  }, [initialRequestedDocumentId]);

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

    autoSaveTimerRef.current = window.setTimeout(async () => {
      autoSaveTimerRef.current = null;
      isAutoSavingRef.current = true;
      setIsAutoSaving(true);
      try {
        await autoSave();
      } catch (error) {
        setSaveError(describeSaveError(error));
      } finally {
        isAutoSavingRef.current = false;
        setIsAutoSaving(false);
      }
    }, 5000);
    return () => {
      if (autoSaveTimerRef.current !== null) {
        clearTimeout(autoSaveTimerRef.current);
        autoSaveTimerRef.current = null;
      }
    };
  }, [dirtyTick, documentId, hasAnyRemoteDocs, loadingDocumentId]);

  /** Flush pending local edits, then switch to another document. */
  const switchTo = async (
    id: string,
    options?: { source?: 'selection' | 'history' },
  ): Promise<boolean> => {
    if (id === documentIdRef.current && loadingDocumentIdRef.current === null) return true;
    // Duplicate activation is ignored without disabling the row, so focus stays
    // where the author put it and a different row can still supersede the load.
    if (id === loadingDocumentIdRef.current) return false;
    const requestToken = beginDocumentTransition(id);
    // Switching used to drop whatever had not hit the 5s autosave yet. The
    // assistant creating a document made that a routine occurrence.
    if (
      documentIdRef.current
      && loadedForIdRef.current === documentIdRef.current
      && editRevisionRef.current > persistedRevisionRef.current
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
  };

  const createAndSwitch = async (input: DocumentInput): Promise<string> => {
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
      setDoc(adopted);
      docRef.current = adopted;
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
  };

  const deleteRemote = async (id: string): Promise<void> => {
    const deletingActiveDocument = documentIdRef.current === id;
    const requestToken = deletingActiveDocument
      ? beginDocumentTransition(null)
      : documentRequestRef.current;
    await apiDeleteDocument(id);
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
  };

  const listRemote = useCallback(
    (
      options: DocumentListOptions = {},
      init?: { signal?: AbortSignal },
    ): Promise<DocumentListResult> => apiListDocuments(options, init),
    [],
  );

  const getJSON = () => JSON.stringify(doc, null, 2);
  const setFromJSON = (json: string) => {
    const parsed = JSON.parse(json);
    if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.blocks)) throw new Error('Invalid JSON structure');
    const next = parsed as Doc;
    mutateDoc(() => ({ ...next, blocks: reconcileBlocks(next.blocks) }));
  };

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
  const applyPatch = (
    ops: ToolOperation[],
    options?: { persist?: boolean },
  ): ApplyPatchResult => {
    if (loadingDocumentIdRef.current !== null) {
      return { blocks: docRef.current.blocks, desynced: ops, touched: [] };
    }
    let outcome: ApplyPatchResult = { blocks: [], desynced: [], touched: [] };

    const update = (prev: Doc): Doc => {
      outcome = applyPatchToBlocks(prev.blocks, ops);

      let nextDoc: Doc = { ...prev, blocks: outcome.blocks };
      for (const op of ops) {
        if (op.op === 'update_meta' && op.meta?.name) {
          nextDoc = { ...nextDoc, name: op.meta.name };
        }
      }
      return nextDoc;
    };

    if (options?.persist) mutateDoc(update);
    else setDoc(update);

    return outcome;
  };

  /**
   * Blocks an accepted change just landed on.
   *
   * Accepting from the review bar can change text far off screen; without a
   * lingering highlight the author has no way to see what moved.
   */
  const [recentlyChanged, setRecentlyChanged] = useState<ReadonlySet<string>>(() => new Set());
  const recentlyChangedTimer = useRef<number | null>(null);

  const markRecentlyChanged = (ids: string[]) => {
    if (ids.length === 0) return;
    setRecentlyChanged(new Set(ids));
    if (recentlyChangedTimer.current !== null) clearTimeout(recentlyChangedTimer.current);
    recentlyChangedTimer.current = window.setTimeout(() => {
      setRecentlyChanged(new Set());
      recentlyChangedTimer.current = null;
    }, 4000);
  };

  useEffect(() => () => {
    if (recentlyChangedTimer.current !== null) clearTimeout(recentlyChangedTimer.current);
  }, []);

  const save = () => {
    if (loadingDocumentIdRef.current !== null) return;
    saveDoc(doc, documentId);
    saveDocumentId(documentId);
    setLastSavedAt(Date.now());
  };

  const value: EditorContextValue = {
    doc,
    blocks,
    refs,
    registerEditable,
    documentId,
    loadingDocumentId,
    activeId,
    setActive: setActiveId,
    openMenuBlockId,
    openMenuType,
    setBlockMenu,
    setDocMeta,
    setDocName,
    addBlockAtStart,
    addBlockAfter,
    insertBlockAtStartExact,
    insertBlockAfterExact,
    insertBlockBeforeExact,
    appendBlockExact,
    moveBlock,
    reorderBlock,
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
    getJSON,
    setFromJSON,
    save,
    newLocal,
    getExportSnapshot,
    createRemote,
    createAndSwitch,
    saveRemote,
    loadRemote,
    switchTo,
    deleteRemote,
    listRemote,
    documentListRevision,
    lastSavedAt,
    isAutoSaving,
    hasPendingEdits: () => (
      editRevisionRef.current > persistedRevisionRef.current
      || autoSaveTimerRef.current !== null
      || isAutoSavingRef.current
    ),
    lastSaveSource,
    saveError,
    clearSaveError: () => setSaveError(null),
    documentLoadNotice,
    clearDocumentLoadNotice: () => setDocumentLoadNotice(null),
    adoptServerVersion,
    hasAnyRemoteDocs,
    applyPatch,
    recentlyChanged,
    markRecentlyChanged,
  };

  return <EditorContext.Provider value={value}>{children}</EditorContext.Provider>;
}
