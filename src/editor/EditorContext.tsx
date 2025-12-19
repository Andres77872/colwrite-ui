import { createContext, useContext, useEffect, useRef, useState, type MutableRefObject, type ReactNode } from 'react';
import type { Block, Doc, ParagraphChild } from './types';
import { loadDoc, saveDoc, loadDocumentId, saveDocumentId } from './storage';
import { createDocument as apiCreateDocument, saveDocument as apiSaveDocument, loadDocument as apiLoadDocument, deleteDocument as apiDeleteDocument, listDocuments as apiListDocuments } from '../services';
import { uid } from '../lib/uid';

export type EditorContextValue = {
  doc: Doc;
  blocks: Block[];
  refs: MutableRefObject<Record<string, HTMLDivElement | null>>;
  documentId: string | null;
  activeId: string | null;
  setActive: (id: string | null) => void;
  // Global menu state - ensures only one block menu is open at a time
  openMenuBlockId: string | null;
  openMenuType: 'add' | 'options' | null;
  setBlockMenu: (blockId: string | null, type: 'add' | 'options' | null) => void;
  setDocMeta: (meta: Partial<Doc>) => void;
  setDocName: (name: string) => void;
  addBlockAtStart: (type: Block['type']) => string;
  addBlockAfter: (afterId: string, type: Block['type']) => string;
  // Exact placement helpers that preserve provided block IDs (used by AI patches)
  insertBlockAtStartExact: (block: Block) => void;
  insertBlockAfterExact: (afterId: string, block: Block) => void;
  insertBlockBeforeExact: (beforeId: string, block: Block) => void;
  appendBlockExact: (block: Block) => void;
  moveBlock: (id: string, dir: -1 | 1) => void;
  reorderBlock: (id: string, toIndex: number) => void;
  removeBlock: (id: string) => void;
  updateHtml: (id: string, html: string) => void;
  setParagraphColumns: (id: string, columns: number) => void;
  // Block meta toggles (visual-only; backend enforces behavior)
  toggleAiHidden: (id: string) => void;
  toggleLocked: (id: string) => void;
  toggleCollapsed: (id: string) => void;
  // Paragraph children helpers
  addParagraphChild: (blockId: string, child: ParagraphChild) => string;
  updateParagraphChild: (blockId: string, childId: string, next: Partial<ParagraphChild>) => void;
  removeParagraphChild: (blockId: string, childId: string) => void;
  setHeadingLevel: (id: string, level: 1 | 2 | 3) => void;
  exec: (cmd: string) => void;
  getJSON: () => string;
  setFromJSON: (json: string) => void;
  save: () => void; // local save
  newLocal: () => void; // create a fresh local document
  // API methods
  createRemote: (docOverride?: Doc | Block[] | (Partial<Doc> & Record<string, any>)) => Promise<string>;
  saveRemote: (docOverride?: Doc | Block[] | (Partial<Doc> & Record<string, any>)) => Promise<void>;
  loadRemote: (id: string) => Promise<void>;
  deleteRemote: (id: string) => Promise<void>;
  listRemote: (page?: number, limit?: number, query?: string) => Promise<{ documents: any[]; count: number }>; 
  lastSavedAt: number | null;
  isAutoSaving: boolean;
  lastSaveSource: 'auto' | 'manual' | null;
  // Remote document availability (null while loading)
  hasAnyRemoteDocs: boolean | null;
};

const EditorContext = createContext<EditorContextValue | null>(null);

export function EditorProvider({ children }: { children: ReactNode }) {
  const makeDefaultDoc = (): Doc => ({
    version: 1,
    name: 'Untitled document',
    blocks: [
      { id: uid(), type: 'heading', level: 2, html: 'Your document' },
      { id: uid(), type: 'paragraph', html: 'Write something here. Select text to format. Use the + to insert blocks.', children: [], columns: 1 },
    ],
  });

  const [doc, setDoc] = useState<Doc>(() => loadDoc() ?? makeDefaultDoc());
  const blocks = doc.blocks;
  const refs = useRef<Record<string, HTMLDivElement | null>>({});
  const [lastSavedAt, setLastSavedAt] = useState<number | null>(null);
  const [documentId, setDocumentId] = useState<string | null>(() => loadDocumentId());
  const [activeId, setActiveId] = useState<string | null>(null);
  const [isAutoSaving, setIsAutoSaving] = useState<boolean>(false);
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

  // Auto-save
  useEffect(() => {
    const raf = requestAnimationFrame(() => saveDoc(doc));
    return () => cancelAnimationFrame(raf);
  }, [doc]);

  // Debounced remote auto-save (5 seconds after last change)
  useEffect(() => {
    // Wait until we know whether the account has any remote documents
    // to avoid auto-creating the first document without an explicit user action.
    if (hasAnyRemoteDocs === null) return;

    if (autoSaveTimerRef.current !== null) {
      clearTimeout(autoSaveTimerRef.current);
      autoSaveTimerRef.current = null;
    }

    // If there are no remote documents yet and this session has no documentId,
    // don't schedule an autosave that would auto-create the first document.
    if (hasAnyRemoteDocs === false && !documentId) return;

    autoSaveTimerRef.current = window.setTimeout(async () => {
      setIsAutoSaving(true);
      try {
        await doRemoteSave('auto');
      } catch {
        // ignore autosave errors for now; manual save remains available
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
  }, [doc, hasAnyRemoteDocs, documentId]);

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

  // One-time migration: convert inline AIBeat markup embedded in paragraph HTML
  // into paragraph children and placeholder spans.
  useEffect(() => {
    setDoc(prev => {
      try {
        const migratedBlocks = prev.blocks.map((b) => {
          if (b.type !== 'paragraph') return b;
          if ((b.html || '').includes('data-child-id')) return b; // already migrated
          if (!/(ai-beat-widget)/.test(b.html || '')) return b;
          const container = document.createElement('div');
          container.innerHTML = b.html || '';
          const children: ParagraphChild[] = Array.isArray((b as any).children) ? ([...(b as any).children] as ParagraphChild[]) : [];
          const widgets = Array.from(container.querySelectorAll('.ai-beat-widget')) as HTMLElement[];
          for (const el of widgets) {
            const id = uid();
            const output = (el.querySelector('.ai-beat-output')?.textContent || '').trim();
            const collapsed = el.getAttribute('data-collapsed') === '1';
            const placeholder = document.createElement('span');
            placeholder.setAttribute('data-child-id', id);
            placeholder.setAttribute('contenteditable', 'false');
            el.replaceWith(placeholder);
            children.push({ id, type: 'aiBeat', message: '', prompt: '', output, collapsed });
          }
          return { ...b, html: container.innerHTML, children } as Block;
        });
        return { ...prev, blocks: migratedBlocks };
      } catch { return prev; }
    });
  }, []);

  const setBlocks = (updater: (prev: Block[]) => Block[]) => setDoc(d => ({ ...d, blocks: updater(d.blocks) }));

  const setDocMeta = (meta: Partial<Doc>) => setDoc(prev => ({ ...prev, ...meta }));
  const setDocName = (name: string) => setDocMeta({ name });

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
    const b = prev[idx] as any;
    if (b.html === html) return prev;
    const out = prev.slice();
    out[idx] = { ...b, html } as Block;
    return out;
  });

  const setParagraphColumns = (id: string, columns: number) => setBlocks(prev => prev.map(b => (
    b.id === id && b.type === 'paragraph'
      ? ({ ...(b as any), columns: Math.max(1, Math.min(6, Math.floor(columns || 1))) })
      : b
  )));

  // Generic helper to toggle a boolean meta key on any block
  const toggleMeta = (id: string, key: 'aiHidden' | 'locked' | 'collapsed') => setBlocks(prev => prev.map(b => (
    b.id === id ? ({ ...(b as any), [key]: !((b as any)[key] ?? false) }) : b
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
      const blk = prev[bIndex] as any;
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
      return { ...(b as any), children: filtered } as Block;
    }));
  };

  const setHeadingLevel = (id: string, level: 1 | 2 | 3) => setBlocks(prev => prev.map(b => (
    b.id === id && b.type === 'heading' ? ({ ...b, level }) : b
  )));

  const exec = (cmd: string) => document.execCommand(cmd, false);

  const newLocal = () => {
    setDoc(makeDefaultDoc());
    setDocumentId(null);
    setLastSavedAt(null);
  };

  // API-backed persistence
  const createRemote = async (docOverride?: Doc | Block[] | (Partial<Doc> & Record<string, any>)): Promise<string> => {
    const payload = docOverride ?? doc;
    const res = await apiCreateDocument(payload);
    setDocumentId(res.document_id);
    setHasAnyRemoteDocs(true);
    return res.document_id;
  };

  // Internal helper to centralize remote saves and mark source
  const doRemoteSave = async (source: 'auto' | 'manual', docOverride?: Doc | Block[] | (Partial<Doc> & Record<string, any>)): Promise<void> => {
    // Cancel any pending autosave timer to avoid duplicate saves
    if (autoSaveTimerRef.current !== null) {
      clearTimeout(autoSaveTimerRef.current);
      autoSaveTimerRef.current = null;
    }
    const payload = docOverride ?? doc;
    if (!documentId) {
      const id = await createRemote(payload as any);
      setDocumentId(id);
    } else {
      await apiSaveDocument(documentId, payload as any);
    }
    setLastSavedAt(Date.now());
    setLastSaveSource(source);
  };

  const saveRemote = async (docOverride?: Doc | Block[] | (Partial<Doc> & Record<string, any>)): Promise<void> => {
    await doRemoteSave('manual', docOverride);
  };

  const loadRemote = async (id: string): Promise<void> => {
    const loaded = await apiLoadDocument(id);
    setDoc(loaded);
    setDocumentId(id);
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

  const listRemote = async (page = 1, limit = 10, query?: string): Promise<{ documents: any[]; count: number }> => {
    const res = await apiListDocuments(page, limit, query);
    return { documents: res.documents || [], count: res.count || 0 };
  };

  const getJSON = () => JSON.stringify(doc, null, 2);
  const setFromJSON = (json: string) => {
    const parsed = JSON.parse(json);
    if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.blocks)) throw new Error('Invalid JSON structure');
    setDoc(parsed as Doc);
  };

  const save = () => {
    saveDoc(doc);
    saveDocumentId(documentId);
    setLastSavedAt(Date.now());
  };

  const value: EditorContextValue = {
    doc,
    blocks,
    refs,
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
    deleteRemote,
    listRemote,
    lastSavedAt,
    isAutoSaving,
    lastSaveSource,
    hasAnyRemoteDocs,
  };

  return <EditorContext.Provider value={value}>{children}</EditorContext.Provider>;
}

export function useEditor(): EditorContextValue {
  const ctx = useContext(EditorContext);
  if (!ctx) throw new Error('useEditor must be used within EditorProvider');
  return ctx;
}
