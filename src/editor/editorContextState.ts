import { createContext, useContext, type MutableRefObject } from 'react';
import type { ApplyPatchResult } from './docOps';
import type { Block, CitationSource, Doc, ParagraphChild, ToolOperation } from './types';
import type { BlockKindId } from './blockKinds';

/**
 * Edits of the open page's blocks and library (`createBlockActions`). Each
 * one arms autosave and is one undo step, unless it coalesces with the
 * typing burst before it.
 */
export type BlockActions = {
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
  /**
   * Block order at call time, without subscribing to `blocks`. Arrow-key
   * navigation needs the answer at keydown time; subscribing would re-render
   * every editable on every keystroke.
   */
  getBlockIds: () => string[];
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
};

/**
 * Everything the editor core can *do*, plus the few containers that never
 * change identity (`refs`). Every action closes over refs or stable setters,
 * so this value is referentially stable across document edits: a component
 * that only needs actions does not re-render per keystroke.
 *
 * Opening, saving and deleting pages are the session's (`useDocumentActions`).
 */
export type EditorActionsContextValue = BlockActions & {
  refs: MutableRefObject<Record<string, HTMLDivElement | null>>;
  registerEditable: (id: string, element: HTMLDivElement | null) => void;
  setActive: (id: string | null) => void;
  setBlockMenu: (blockId: string | null, type: 'add' | 'options' | null) => void;
  /** Run several edits as one undo step. */
  batch: <T>(run: () => T) => T;
  undo: () => void;
  redo: () => void;
  exec: (cmd: string, value?: string) => void;
  getJSON: () => string;
  setFromJSON: (json: string) => void;
  getExportSnapshot: () => {
    document: Doc;
    localRevision: number;
    dirty: boolean;
  };
  applyPatch: (
    ops: ToolOperation[],
    options?: { persist?: boolean; base?: Block[] },
  ) => ApplyPatchResult;
  markRecentlyChanged: (ids: string[]) => void;
  /** Select whole blocks (replaces the current block selection). */
  selectBlocks: (ids: readonly string[]) => void;
  /** The block selection at call time, in document order. */
  getSelectedBlockIds: () => readonly string[];
  clearBlockSelection: () => void;
};

/**
 * What the editor shows around the text: the open block menu, the block
 * selection, the undo state and the blocks a change just landed on.
 */
export type EditorViewValue = {
  openMenuBlockId: string | null;
  openMenuType: 'add' | 'options' | null;
  /** Blocks selected as whole blocks, in document order. */
  selectedBlockIds: readonly string[];
  recentlyChanged: ReadonlySet<string>;
  /** Whether the open document has a previous local edit state to restore. */
  canUndo: boolean;
  /** Whether an undone local edit can be re-applied. */
  canRedo: boolean;
};

/**
 * The one piece of state an editable needs reactively. Focus moves are rare
 * next to keystrokes, so this lives apart from the view context, which
 * changes with the blocks.
 */
export type EditorActiveBlockContextValue = {
  activeId: string | null;
  setActive: (id: string | null) => void;
};

export const EditorActionsContext = createContext<EditorActionsContextValue | null>(null);
export const EditorViewContext = createContext<EditorViewValue | null>(null);
export const EditorActiveBlockContext = createContext<EditorActiveBlockContextValue | null>(null);

export function useEditorActions(): EditorActionsContextValue {
  const context = useContext(EditorActionsContext);
  if (!context) throw new Error('useEditorActions must be used within EditorProvider');
  return context;
}

/** The editor's actions, or null outside an editor (a panel rendered on its own). */
export function useOptionalEditorActions(): EditorActionsContextValue | null {
  return useContext(EditorActionsContext);
}

export function useEditorView(): EditorViewValue {
  const context = useContext(EditorViewContext);
  if (!context) throw new Error('useEditorView must be used within EditorProvider');
  return context;
}

export function useActiveBlock(): EditorActiveBlockContextValue {
  const context = useContext(EditorActiveBlockContext);
  if (!context) throw new Error('useActiveBlock must be used within EditorProvider');
  return context;
}
