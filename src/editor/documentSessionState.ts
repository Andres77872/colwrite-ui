import { createContext, useContext } from 'react';
import type { Block, Doc } from './types';
import type { NewPagePlace, TrashRoot } from '../data/documents';

/**
 * The open page is in the Trash: what took it there (the page itself, or the
 * collection it went with, which is what a restore takes) and when it is
 * deleted for good.
 */
export type PageInTrash = {
  trashRoot: TrashRoot;
  purgeAfter: string | null;
};

/** Why the open document was replaced by a server copy (see `restoreReason`). */
export type RestoreReason = 'restore' | 'newer-version';

/**
 * The open page's body. A keystroke replaces it, so only components that
 * render the page's content should subscribe.
 */
export type EditorDocValue = {
  doc: Doc;
  blocks: Block[];
};

/**
 * Which page is open, and whether that is changing. Moves on navigation and
 * on the few events that change what the page lists hold; never on a
 * keystroke or a save.
 */
export type DocumentSessionValue = {
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
  /** A `createAndSwitch` is in flight; every "New page" control waits on it. */
  creatingDocument: boolean;
  /**
   * Increments every time a restore moves the document onto another version
   * of its tree. State computed against the pre-restore content — staged
   * assistant proposals, in-flight agent streams — keys on this to know it
   * no longer describes the document on screen.
   */
  restoreEpoch: number;
  /**
   * Why the epoch last moved. A History restore puts the document on another
   * branch, so suggestions made for the old one are retired; opening the
   * server's newer version after a refused save keeps the same line of
   * history, so they are staged again against it.
   */
  restoreReason: RestoreReason;
  /**
   * How many pages the workspace has, from its read (`GET /workspaces/{w}`),
   * while the starter page is open; null until it answers. None shows the
   * first-run screen. A create or a delete reads it again.
   */
  pageCount: number | null;
  /**
   * The page can be read here and not edited (M6.UI-2): the account is a
   * viewer in the workspace, or the server refused a save for its role. The
   * session never sends a write meanwhile; the canvas, the title and every
   * editing control stand down, and review is read-only.
   */
  readOnly: boolean;
};

/** Where the open page's saving stands. Moves around every save. */
export type DocumentStatusValue = {
  /**
   * When the open page was last saved to the server, in ms: the server's
   * `updated_at` when the page loads, then the time of each save. Null for a
   * draft that has never been saved.
   */
  lastSavedAt: number | null;
  isAutoSaving: boolean;
  lastSaveSource: 'auto' | 'manual' | null;
  saveError: string | null;
  /**
   * The server refused the last save because someone saved the open page
   * since its head (412 `stale_head`). Autosave waits until
   * `resolveSaveConflict` is called.
   */
  saveConflict: boolean;
  /**
   * When edits of the open document that never reached the server were kept
   * on this device, or null when there are none to offer back.
   */
  unsavedDraftAt: number | null;
  /**
   * The open page is in the Trash: moved there here, from another tab or
   * with its collection. Autosave stands down until it is restored
   * (`markPageRestored`); edits made meanwhile wait, and are kept on this
   * device if the author leaves.
   */
  inTrash: PageInTrash | null;
  /**
   * The page turned read-only (a demotion to viewer) with edits the server
   * never got: they are kept on this device, offered back when the page
   * opens again for someone who can edit, and said so.
   */
  editsKeptReadOnly: boolean;
  documentLoadNotice: {
    id: number;
    title: string;
    description: string;
  } | null;
};

/**
 * What the session can do: open, create, save and delete pages, and settle
 * what saving left undecided. Every action closes over refs or stable
 * setters, so this value never changes identity.
 */
export type DocumentActionsValue = {
  save: () => void;
  saveRemote: (docOverride?: Doc) => Promise<void>;
  /**
   * Save the open page's pending edits now — before a switch, a creation,
   * a sign-out or an unmount. When the server does not take them they are
   * kept on this device and offered back the next time the page opens.
   * Resolves `false` in that case.
   */
  flushPendingSave: () => Promise<boolean>;
  createRemote: (docOverride?: Doc) => Promise<string>;
  /**
   * Create a document and open it, at the top level or in a collection. A
   * call while one is in flight returns that creation's promise, so the
   * author never gets two pages.
   */
  createAndSwitch: (doc: Doc, place?: NewPagePlace) => Promise<string>;
  /**
   * The open document's server id, creating it first if it has none.
   *
   * Resolves to `null` when creation failed — the caller says so rather than
   * the editor throwing at whatever the author was doing. Concurrent callers
   * share one creation, so the document is never created twice.
   */
  ensureRemoteDocument: () => Promise<string | null>;
  loadRemote: (id: string) => Promise<boolean>;
  switchTo: (
    id: string,
    options?: { source?: 'selection' | 'history' },
  ) => Promise<boolean>;
  newLocal: () => void;
  /**
   * The page `id` went to the Trash. When it is the open page, autosave
   * stands down and the page says so; nothing is sent.
   */
  markPageTrashed: (id: string, trash: PageInTrash) => void;
  /** The page `id` is back from the Trash: the open page saves again, with the ETag it holds. */
  markPageRestored: (id: string) => void;
  /**
   * Whether an edit is queued for autosave or a save is in flight.
   *
   * A function rather than a value: the callers (a `beforeunload` handler, an
   * agent turn) need the answer at event time, and making it reactive would
   * re-render the editor twice per debounce for nothing.
   */
  hasPendingEdits: () => boolean;
  /**
   * Settle a refused save: `mine` writes the open body over the server's newer
   * version; `theirs` opens that version and keeps the open body on this
   * device, to be offered back.
   */
  resolveSaveConflict: (keep: 'mine' | 'theirs') => Promise<void>;
  /** Put the kept edits back in the open document (one undo step). */
  restoreKeptDraft: () => boolean;
  discardKeptDraft: () => void;
  clearSaveError: () => void;
  clearDocumentLoadNotice: () => void;
  /**
   * Take a server-side restore's content and ETag as the new persisted
   * baseline of the open document — without arming autosave and without
   * starting a new document session.
   */
  adoptRestoredDocument: (doc: Doc, etag: string, reason?: RestoreReason) => void;
};

/**
 * What the editor core registers with the session, so the session's
 * transitions can reach state the core owns.
 */
export type EditorHandle = {
  /** Record an edit for undo. */
  journal: (before: Doc, next: Doc, coalesceKey: string | null) => void;
  /** The body on screen was replaced: the caret no longer points into it. */
  clearActive: () => void;
  closeMenus: () => void;
  /**
   * Another page, or another version of this one (a restore): undo must not
   * walk back across it and resurrect text the server has moved past.
   */
  resetHistory: () => void;
  /** Another page: a block selection belongs to the page it was made in. */
  clearSelection: () => void;
};

/**
 * The session's body, for the editor core only (not exported from
 * `@/editor`). The core edits through `editDoc`, which counts the edit for
 * autosave and hands it to the core's journal.
 */
export type DocumentBody = {
  /** The body as it is now, without waiting for a render. Call it from handlers, not while rendering. */
  readDoc: () => Doc;
  /** Replace the body without counting an edit (a replay the server holds). */
  commitDoc: (next: Doc) => void;
  /** An edit: refused while a page loads; arms autosave; journaled. */
  editDoc: (updater: (prev: Doc) => Doc, coalesceKey?: string | null) => void;
  /** A page is loading; the body on screen is about to be replaced. */
  isLoading: () => boolean;
  /** The edit revision; it moves with every edit. */
  getEditRevision: () => number;
  /** The core registers itself once mounted; returns the detach function. */
  attachEditor: (editor: EditorHandle) => () => void;
};

export const EditorDocContext = createContext<EditorDocValue | null>(null);
export const DocumentSessionContext = createContext<DocumentSessionValue | null>(null);
export const DocumentStatusContext = createContext<DocumentStatusValue | null>(null);
export const DocumentActionsContext = createContext<DocumentActionsValue | null>(null);
export const DocumentBodyContext = createContext<DocumentBody | null>(null);

function required<T>(value: T | null, hook: string): T {
  if (!value) throw new Error(`${hook} must be used within EditorProvider`);
  return value;
}

/** The open page's body. Re-renders on every edit. */
export function useEditorDoc(): EditorDocValue {
  return required(useContext(EditorDocContext), 'useEditorDoc');
}

/** The open page's server id, or null for a draft that has none yet. */
export function useDocumentId(): string | null {
  return required(useContext(DocumentSessionContext), 'useDocumentId').documentId;
}

/**
 * Whether the open page is read-only here (a viewer, M6.UI-2). Outside an
 * editor (a block or a card rendered on its own) it is not.
 */
export function usePageReadOnly(): boolean {
  return useContext(DocumentSessionContext)?.readOnly ?? false;
}

/** Which page is open, and whether a switch or a creation is under way. */
export function useDocumentSession(): DocumentSessionValue {
  return required(useContext(DocumentSessionContext), 'useDocumentSession');
}

/** Where saving the open page stands. */
export function useDocumentStatus(): DocumentStatusValue {
  return required(useContext(DocumentStatusContext), 'useDocumentStatus');
}

export function useDocumentActions(): DocumentActionsValue {
  return required(useContext(DocumentActionsContext), 'useDocumentActions');
}

export function useDocumentBody(): DocumentBody {
  return required(useContext(DocumentBodyContext), 'useDocumentBody');
}
