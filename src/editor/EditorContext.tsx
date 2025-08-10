import { createContext, useContext, useEffect, useRef, useState, type MutableRefObject, type ReactNode } from 'react';
import type { Block, CounterBlock, Doc } from './types';
import { loadDoc, saveDoc } from './storage';
import { createDocument as apiCreateDocument, saveDocument as apiSaveDocument, loadDocument as apiLoadDocument, deleteDocument as apiDeleteDocument, listDocuments as apiListDocuments } from '../services';
import { uid } from '../lib/uid';

export type EditorContextValue = {
  doc: Doc;
  blocks: Block[];
  refs: MutableRefObject<Record<string, HTMLDivElement | null>>;
  documentId: string | null;
  addBlockAfter: (afterId: string, type: Block['type']) => string;
  moveBlock: (id: string, dir: -1 | 1) => void;
  removeBlock: (id: string) => void;
  updateHtml: (id: string, html: string) => void;
  toggleTodo: (id: string) => void;
  setHeadingLevel: (id: string, level: 1 | 2 | 3) => void;
  bumpCounter: (id: string, delta: number) => void;
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
      { id: uid(), type: 'paragraph', html: 'Write something here. Use the toolbar for formatting.' },
    ],
  });

  const [doc, setDoc] = useState<Doc>(() => loadDoc() ?? makeDefaultDoc());
  const blocks = doc.blocks;
  const refs = useRef<Record<string, HTMLDivElement | null>>({});
  const [lastSavedAt, setLastSavedAt] = useState<number | null>(null);
  const [documentId, setDocumentId] = useState<string | null>(null);

  // Auto-save
  useEffect(() => {
    const raf = requestAnimationFrame(() => saveDoc(doc));
    return () => cancelAnimationFrame(raf);
  }, [doc]);

  const setBlocks = (updater: (prev: Block[]) => Block[]) => setDoc(d => ({ ...d, blocks: updater(d.blocks) }));

  const addBlockAfter = (afterId: string, type: Block['type']): string => {
    const newId = uid();
    setBlocks(prev => {
      const idx = prev.findIndex(b => b.id === afterId);
      const next: Block =
        type === 'paragraph' ? { id: newId, type: 'paragraph', html: '' } :
        type === 'heading' ? { id: newId, type: 'heading', level: 2, html: '' } :
        type === 'todo' ? { id: newId, type: 'todo', checked: false, html: '' } :
        type === 'counter' ? { id: newId, type: 'counter', count: 0 } :
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

  const removeBlock = (id: string) => setBlocks(prev => prev.filter(b => b.id !== id));

  const updateHtml = (id: string, html: string) => setBlocks(prev => prev.map(b => (
    b.id === id && 'html' in b ? ({ ...(b as any), html }) : b
  )));

  const toggleTodo = (id: string) => setBlocks(prev => prev.map(b => (
    b.id === id && b.type === 'todo' ? ({ ...b, checked: !b.checked }) : b
  )));

  const setHeadingLevel = (id: string, level: 1 | 2 | 3) => setBlocks(prev => prev.map(b => (
    b.id === id && b.type === 'heading' ? ({ ...b, level }) : b
  )));

  const bumpCounter = (id: string, delta: number) => setBlocks(prev => prev.map(b => (
    b.id === id && b.type === 'counter' ? ({ ...b as CounterBlock, count: Math.max(0, (b as CounterBlock).count + delta) }) : b
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
    addBlockAfter,
    moveBlock,
    removeBlock,
    updateHtml,
    toggleTodo,
    setHeadingLevel,
    bumpCounter,
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
