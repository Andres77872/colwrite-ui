import { createContext, useContext, useEffect, useRef, useState, type MutableRefObject, type ReactNode } from 'react';
import type { Block, Doc, ParagraphChild } from './types';
import { loadDoc, saveDoc } from './storage';
import { createDocument as apiCreateDocument, saveDocument as apiSaveDocument, loadDocument as apiLoadDocument, deleteDocument as apiDeleteDocument, listDocuments as apiListDocuments } from '../services';
import { uid } from '../lib/uid';

export type EditorContextValue = {
  doc: Doc;
  blocks: Block[];
  refs: MutableRefObject<Record<string, HTMLDivElement | null>>;
  documentId: string | null;
  activeId: string | null;
  setActive: (id: string | null) => void;
  addBlockAfter: (afterId: string, type: Block['type']) => string;
  moveBlock: (id: string, dir: -1 | 1) => void;
  reorderBlock: (id: string, toIndex: number) => void;
  removeBlock: (id: string) => void;
  updateHtml: (id: string, html: string) => void;
  // Paragraph children helpers
  addParagraphChild: (blockId: string, child: ParagraphChild) => string;
  updateParagraphChild: (blockId: string, childId: string, next: Partial<ParagraphChild>) => void;
  removeParagraphChild: (blockId: string, childId: string) => void;
  toggleTodo: (id: string) => void;
  setHeadingLevel: (id: string, level: 1 | 2 | 3) => void;
  exec: (cmd: string) => void;
  getJSON: () => string;
  setFromJSON: (json: string) => void;
  save: () => void; // local save
  newLocal: () => void; // create a fresh local document
  // API methods
  createRemote: () => Promise<string>;
  saveRemote: () => Promise<void>;
  loadRemote: (id: string) => Promise<void>;
  deleteRemote: (id: string) => Promise<void>;
  listRemote: (page?: number, limit?: number) => Promise<{ documents: any[]; count: number }>; 
  lastSavedAt: number | null;
};

const EditorContext = createContext<EditorContextValue | null>(null);

export function EditorProvider({ children }: { children: ReactNode }) {
  const makeDefaultDoc = (): Doc => ({
    version: 1,
    blocks: [
      { id: uid(), type: 'heading', level: 2, html: 'Your document' },
      { id: uid(), type: 'paragraph', html: 'Write something here. Select text to format. Use the + to insert blocks.', children: [] },
    ],
  });

  const [doc, setDoc] = useState<Doc>(() => loadDoc() ?? makeDefaultDoc());
  const blocks = doc.blocks;
  const refs = useRef<Record<string, HTMLDivElement | null>>({});
  const [lastSavedAt, setLastSavedAt] = useState<number | null>(null);
  const [documentId, setDocumentId] = useState<string | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);

  // Auto-save
  useEffect(() => {
    const raf = requestAnimationFrame(() => saveDoc(doc));
    return () => cancelAnimationFrame(raf);
  }, [doc]);

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

  const addBlockAfter = (afterId: string, type: Block['type']): string => {
    const newId = uid();
    setBlocks(prev => {
      const idx = prev.findIndex(b => b.id === afterId);
      const next: Block =
        type === 'paragraph' ? { id: newId, type: 'paragraph', html: '', children: [] } :
        type === 'heading' ? { id: newId, type: 'heading', level: 2, html: '' } :
        type === 'todo' ? { id: newId, type: 'todo', checked: false, html: '' } :
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
      const equal = cur.message === merged.message && cur.prompt === merged.prompt && cur.output === merged.output && !!cur.collapsed === !!merged.collapsed && cur.id === merged.id && cur.type === merged.type;
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

  const toggleTodo = (id: string) => setBlocks(prev => prev.map(b => (
    b.id === id && b.type === 'todo' ? ({ ...b, checked: !b.checked }) : b
  )));

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
  const createRemote = async (): Promise<string> => {
    const res = await apiCreateDocument(doc);
    setDocumentId(res.document_id);
    return res.document_id;
  };

  const saveRemote = async (): Promise<void> => {
    if (!documentId) {
      const id = await createRemote();
      setDocumentId(id);
    } else {
      await apiSaveDocument(documentId, doc);
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

  const listRemote = async (page = 1, limit = 10): Promise<{ documents: any[]; count: number }> => {
    const res = await apiListDocuments(page, limit);
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
    setLastSavedAt(Date.now());
  };

  const value: EditorContextValue = {
    doc,
    blocks,
    refs,
    documentId,
    activeId,
    setActive: setActiveId,
    addBlockAfter,
    moveBlock,
    reorderBlock,
    removeBlock,
    updateHtml,
    addParagraphChild,
    updateParagraphChild,
    removeParagraphChild,
    toggleTodo,
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
  };

  return <EditorContext.Provider value={value}>{children}</EditorContext.Provider>;
}

export function useEditor(): EditorContextValue {
  const ctx = useContext(EditorContext);
  if (!ctx) throw new Error('useEditor must be used within EditorProvider');
  return ctx;
}
