import { useEffect, useEffectEvent, useRef, useState, type ReactNode } from 'react';
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
import type { DocumentInput, DocumentSummary } from '../services';
import { uid } from '../lib/uid';
import { EditorContext, type EditorContextValue } from './editorContextState';
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

export function EditorProvider({ children }: { children: ReactNode }) {
  const [doc, setDoc] = useState<Doc>(
    () => migrateLegacyInlineAiBeats(loadDoc() ?? makeDefaultDoc()),
  );
  const blocks = doc.blocks;
  const refs = useRef<Record<string, HTMLDivElement | null>>({});
  const registerEditable = (id: string, element: HTMLDivElement | null) => {
    refs.current[id] = element;
  };
  const [lastSavedAt, setLastSavedAt] = useState<number | null>(null);
  const [documentId, setDocumentId] = useState<string | null>(() => loadDocumentId());
  const [activeId, setActiveId] = useState<string | null>(null);
  const [isAutoSaving, setIsAutoSaving] = useState<boolean>(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  // Saves are optimistically locked on the version. The authoritative value
  // lives in a ref rather than in `doc`, because adopting a new version has to
  // NOT look like a content change — `doc` is an autosave dependency, so
  // writing the version back into it would re-arm the timer and the editor
  // would save itself forever.
  const versionRef = useRef<number>(doc.version ?? 1);

  // Bumped only by real content edits; this is what arms the autosave timer.
  const [dirtyTick, setDirtyTick] = useState(0);

  // True until the mount-time server fetch settles. Autosave stays disarmed
  // meanwhile so a cached draft cannot be written back before we know what the
  // server actually holds.
  const [isHydrating, setIsHydrating] = useState<boolean>(() => loadDocumentId() !== null);

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
  // Global menu state - only one block menu open at a time
  const [openMenuBlockId, setOpenMenuBlockId] = useState<string | null>(null);
  const [openMenuType, setOpenMenuType] = useState<'add' | 'options' | null>(null);
  
  const setBlockMenu = (blockId: string | null, type: 'add' | 'options' | null) => {
    setOpenMenuBlockId(blockId);
    setOpenMenuType(type);
  };
  const [lastSaveSource, setLastSaveSource] = useState<'auto' | 'manual' | null>(null);
  const autoSaveTimerRef = useRef<number | null>(null);
  const [hasAnyRemoteDocs, setHasAnyRemoteDocs] = useState<boolean | null>(null);

  // Local draft cache, keyed by the document it belongs to.
  useEffect(() => {
    const raf = requestAnimationFrame(() => saveDoc(doc, documentId));
    return () => cancelAnimationFrame(raf);
  }, [doc, documentId]);

  // Persist current document id
  useEffect(() => {
    saveDocumentId(documentId);
  }, [documentId]);

  // Determine whether the account has any remote documents to tailor
  // the initial Canvas experience and gate autosave behavior.
  useEffect(() => {
    let canceled = false;
    (async () => {
      try {
        const res = await apiListDocuments(1, 1);
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
    setDoc(updater);
    setDirtyTick(tick => tick + 1);
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
  const adoptServerVersion = (version: number | undefined | null) => {
    if (typeof version !== 'number' || Number.isNaN(version)) return;
    versionRef.current = version;
    setDoc(prev => (prev.version === version ? prev : { ...prev, version }));
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
    const next = makeDefaultDoc();
    setDoc(next);
    docRef.current = next;
    setDirtyTick(0);
    setDocumentId(null);
    documentIdRef.current = null;
    loadedForIdRef.current = null;
    versionRef.current = 1;
    setLastSavedAt(null);
    setSaveError(null);
  };

  // API-backed persistence
  const createRemote = async (docOverride?: DocumentInput): Promise<string> => {
    const payload = docOverride ?? docRef.current;
    const res = await apiCreateDocument(payload);
    setDocumentId(res.document_id);
    documentIdRef.current = res.document_id;
    loadedForIdRef.current = res.document_id;
    versionRef.current = res.version ?? 1;
    setHasAnyRemoteDocs(true);
    setSaveError(null);
    return res.document_id;
  };

  // Internal helper to centralize remote saves and mark source
  const doRemoteSave = async (source: 'auto' | 'manual', docOverride?: DocumentInput): Promise<void> => {
    // Cancel any pending autosave timer to avoid duplicate saves
    if (autoSaveTimerRef.current !== null) {
      clearTimeout(autoSaveTimerRef.current);
      autoSaveTimerRef.current = null;
    }
    const targetId = documentIdRef.current;
    const base = docOverride ?? docRef.current;

    if (!targetId) {
      await createRemote(base);
      setLastSavedAt(Date.now());
      setLastSaveSource(source);
      return;
    }

    // Never write the in-state body to a document it did not come from. The id
    // and the body are separate state, and they disagree for a moment while
    // switching documents — long enough for a queued autosave to land.
    if (!docOverride && loadedForIdRef.current !== targetId) {
      return;
    }

    // Always lock on the version the server last confirmed, not the one
    // embedded in the (possibly much older) doc we are sending.
    const payload: DocumentInput = Array.isArray(base)
      ? { blocks: base, version: versionRef.current }
      : { ...base, version: versionRef.current };
    const res = await apiSaveDocument(targetId, payload);
    adoptServerVersion(res?.version);
    setSaveError(null);
    setLastSavedAt(Date.now());
    setLastSaveSource(source);
  };

  const saveRemote = async (docOverride?: DocumentInput): Promise<void> => {
    await doRemoteSave('manual', docOverride);
  };

  const loadRemote = async (id: string): Promise<void> => {
    const fetched = await apiLoadDocument(id);
    // Self-heal documents saved before html/children were kept in step, so an
    // old orphan does not keep failing the agent's edits forever.
    const loaded: Doc = { ...fetched, blocks: reconcileBlocks(fetched.blocks) };
    setDoc(loaded);
    setDirtyTick(0);
    setDocumentId(id);
    documentIdRef.current = id;
    docRef.current = loaded;
    loadedForIdRef.current = id;
    versionRef.current = loaded.version ?? 1;
    setSaveError(null);
  };

  const hydrateRemote = useEffectEvent((id: string) => loadRemote(id));
  const autoSave = useEffectEvent(() => doRemoteSave('auto'));

  // Hydrate from the server on mount. The cached draft is a fallback for going
  // offline, not a source of truth: adopting it unconditionally meant a stale
  // (or another account's) body could be saved over the real document.
  useEffect(() => {
    const id = documentIdRef.current;
    if (!id) return;

    let cancelled = false;
    void hydrateRemote(id)
      .catch(() => {
        // Keep the cached draft — it is at least known to belong to this id.
        if (!cancelled) {
          setSaveError('Could not reach the server; showing your last local copy.');
        }
      })
      .finally(() => {
        if (!cancelled) setIsHydrating(false);
      });
    return () => {
      cancelled = true;
    };
    // Mount only: later document switches go through loadRemote/switchTo.
  }, []);

  // Debounced remote auto-save (5 seconds after last change).
  // Keyed on `dirtyTick` rather than `doc` so adopting a server version does
  // not count as a change and re-arm the timer.
  useEffect(() => {
    if (hasAnyRemoteDocs === null || isHydrating || dirtyTick === 0) return;

    if (autoSaveTimerRef.current !== null) {
      clearTimeout(autoSaveTimerRef.current);
      autoSaveTimerRef.current = null;
    }

    if (hasAnyRemoteDocs === false && !documentId) return;

    autoSaveTimerRef.current = window.setTimeout(async () => {
      setIsAutoSaving(true);
      try {
        await autoSave();
      } catch (error) {
        setSaveError(describeSaveError(error));
      } finally {
        setIsAutoSaving(false);
      }
    }, 5000);
    return () => {
      if (autoSaveTimerRef.current !== null) {
        clearTimeout(autoSaveTimerRef.current);
        autoSaveTimerRef.current = null;
      }
    };
  }, [dirtyTick, documentId, hasAnyRemoteDocs, isHydrating]);

  /** Flush pending local edits, then switch to another document. */
  const switchTo = async (id: string): Promise<void> => {
    // Switching used to drop whatever had not hit the 5s autosave yet. The
    // assistant creating a document made that a routine occurrence.
    if (documentIdRef.current && loadedForIdRef.current === documentIdRef.current) {
      try {
        await doRemoteSave('auto');
      } catch {
        // A failed flush must not block the switch — the error is already
        // surfaced through saveError, and the user asked to move on.
      }
    }
    await loadRemote(id);
  };

  const deleteRemote = async (id: string): Promise<void> => {
    await apiDeleteDocument(id);
    if (documentId === id) setDocumentId(null);
    try {
      const res = await apiListDocuments(1, 1);
      setHasAnyRemoteDocs((res.count || 0) > 0);
    } catch {
      // On error, leave the previous value; UX will rely on existing state.
    }
  };

  const listRemote = async (page = 1, limit = 10, query?: string): Promise<{ documents: DocumentSummary[]; count: number }> => {
    const res = await apiListDocuments(page, limit, query);
    return { documents: res.documents || [], count: res.count || 0 };
  };

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
    saveDoc(doc);
    saveDocumentId(documentId);
    setLastSavedAt(Date.now());
  };

  const value: EditorContextValue = {
    doc,
    blocks,
    refs,
    registerEditable,
    documentId,
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
    createRemote,
    saveRemote,
    loadRemote,
    switchTo,
    deleteRemote,
    listRemote,
    lastSavedAt,
    isAutoSaving,
    lastSaveSource,
    saveError,
    clearSaveError: () => setSaveError(null),
    adoptServerVersion,
    hasAnyRemoteDocs,
    applyPatch,
    recentlyChanged,
    markRecentlyChanged,
  };

  return <EditorContext.Provider value={value}>{children}</EditorContext.Provider>;
}
