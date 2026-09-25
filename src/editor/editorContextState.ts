import { createContext, useContext, useMemo, type MutableRefObject } from 'react';
import type {
  DocumentInput,
  DocumentListOptions,
  DocumentListResult,
} from '../services';
import type { ApplyPatchResult } from './docOps';
import type { Block, CitationSource, Doc, ParagraphChild, ToolOperation } from './types';
import type { BlockKindId } from './blockKinds';

/**
 * State slices of the editor. A keystroke replaces `doc`/`blocks`, so this
 * value changes identity on every edit — only consumers that actually render
 * document state should subscribe to it.
 */
export type EditorStateContextValue = {
  doc: Doc;
  blocks: Block[];
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
  openMenuBlockId: string | null;
  openMenuType: 'add' | 'options' | null;
  /** Changes only after a successful mutation that can affect list contents/order. */
  documentListRevision: number;
  lastSavedAt: number | null;
  isAutoSaving: boolean;
  lastSaveSource: 'auto' | 'manual' | null;
  saveError: string | null;
  /** Whether the open document has a previous local edit state to restore. */
  canUndo: boolean;
  /** Whether an undone local edit can be re-applied. */
  canRedo: boolean;
  documentLoadNotice: {
    id: number;
    title: string;
    description: string;
  } | null;
  /**
   * Increments every time a restore moves the document onto another version
   * of its tree. State computed against the pre-restore content — staged
   * assistant proposals, in-flight agent streams — keys on this to know it
   * no longer describes the document on screen.
   */
  restoreEpoch: number;
  hasAnyRemoteDocs: boolean | null;
  recentlyChanged: ReadonlySet<string>;
  /** Blocks selected as whole blocks, in document order. */
  selectedBlockIds: readonly string[];
};

/**
 * Everything the editor can *do*, plus the few containers that never change
 * identity (`refs`). Every action closes over refs or stable setters, so this
 * value is referentially stable across document edits: a component that only
 * needs actions does not re-render per keystroke.
 */
export type EditorActionsContextValue = {
  refs: MutableRefObject<Record<string, HTMLDivElement | null>>;
  registerEditable: (id: string, element: HTMLDivElement | null) => void;
  setActive: (id: string | null) => void;
  setBlockMenu: (blockId: string | null, type: 'add' | 'options' | null) => void;
  setDocMeta: (meta: Partial<Doc>) => void;
  setDocName: (name: string) => void;
  addBlockAtStart: (type: Block['type']) => string;
  addBlockAfter: (afterId: string, type: Block['type']) => string;
  addBlockBefore: (beforeId: string, type: Block['type']) => string;
  insertBlockAtStartExact: (block: Block) => void;
  insertBlockAfterExact: (afterId: string, block: Block) => void;
  insertBlockBeforeExact: (beforeId: string, block: Block) => void;
  appendBlockExact: (block: Block) => void;
  moveBlock: (id: string, dir: -1 | 1) => void;
  reorderBlock: (id: string, toIndex: number) => void;
  splitBlock: (id: string, beforeHtml: string, afterHtml: string) => string;
  mergeWithPrevious: (id: string) => { targetId: string; caretOffset: number } | null;
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
  /**
   * Turn a block into another kind in place, keeping its id and text. `html`
   * replaces the text in the same undo step.
   */
  setBlockKind: (id: string, kind: BlockKindId, options?: { html?: string }) => void;
  /** A block as it is now, read at call time without subscribing to state. */
  getBlock: (id: string) => Block | undefined;
  /** Add sources to the library, or refresh entries with the same key. */
  upsertSources: (sources: readonly CitationSource[]) => void;
  /** Edit a library entry's metadata. */
  updateSource: (key: string, patch: Partial<CitationSource>) => void;
  /** Remove a library entry; citations keep their own copies. */
  removeSource: (key: string) => void;
  /** Set (or clear, with null) the document's citation style. */
  setCitationStyle: (style: Doc['citationStyle'] | null) => void;
  /** Tick or untick a to-do item. */
  setChecked: (id: string, checked: boolean) => void;
  /** Nest (+1) or un-nest (-1) a list item. Returns whether it moved. */
  indentBlock: (id: string, delta: 1 | -1) => boolean;
  updateCodeText: (id: string, text: string) => void;
  setCodeLanguage: (id: string, language: string | null) => void;
  /** Copy a block (and its widgets) below itself; returns the copy's id. */
  duplicateBlock: (id: string) => string | null;
  /**
   * Replace blocks with others as one undo step; the new ones land where the
   * first replaced block was. Locked blocks are kept. Returns inserted ids.
   */
  replaceBlocks: (ids: readonly string[], blocks: readonly Block[]) => string[];
  /** Delete several blocks as one undo step. Locked blocks are kept. */
  removeBlocks: (ids: readonly string[]) => void;
  /**
   * Insert ready-made blocks after `afterId` (at the start when null) as one
   * undo step. Returns the inserted ids.
   */
  insertBlocksAfter: (
    afterId: string | null,
    blocks: readonly Block[],
    options?: { replaceAnchor?: boolean },
  ) => string[];
  exec: (cmd: string, value?: string) => void;
  /**
   * Block order at call time, without subscribing to `blocks`. Arrow-key
   * navigation needs the answer at keydown time; subscribing would re-render
   * every editable on every keystroke.
   */
  getBlockIds: () => string[];
  getJSON: () => string;
  setFromJSON: (json: string) => void;
  save: () => void;
  undo: () => void;
  redo: () => void;
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
  /**
   * Whether an edit is queued for autosave or a save is in flight.
   *
   * A function rather than a value: the only caller is a `beforeunload`
   * handler, which needs the answer at event time, and making it reactive would
   * re-render the editor twice per debounce for nothing.
   */
  hasPendingEdits: () => boolean;
  /** Last server-confirmed head sequence, or null before the first save. */
  savedHeadSeq: () => number | null;
  clearSaveError: () => void;
  clearDocumentLoadNotice: () => void;
  adoptServerVersion: (version: number | undefined | null) => void;
  /**
   * Take a server-side restore's content and version as the new persisted
   * baseline of the open document — without arming autosave and without
   * starting a new document session.
   */
  adoptRestoredDocument: (doc: Doc, serverVersion: number) => void;
  applyPatch: (
    ops: ToolOperation[],
    options?: { persist?: boolean; base?: Block[] },
  ) => ApplyPatchResult;
  markRecentlyChanged: (ids: string[]) => void;
  /** Select whole blocks (replaces the current block selection). */
  selectBlocks: (ids: readonly string[]) => void;
  clearBlockSelection: () => void;
};

export type EditorContextValue = EditorStateContextValue & EditorActionsContextValue;

/**
 * The one piece of state an editable needs reactively. Focus moves are rare
 * next to keystrokes, so this lives apart from the full state context, which
 * changes on every edit.
 */
export type EditorActiveBlockContextValue = {
  activeId: string | null;
  setActive: (id: string | null) => void;
};

export const EditorContext = createContext<EditorStateContextValue | null>(null);
export const EditorActionsContext = createContext<EditorActionsContextValue | null>(null);
export const EditorActiveBlockContext = createContext<EditorActiveBlockContextValue | null>(null);

export function useEditorState(): EditorStateContextValue {
  const context = useContext(EditorContext);
  if (!context) throw new Error('useEditorState must be used within EditorProvider');
  return context;
}

export function useEditorActions(): EditorActionsContextValue {
  const context = useContext(EditorActionsContext);
  if (!context) throw new Error('useEditorActions must be used within EditorProvider');
  return context;
}

/** The editor's actions, or null outside an editor (a panel rendered on its own). */
export function useOptionalEditorActions(): EditorActionsContextValue | null {
  return useContext(EditorActionsContext);
}

export function useActiveBlock(): EditorActiveBlockContextValue {
  const context = useContext(EditorActiveBlockContext);
  if (!context) throw new Error('useActiveBlock must be used within EditorProvider');
  return context;
}

/**
 * The merged view kept for consumers that predate the split — and for any
 * component that genuinely needs both state and actions. Subscribing through
 * this hook means re-rendering on every state change, exactly as before.
 */
export function useEditor(): EditorContextValue {
  const state = useEditorState();
  const actions = useEditorActions();
  return useMemo(() => ({ ...state, ...actions }), [state, actions]);
}
