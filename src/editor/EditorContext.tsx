import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { Block, Doc, ToolOperation } from './types';
import { buildBibliography, citationFingerprint } from './citations';
import { BibliographyContext } from './bibliographyContextState';
import { applyPatchToBlocks, coerceBlock, replayFootprint, type ApplyPatchResult } from './docOps';
import { createBlockActions } from './blockActions';
import { DocumentSessionProvider } from './DocumentSession';
import { useWorkspaceScope } from '@/components/workspace/workspaceContextState';
import { useWorkspaceAccess } from '@/components/workspace/workspaceAccess';
import {
  useDocumentActions,
  useDocumentBody,
  useEditorDoc,
} from './documentSessionState';
import {
  EditorActionsContext,
  EditorActiveBlockContext,
  EditorViewContext,
  type EditorActionsContextValue,
  type EditorActiveBlockContextValue,
  type EditorViewValue,
} from './editorContextState';
import { serializeEditableHtml } from '@/components/common/Editable/editableHtml';

/** How many document states undo can walk back. */
const UNDO_LIMIT = 100;

type HistoryEntry = {
  before: Doc;
  after: Doc;
  /** Typing steps with the same key merge while the burst lasts. */
  key: string | null;
  time: number;
};

/** Whether a change is one the undo journal records. */
function journaledChange(before: Doc, next: Doc): boolean {
  return (
    next.blocks !== before.blocks ||
    next.name !== before.name ||
    next.sources !== before.sources ||
    next.citationStyle !== before.citationStyle
  );
}

/**
 * A contenteditable command. `value` carries the argument the few commands
 * that take one need — `createLink` above all, which was unreachable while
 * this signature had nowhere to put a URL.
 */
function exec(cmd: string, value?: string): void {
  document.execCommand(cmd, false, value);
}

/**
 * The editor: the open page's session (`DocumentSessionProvider`: which page,
 * loading, saving, drafts, conflicts) and, inside it, the editor core
 * (blocks, undo, selection, the caret and menus).
 *
 * Read it through the selector hooks — `useEditorDoc`, `useDocumentId`,
 * `useDocumentSession`, `useDocumentStatus`, `useDocumentActions`,
 * `useEditorActions`, `useEditorView`, `useActiveBlock` — each of which
 * re-renders only when its own slice changes.
 */
export function EditorProvider({ children }: { children: ReactNode }) {
  const { workspaceId, initialDocumentId } = useWorkspaceScope();
  // A viewer reads the page and never writes it (D6, M6.UI-2).
  const { canEdit } = useWorkspaceAccess();
  return (
    <DocumentSessionProvider workspaceId={workspaceId} initialDocumentId={initialDocumentId} canEdit={canEdit}>
      <EditorCore>{children}</EditorCore>
    </DocumentSessionProvider>
  );
}

function EditorCore({ children }: { children: ReactNode }) {
  const body = useDocumentBody();
  const { readDoc, editDoc, commitDoc, attachEditor } = body;
  const { doc, blocks } = useEditorDoc();
  const { hasPendingEdits } = useDocumentActions();

  const refs = useRef<Record<string, HTMLDivElement | null>>({});
  const registerEditable = useCallback((id: string, element: HTMLDivElement | null) => {
    // React re-calls the ref with null on unmount; storing `{id: null}` would
    // grow the map by one dead entry for every block ever removed.
    if (element) refs.current[id] = element;
    else delete refs.current[id];
  }, []);
  const [activeId, setActiveId] = useState<string | null>(null);
  // Global menu state - only one block menu open at a time
  const [openMenuBlockId, setOpenMenuBlockId] = useState<string | null>(null);
  const [openMenuType, setOpenMenuType] = useState<'add' | 'options' | null>(null);
  const setBlockMenu = useCallback((blockId: string | null, type: 'add' | 'options' | null) => {
    setOpenMenuBlockId(blockId);
    setOpenMenuType(type);
  }, []);
  /**
   * Blocks selected as whole blocks (Esc, Shift+click on the handle, ⌘A
   * twice) rather than as text; `selectedBlockIds` below keeps them in
   * document order.
   */
  const [selectedIdsRaw, setSelectedIds] = useState<readonly string[]>([]);

  const historyRef = useRef<{ undo: HistoryEntry[]; redo: HistoryEntry[] }>({
    undo: [],
    redo: [],
  });
  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);
  /** Set while undo/redo replays a state, so the replay is not itself journaled. */
  const applyingHistoryRef = useRef(false);
  /** The document as it was when the open `batch` began. */
  const batchRef = useRef<{ before: Doc } | null>(null);

  const journal = useCallback((before: Doc, next: Doc, key: string | null) => {
    if (!journaledChange(before, next)) return;
    const now = Date.now();
    const stack = historyRef.current.undo;
    const top = stack[stack.length - 1];
    // An inline widget is two writes: its entry in `children`, then the html
    // with its placeholder. As two undo steps, one Mod+Z left a child with no
    // placeholder, which the server refuses, so the document stopped saving
    // until the author typed in that block again. The html write that follows
    // a child write on the same block completes that step instead.
    const completesInsert =
      key !== null &&
      key.startsWith('html:') &&
      top !== undefined &&
      top.key === `child:${key.slice('html:'.length)}` &&
      now - top.time < 1000;
    if (completesInsert) {
      top.after = next;
      top.time = now;
      // Closed: typing after the widget is a step of its own.
      top.key = null;
    } else if (key && top && top.key === key && now - top.time < 1000) {
      top.after = next;
      top.time = now;
    } else {
      stack.push({ before, after: next, key, time: now });
      if (stack.length > UNDO_LIMIT) stack.shift();
    }
    historyRef.current.redo = [];
    setCanUndo(true);
    setCanRedo(false);
  }, []);

  // The session's transitions reach the caret, the menus, the selection and
  // the journal through this handle. Another page's history is meaningless
  // here, and a restore replaces the tree wholesale, so both reset it. Typing bursts coalesce per block (a pause of a
  // second starts a fresh step); structural changes always start a new
  // entry. A replay is not journaled, and a batch is journaled once, when it
  // closes.
  useLayoutEffect(() => attachEditor({
    journal: (before, next, key) => {
      if (applyingHistoryRef.current || batchRef.current) return;
      journal(before, next, key);
    },
    clearActive: () => setActiveId(null),
    closeMenus: () => {
      setOpenMenuBlockId(null);
      setOpenMenuType(null);
    },
    resetHistory: () => {
      historyRef.current = { undo: [], redo: [] };
      setCanUndo(false);
      setCanRedo(false);
    },
    clearSelection: () => setSelectedIds(previous => (previous.length ? [] : previous)),
  }), [attachEditor, journal]);

  const blockActions = useMemo(() => createBlockActions(editDoc, readDoc), [editDoc, readDoc]);

  /**
   * Run several edits as one undo step.
   *
   * Moving, duplicating or converting a run of selected blocks repeats a
   * one-block action; each used to be its own step, so one Mod+Z split the
   * run. Nested batches join the outer one.
   */
  const batch = useCallback(<T,>(run: () => T): T => {
    if (batchRef.current || applyingHistoryRef.current) return run();
    const before = readDoc();
    batchRef.current = { before };
    try {
      return run();
    } finally {
      batchRef.current = null;
      journal(before, readDoc(), null);
    }
  }, [readDoc, journal]);

  /**
   * Capture the DOM-backed editable values synchronously before export.
   *
   * React state normally follows on the next frame. Export is user-initiated
   * and must include the character still visible under the caret even when
   * that state update has not committed yet.
   */
  const getExportSnapshot = useCallback(() => {
    // Reads `readDoc()` rather than closing over `doc`: the snapshot must be
    // of the document as it is at click time, and a state closure would also
    // make this action change identity on every edit.
    const document = structuredClone(readDoc());
    document.blocks = document.blocks.map((block) => {
      if (block.type === 'divider') return block;
      const editable = refs.current[block.id];
      return editable ? { ...block, html: serializeEditableHtml(editable) } : block;
    });
    return { document, localRevision: body.getEditRevision(), dirty: hasPendingEdits() };
  }, [body, readDoc, hasPendingEdits]);

  // `readDoc()` rather than a `doc` closure: the JSON must be of the document
  // as it is at call time, and closing over state would make the action
  // change identity on every edit.
  const getJSON = useCallback(() => JSON.stringify(readDoc(), null, 2), [readDoc]);
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
      name: typeof parsed.name === 'string' ? parsed.name : undefined,
      blocks,
    };
    editDoc(() => next);
  }, [editDoc]);

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
    if (body.isLoading()) {
      return { blocks: readDoc().blocks, desynced: ops, touched: [], stale: true };
    }

    // Computed against the ref rather than inside a `setState` updater. The
    // caller needs `touched` to highlight what moved and `desynced` to say the
    // two copies have diverged, and React runs an updater when it pleases —
    // both used to come back empty for anything but the first update in a tick.
    const base = readDoc();

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

    if (options?.persist) editDoc(() => nextDoc);
    else commitDoc(nextDoc);

    return outcome;
  }, [body, commitDoc, editDoc, readDoc]);

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

  // The selection in document order, pruned of ids that left the document,
  // so every consumer can act on it directly.
  const selectedBlockIds = useMemo(() => {
    if (selectedIdsRaw.length === 0) return selectedIdsRaw;
    const wanted = new Set(selectedIdsRaw);
    const ordered = blocks.filter(b => wanted.has(b.id)).map(b => b.id);
    return ordered.length === selectedIdsRaw.length && ordered.every((id, i) => id === selectedIdsRaw[i])
      ? selectedIdsRaw
      : ordered;
  }, [blocks, selectedIdsRaw]);
  const selectBlocks = useCallback((ids: readonly string[]) => setSelectedIds(ids.slice()), []);
  // The selection at call time, for commands that act on it without
  // re-rendering with it (every block's handle menu).
  const selectedBlockIdsRef = useRef<readonly string[]>(selectedBlockIds);
  useEffect(() => {
    selectedBlockIdsRef.current = selectedBlockIds;
  }, [selectedBlockIds]);
  const getSelectedBlockIds = useCallback(() => selectedBlockIdsRef.current, []);
  const clearBlockSelection = useCallback(() => setSelectedIds(previous => (previous.length ? [] : previous)), []);

  /**
   * Show the author what an undo or redo changed.
   *
   * The replay swaps the document state; when the change was off screen (an
   * accepted suggestion further down, a block moved away) nothing visible
   * happened and the author pressed Mod+Z again. The changed blocks are
   * tinted for a moment and the first is scrolled into view.
   */
  const showReplay = useCallback((from: Doc, to: Doc) => {
    const { changed, near } = replayFootprint(from, to);
    // Taking back a few typed words in the block the caret is in needs no
    // signal: the author is looking at it. Tinting it on every Mod+Z would
    // only flicker.
    const focused = document.activeElement?.closest?.('.block-row')?.getAttribute('data-block-id') ?? null;
    if (changed.length === 1 && changed[0] === focused) return;
    markRecentlyChanged(changed);
    const target = changed[0] ?? near;
    if (!target) return;
    requestAnimationFrame(() => {
      const row = document.querySelector<HTMLElement>(
        `.blocks-container > .block-row[data-block-id="${CSS.escape(target)}"]`,
      );
      row?.scrollIntoView?.({ block: 'nearest' });
    });
  }, [markRecentlyChanged]);

  /**
   * Walk the document back or forward one journaled state.
   *
   * The replay goes through `editDoc` so it dirties the revision and arms
   * autosave like any edit; `applyingHistoryRef` keeps the replay itself out
   * of the journal. `Editable` rebases an active block whose state changed
   * underneath it, so the canvas follows the walk without extra wiring.
   */
  const replay = useCallback((direction: 'undo' | 'redo') => {
    const history = historyRef.current;
    const entry = (direction === 'undo' ? history.undo : history.redo).pop();
    if (!entry) return;
    (direction === 'undo' ? history.redo : history.undo).push(entry);
    setCanUndo(history.undo.length > 0);
    setCanRedo(history.redo.length > 0);
    const [from, to] = direction === 'undo' ? [entry.after, entry.before] : [entry.before, entry.after];
    applyingHistoryRef.current = true;
    try {
      editDoc(() => to);
    } finally {
      applyingHistoryRef.current = false;
    }
    showReplay(from, to);
  }, [editDoc, showReplay]);
  const undo = useCallback(() => replay('undo'), [replay]);
  const redo = useCallback(() => replay('redo'), [replay]);

  // Numbering, ordering and back-links are all derived from the same scan, so
  // it happens once here rather than inside each citation widget.
  //
  // `blocks` gets a new identity on every keystroke, which used to re-run the
  // whole scan just as often. The fingerprint captures exactly the fields the
  // scan reads, so the rebuild only happens when a citation actually changes.
  const library = doc.sources;
  const documentStyle = doc.citationStyle ?? null;
  const bibliographyFingerprint = useMemo(
    () => citationFingerprint(blocks, { library, style: documentStyle }),
    [blocks, library, documentStyle],
  );
  const bibliography = useMemo(
    () => buildBibliography(blocks, { library, style: documentStyle }),
    // The fingerprint stands in for `blocks`: identical fingerprint means
    // identical scan inputs, hence an identical bibliography.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [bibliographyFingerprint],
  );

  /**
   * Every action closes over refs or stable setters, which keeps this value
   * referentially stable across edits; consumers that only dispatch — the
   * per-block editables most of all — subscribe to it alone and skip the
   * per-keystroke render entirely.
   */
  const actionsValue: EditorActionsContextValue = useMemo(() => ({
    ...blockActions,
    refs,
    registerEditable,
    setActive: setActiveId,
    setBlockMenu,
    batch,
    undo,
    redo,
    exec,
    getJSON,
    setFromJSON,
    getExportSnapshot,
    applyPatch,
    markRecentlyChanged,
    selectBlocks,
    getSelectedBlockIds,
    clearBlockSelection,
  }), [
    blockActions,
    registerEditable,
    setBlockMenu,
    batch,
    undo,
    redo,
    getJSON,
    setFromJSON,
    getExportSnapshot,
    applyPatch,
    markRecentlyChanged,
    selectBlocks,
    getSelectedBlockIds,
    clearBlockSelection,
  ]);

  const viewValue: EditorViewValue = useMemo(() => ({
    openMenuBlockId,
    openMenuType,
    selectedBlockIds,
    recentlyChanged,
    canUndo,
    canRedo,
  }), [openMenuBlockId, openMenuType, selectedBlockIds, recentlyChanged, canUndo, canRedo]);

  // Focus moves are rare next to keystrokes, so the one piece of state an
  // editable needs reactively gets its own context: subscribing to the view
  // would re-render every editable whenever the blocks move.
  const activeBlockValue: EditorActiveBlockContextValue = useMemo(() => ({
    activeId,
    setActive: setActiveId,
  }), [activeId]);

  return (
    <EditorActionsContext.Provider value={actionsValue}>
      <EditorViewContext.Provider value={viewValue}>
        <EditorActiveBlockContext.Provider value={activeBlockValue}>
          <BibliographyContext.Provider value={bibliography}>{children}</BibliographyContext.Provider>
        </EditorActiveBlockContext.Provider>
      </EditorViewContext.Provider>
    </EditorActionsContext.Provider>
  );
}
