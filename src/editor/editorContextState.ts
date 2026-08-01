import { createContext, useContext, type MutableRefObject } from 'react';
import type {
  DocumentInput,
  DocumentListOptions,
  DocumentListResult,
} from '../services';
import type { ApplyPatchResult } from './docOps';
import type { Block, Doc, ParagraphChild, ToolOperation } from './types';

export type EditorContextValue = {
  doc: Doc;
  blocks: Block[];
  refs: MutableRefObject<Record<string, HTMLDivElement | null>>;
  registerEditable: (id: string, element: HTMLDivElement | null) => void;
  documentId: string | null;
  /**
   * Which document the workspace is on, independent of whether it has been
   * saved yet.
   *
   * Changes on a genuine navigation — opening another document, starting a new
   * one — and *not* when a local draft is first saved and acquires an id. State
   * that belongs to the open document rather than to its stored identity, such
   * as the assistant's transcript, keys on this.
   */
  documentSessionId: string;
  /** The requested document while the committed document remains on screen. */
  loadingDocumentId: string | null;
  activeId: string | null;
  setActive: (id: string | null) => void;
  openMenuBlockId: string | null;
  openMenuType: 'add' | 'options' | null;
  setBlockMenu: (blockId: string | null, type: 'add' | 'options' | null) => void;
  setDocMeta: (meta: Partial<Doc>) => void;
  setDocName: (name: string) => void;
  addBlockAtStart: (type: Block['type']) => string;
  addBlockAfter: (afterId: string, type: Block['type']) => string;
  insertBlockAtStartExact: (block: Block) => void;
  insertBlockAfterExact: (afterId: string, block: Block) => void;
  insertBlockBeforeExact: (beforeId: string, block: Block) => void;
  appendBlockExact: (block: Block) => void;
  moveBlock: (id: string, dir: -1 | 1) => void;
  reorderBlock: (id: string, toIndex: number) => void;
  removeBlock: (id: string) => void;
  updateHtml: (id: string, html: string) => void;
  setParagraphColumns: (id: string, columns: number) => void;
  toggleAiHidden: (id: string) => void;
  toggleLocked: (id: string) => void;
  toggleCollapsed: (id: string) => void;
  addParagraphChild: (blockId: string, child: ParagraphChild) => string;
  updateParagraphChild: (blockId: string, childId: string, next: Partial<ParagraphChild>) => void;
  removeParagraphChild: (blockId: string, childId: string) => void;
  setHeadingLevel: (id: string, level: 1 | 2 | 3) => void;
  exec: (cmd: string) => void;
  getJSON: () => string;
  setFromJSON: (json: string) => void;
  save: () => void;
  newLocal: () => void;
  getExportSnapshot: () => {
    document: Doc;
    baseVersion: number;
    localRevision: number;
    dirty: boolean;
  };
  createRemote: (docOverride?: DocumentInput) => Promise<string>;
  createAndSwitch: (doc: DocumentInput) => Promise<string>;
  /**
   * The open document's server id, creating it first if it has none.
   *
   * Resolves to `null` when creation failed — the caller says so rather than
   * the editor throwing at whatever the author was doing. Concurrent callers
   * share one creation, so the document is never created twice.
   */
  ensureRemoteDocument: () => Promise<string | null>;
  saveRemote: (docOverride?: DocumentInput) => Promise<void>;
  loadRemote: (id: string) => Promise<boolean>;
  switchTo: (
    id: string,
    options?: { source?: 'selection' | 'history' },
  ) => Promise<boolean>;
  deleteRemote: (id: string) => Promise<void>;
  listRemote: (
    options?: DocumentListOptions,
    init?: { signal?: AbortSignal },
  ) => Promise<DocumentListResult>;
  /** Changes only after a successful mutation that can affect list contents/order. */
  documentListRevision: number;
  lastSavedAt: number | null;
  isAutoSaving: boolean;
  /**
   * Whether an edit is queued for autosave or a save is in flight.
   *
   * A function rather than a value: the only caller is a `beforeunload`
   * handler, which needs the answer at event time, and making it reactive would
   * re-render the editor twice per debounce for nothing.
   */
  hasPendingEdits: () => boolean;
  lastSaveSource: 'auto' | 'manual' | null;
  saveError: string | null;
  clearSaveError: () => void;
  documentLoadNotice: {
    id: number;
    title: string;
    description: string;
  } | null;
  clearDocumentLoadNotice: () => void;
  adoptServerVersion: (version: number | undefined | null) => void;
  hasAnyRemoteDocs: boolean | null;
  applyPatch: (ops: ToolOperation[], options?: { persist?: boolean }) => ApplyPatchResult;
  recentlyChanged: ReadonlySet<string>;
  markRecentlyChanged: (ids: string[]) => void;
};

export const EditorContext = createContext<EditorContextValue | null>(null);

export function useEditor(): EditorContextValue {
  const context = useContext(EditorContext);
  if (!context) throw new Error('useEditor must be used within EditorProvider');
  return context;
}
