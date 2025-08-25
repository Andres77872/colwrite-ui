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
  setDocMeta: (meta: Partial<Doc>) => void;
  setDocName: (name: string) => void;
  addBlockAtStart: (type: Block['type']) => string;
  addBlockAfter: (afterId: string, type: Block['type']) => string;
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
  // Generic block patch helpers for AI chat extras
  insertBlockAt: (block: Block, beforeOf?: string | null, afterOf?: string | null) => void;
  updateBlockFields: (blockId: string, fields: Partial<Block>) => void;
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

  // Auto-save
  useEffect(() => {
    const raf = requestAnimationFrame(() => saveDoc(doc));
    return () => cancelAnimationFrame(raf);
  }, [doc]);

  // Persist current document id
  useEffect(() => {
    saveDocumentId(documentId);
  }, [documentId]);

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

  // Insert a fully-formed block at a specific position. If beforeOf is provided,
  // insert before that id; else if afterOf is provided, insert after that id; otherwise append.
  // If a block with the same id already exists, do nothing to keep operation idempotent.
  const insertBlockAt = (block: Block, beforeOf?: string | null, afterOf?: string | null) => setBlocks(prev => {
    if (!block || typeof (block as any).id !== 'string') return prev;
    if (prev.some(b => b.id === (block as any).id)) return prev; // idempotent insert
    const out = prev.slice();
    // Determine target index
    if (typeof beforeOf === 'string') {
      const idx = out.findIndex(b => b.id === beforeOf);
      if (idx >= 0) { out.splice(idx, 0, block); return out; }
    }
    if (typeof afterOf === 'string') {
      const idx = out.findIndex(b => b.id === afterOf);
      if (idx >= 0) { out.splice(idx + 1, 0, block); return out; }
    }
    out.push(block);
    return out;
  });

  // Update specific fields on a block by id. Type changes are ignored.
  const updateBlockFields = (blockId: string, fields: Partial<Block>) => setBlocks(prev => {
    const idx = prev.findIndex(b => b.id === blockId);
    if (idx === -1) return prev;
    const cur = prev[idx] as Block;
    const next: any = { ...cur, ...fields };
    // Prevent type mutation
    if ((fields as any)?.type && (fields as any).type !== (cur as any).type) {
      next.type = (cur as any).type;
    }
    // Clamp paragraph columns if present
    if (cur.type === 'paragraph' && typeof (next as any).columns === 'number') {
      next.columns = Math.max(1, Math.min(6, Math.floor((next as any).columns || 1)));
    }
    const out = prev.slice();
    out[idx] = next as Block;
    return out;
  });

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
    return res.document_id;
  };

  const saveRemote = async (docOverride?: Doc | Block[] | (Partial<Doc> & Record<string, any>)): Promise<void> => {
    const payload = docOverride ?? doc;
    if (!documentId) {
      const id = await createRemote(payload as any);
      setDocumentId(id);
    } else {
      await apiSaveDocument(documentId, payload as any);
    }
    setLastSavedAt(Date.now());
  };

  const loadRemote = async (id: string): Promise<void> => {
    const loaded = await apiLoadDocument(id);
    setDoc(loaded);
    setDocumentId(id);
  };

  const deleteRemote = async (id: string): Promise<void> => {
    await apiDeleteDocument(id);
    if (documentId === id) setDocumentId(null);
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
    setDocMeta,
    setDocName,
    addBlockAtStart,
    addBlockAfter,
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
    insertBlockAt,
    updateBlockFields,
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
  };

  return <EditorContext.Provider value={value}>{children}</EditorContext.Provider>;
}

export function useEditor(): EditorContextValue {
  const ctx = useContext(EditorContext);
  if (!ctx) throw new Error('useEditor must be used within EditorProvider');
  return ctx;
}
