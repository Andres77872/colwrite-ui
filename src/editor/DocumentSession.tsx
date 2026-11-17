import { useCallback, useEffect, useEffectEvent, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { Doc } from './types';
import {
  clearUnsavedDraft,
  loadDoc,
  loadDocumentId,
  loadUnsavedDraft,
  saveDoc,
  saveDocumentId,
  saveUnsavedDraft,
} from './storage';
import { describeSaveError, isSaveConflict, reconcileBlocks, sameContent } from './docOps';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  createDocument as apiCreateDocument,
  saveDocument as apiSaveDocument,
  getDocument as apiGetDocument,
  invalidateDocumentLists,
  pagePlacementQuery,
  setPagePlacement,
  type NewPagePlace,
  type OpenedDocument,
  type TrashRoot,
} from '../data/documents';
import { workspaceQuery } from '../data/workspaces';
import { problemBody, problemCode } from '../api/errors';
import { uid } from '../lib/uid';
import { registerPendingSave } from '../lib/pendingSaves';
import {
  DocumentActionsContext,
  DocumentBodyContext,
  DocumentSessionContext,
  DocumentStatusContext,
  EditorDocContext,
  type DocumentActionsValue,
  type DocumentBody,
  type DocumentSessionValue,
  type DocumentStatusValue,
  type EditorDocValue,
  type EditorHandle,
  type PageInTrash,
  type RestoreReason,
} from './documentSessionState';
import { emitDocumentTransitionStart } from './documentTransition';
import { DEFAULT_DOCUMENT_TITLE } from './types';

/**
 * A new page: no name yet (the title shows its "Untitled" placeholder) and
 * one empty line to write on, rather than sample prose to delete first.
 */
function makeDefaultDoc(): Doc {
  return {
    name: DEFAULT_DOCUMENT_TITLE,
    blocks: [{ id: uid(), type: 'paragraph', html: '', children: [], columns: 1 }],
  };
}

/** The server refused a write for the account's role here (a demotion it has not read yet). */
function isRoleRefusal(error: unknown): boolean {
  return problemCode(error) === 'workspace_role_required';
}

/** What a write said when the page is read-only here: nothing is sent. */
const READ_ONLY_MESSAGE = 'You can view this page, but not edit it.';

/** The page is in the Trash: a read or a write of it is 409 `document_in_trash`. */
function isInTrash(error: unknown): boolean {
  return problemCode(error) === 'document_in_trash';
}

/** What a `document_in_trash` refusal says took the page there, and when it is purged. */
function trashOf(error: unknown, documentId: string): PageInTrash {
  const body = problemBody(error);
  const root = body?.trash_root;
  const trashRoot: TrashRoot = root && (root.kind === 'collection' || root.kind === 'document')
    ? { kind: root.kind, id: root.id }
    : { kind: 'document', id: documentId };
  return { trashRoot, purgeAfter: body?.purge_after ?? null };
}

/** The server's `updated_at` in ms, or null when it is missing or unreadable. */
function savedTime(updatedAt: string | null | undefined): number | null {
  if (!updatedAt) return null;
  const time = Date.parse(updatedAt);
  return Number.isNaN(time) ? null : time;
}

type MountDocumentSelection = {
  committedDocumentId: string | null;
  committedDocument: Doc;
  /** The head the committed body is based on, kept beside it on this device. */
  committedEtag: string | null;
  requestedDocumentId: string | null;
};

function mountDocumentSelection(workspaceId: string, initialDocumentId: string | null): MountDocumentSelection {
  const cachedDocumentId = loadDocumentId(workspaceId);
  const targetDocumentId = initialDocumentId;
  const targetDocument = targetDocumentId ? loadDoc(workspaceId, targetDocumentId) : null;
  const cachedDocument = cachedDocumentId ? loadDoc(workspaceId, cachedDocumentId) : null;
  const localDocument = loadDoc(workspaceId, null);

  // A remote id is committed only when the body beside it is keyed to that
  // exact id. Otherwise the editor owns a safe cached/local body while the
  // remote id remains merely requested.
  const committed = targetDocument ?? cachedDocument;
  return {
    committedDocumentId: committed?.documentId ?? null,
    committedDocument: committed?.doc ?? localDocument?.doc ?? makeDefaultDoc(),
    committedEtag: committed?.etag ?? null,
    requestedDocumentId: targetDocumentId,
  };
}

/** How a body becomes the open page (see `commitDocument`). */
type CommitOptions = {
  /** The page the body belongs to; null for a draft with no server id yet. */
  id: string | null;
  /** Only the transition holding this token may commit; a superseded one changes nothing. */
  token?: number;
  /**
   * Another page rather than a new state of this one: a new document session,
   * and the caret and menus no longer apply.
   */
  newSession: boolean;
  /** When the server last saved the body; left as it is when omitted. */
  savedAt?: number | null;
  /**
   * The head the body is based on, which the next save sends as `If-Match`:
   * null for a draft with no server id yet. Left as it is when omitted.
   */
  etag?: string | null;
  /**
   * The edit revision the server already holds. Omitted, the body is the
   * saved baseline (nothing to autosave); a number keeps later edits dirty,
   * for a draft that acquires an id mid-edit.
   */
  persistedRevision?: number;
  /** Clear the caret and menus without a new session: the body on screen was replaced. */
  resetSurface?: boolean;
};

/**
 * The open page as the server and this device know it: which page it is,
 * its body and the ETag its next save is locked on, loading, saving, local
 * drafts, kept edits and save conflicts. It belongs to one workspace, which
 * every request and every key it keeps on this device names.
 *
 * Editing it is the editor core's job (`EditorProvider`), which reads the
 * body through `DocumentBodyContext` and edits it through `editDoc`.
 */
export function DocumentSessionProvider({
  workspaceId,
  initialDocumentId: initialPage,
  canEdit = true,
  children,
}: {
  workspaceId: string;
  /** The page `WorkspaceScope` chose to open first; null for the starter page. */
  initialDocumentId: string | null;
  /**
   * The account's role here lets it edit (D6): an editor or above. A viewer
   * reads the page, and the session never writes it (M6.UI-2).
   */
  canEdit?: boolean;
  children: ReactNode;
}) {
  // Selecting the page before either provider runs an effect means mount
  // hydration performs one request for it instead of briefly reopening the
  // cached one.
  const [mountSelection] = useState<MountDocumentSelection>(() => mountDocumentSelection(workspaceId, initialPage));
  const initialDocumentId = mountSelection.committedDocumentId;
  const initialRequestedDocumentId = mountSelection.requestedDocumentId;
  const [doc, setDoc] = useState<Doc>(mountSelection.committedDocument);
  const [lastSavedAt, setLastSavedAt] = useState<number | null>(null);
  const [documentId, setDocumentId] = useState<string | null>(initialDocumentId);
  /**
   * Identity of the document the workspace is *on*, as opposed to the id the
   * server knows it by.
   *
   * The two differ for exactly one transition: saving a local draft gives the
   * open document an id without changing which document it is. Anything keyed
   * on `documentId` alone — the assistant's transcript, most of all — would
   * treat that as navigating away and throw the session out mid-sentence.
   */
  const [documentSessionId, setDocumentSessionId] = useState<string>(uid);
  const [isAutoSaving, setIsAutoSaving] = useState<boolean>(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  /**
   * The document whose save the server refused as out of date. Retrying
   * cannot fix that, so autosave stands down until the author picks a version.
   */
  const [conflictId, setConflictId] = useState<string | null>(null);
  /**
   * Edits of a document that never reached the server and are kept on this
   * device (see `saveUnsavedDraft`), offered back while that document is open.
   */
  const [keptDraft, setKeptDraft] = useState<{ documentId: string; savedAt: number } | null>(null);
  const keptDraftRef = useRef<{ documentId: string; savedAt: number } | null>(null);
  const offerKeptDraft = useCallback((next: { documentId: string; savedAt: number } | null) => {
    keptDraftRef.current = next;
    setKeptDraft(next);
  }, []);
  /**
   * The page in the Trash, when it is the open one: autosave stands down
   * until it is restored, and the page says so.
   */
  const [trashed, setTrashed] = useState<(PageInTrash & { documentId: string; markedAt: number }) | null>(null);
  const trashedRef = useRef<string | null>(null);
  const markPageTrashed = useCallback((id: string, trash: PageInTrash) => {
    trashedRef.current = id;
    setTrashed((current) => (current?.documentId === id
      && current.trashRoot.kind === trash.trashRoot.kind
      && current.trashRoot.id === trash.trashRoot.id
      ? current
      : { documentId: id, ...trash, markedAt: Date.now() }));
  }, []);
  const markPageRestored = useCallback((id: string) => {
    if (trashedRef.current === id) trashedRef.current = null;
    setTrashed((current) => (current?.documentId === id ? null : current));
  }, []);
  const trashedId = trashed?.documentId ?? null;
  /**
   * The server refused a save for the account's role, before the workspace
   * read said so: the page is read-only until the role read back changes.
   */
  const [roleRefusal, setRoleRefusal] = useState<{ whileCanEdit: boolean } | null>(null);
  const readOnly = !canEdit || (roleRefusal !== null && roleRefusal.whileCanEdit === canEdit);
  const readOnlyRef = useRef(readOnly);
  useLayoutEffect(() => {
    readOnlyRef.current = readOnly;
  }, [readOnly]);
  /** The page whose unsaved edits were kept on this device when it turned read-only. */
  const [editsKeptFor, setEditsKeptFor] = useState<string | null>(null);
  const [creatingDocument, setCreatingDocument] = useState(false);
  const [loadingDocumentId, setLoadingDocumentId] = useState<string | null>(
    initialRequestedDocumentId,
  );
  const loadingDocumentIdRef = useRef<string | null>(initialRequestedDocumentId);
  const noticeSequenceRef = useRef(0);
  const [documentLoadNotice, setDocumentLoadNotice] = useState<
    DocumentStatusValue['documentLoadNotice']
  >(null);
  const [lastSaveSource, setLastSaveSource] = useState<'auto' | 'manual' | null>(null);

  // Saves are locked on the head's ETag (`If-Match`). It lives in a ref
  // rather than in `doc`, because adopting a new one must NOT look like a
  // content change — `doc` is an autosave dependency, so writing it there
  // would re-arm the timer and the editor would save itself forever. Null for
  // a draft the server has not seen.
  const etagRef = useRef<string | null>(mountSelection.committedEtag);
  // Moves whenever the ETag is replaced by anything but this session's own
  // save (a load, a creation, a restore, a conflict settled). A save's answer
  // is adopted only if the epoch it started in is still current: one that was
  // in flight across a restore describes a head the page is no longer on.
  const etagEpochRef = useRef(0);

  // Revisions distinguish real edits from navigation. A document is dirty
  // only while its edit revision is newer than the revision last confirmed by
  // the server. Merely opening or leaving a document must not change
  // `updated_at`.
  const [dirtyTick, setDirtyTick] = useState(0);
  const editRevisionRef = useRef(0);
  const persistedRevisionRef = useRef(0);
  const afterSaveRef = useRef<Array<{ revision: number; run: () => void }>>([]);
  const saveInFlightRef = useRef<Promise<void> | null>(null);
  // Creating, deleting and restoring change what the page lists hold, so they
  // read again; a save patches the open row instead.
  const queryClient = useQueryClient();
  const listsChanged = useCallback(() => {
    void invalidateDocumentLists(queryClient, workspaceId);
  }, [queryClient, workspaceId]);
  // Where a page lives comes with its read and its creation; the breadcrumb,
  // "New page here" and the tree read it from there, and a move updates it.
  const notePlacement = useCallback((opened: OpenedDocument) => {
    setPagePlacement(queryClient, workspaceId, opened.placement);
  }, [queryClient, workspaceId]);
  const [restoreEpoch, setRestoreEpoch] = useState(0);
  const [restoreReason, setRestoreReason] = useState<RestoreReason>('restore');
  const autoSaveTimerRef = useRef<number | null>(null);
  // Mirrors `isAutoSaving` for readers that run outside React's render cycle —
  // specifically the beforeunload guard, which has to answer "is there
  // unsaved work" synchronously at event time.
  const isAutoSavingRef = useRef(false);
  /**
   * The account signed out (`endPendingSaves`). From then on nothing is saved
   * and nothing is written to this device: sign-out has cleared, or is about
   * to clear, every key of the account.
   */
  const endedRef = useRef(false);
  /** The editor core below, once it has mounted. */
  const editorRef = useRef<EditorHandle | null>(null);

  // Latest doc/id without waiting for a re-render. Callbacks captured by the
  // chat stream can outlive several renders, and saving from a stale closure
  // is how edits get silently reverted.
  //
  // Every writer goes through `commitDoc`, so this ref is current the moment
  // a change is made rather than one commit later. `applyPatch` depends on
  // that: it has to report which blocks it touched to its caller, and it
  // cannot learn that from inside a `setState` updater React runs whenever it
  // likes.
  const docRef = useRef(doc);
  const documentIdRef = useRef(documentId);
  useEffect(() => {
    docRef.current = doc;
    documentIdRef.current = documentId;
  }, [doc, documentId]);

  const commitDoc = useCallback((next: Doc) => {
    docRef.current = next;
    setDoc(next);
  }, []);

  const cancelAutoSave = useCallback(() => {
    if (autoSaveTimerRef.current !== null) {
      clearTimeout(autoSaveTimerRef.current);
      autoSaveTimerRef.current = null;
    }
  }, []);

  // Which document the in-state `doc` was actually loaded for. Without this a
  // PUT can write one document's body over another's — the id and the body are
  // separate pieces of state that briefly disagree while switching documents.
  const loadedForIdRef = useRef<string | null>(documentId);
  // All document loads share one sequence. A transition reserves its token
  // before doing any asynchronous work; only that token may later commit or
  // report a failure. Mount hydration owns token zero.
  const documentRequestRef = useRef(0);
  const documentLoadControllerRef = useRef<AbortController | null>(null);
  const beginDocumentTransition = useCallback((id: string | null) => {
    documentRequestRef.current += 1;
    emitDocumentTransitionStart();
    documentLoadControllerRef.current?.abort();
    documentLoadControllerRef.current = null;
    loadingDocumentIdRef.current = id;
    setLoadingDocumentId(id);
    setDocumentLoadNotice(null);
    cancelAutoSave();
    return documentRequestRef.current;
  }, [cancelAutoSave]);
  const finishDocumentTransition = useCallback((requestToken: number) => {
    if (requestToken !== documentRequestRef.current) return;
    loadingDocumentIdRef.current = null;
    setLoadingDocumentId(null);
    documentLoadControllerRef.current = null;
  }, []);
  const reportDocumentLoadFailure = useCallback((
    error: unknown,
    options?: { mount?: boolean; source?: 'selection' | 'history' },
  ) => {
    if (isInTrash(error)) {
      setDocumentLoadNotice({
        id: ++noticeSequenceRef.current,
        title: 'That page is in the Trash',
        description: 'Restore it from the Trash to open it. Your current page stays open.',
      });
      return;
    }
    const detail = error instanceof Error && error.message
      ? error.message
      : 'The request failed.';
    const title = options?.source === 'history'
      ? 'Could not go back to that page'
      : 'Could not open page';
    setDocumentLoadNotice({
      id: ++noticeSequenceRef.current,
      title,
      description: options?.mount
        ? `${detail} Showing your local copy.`
        : `${detail} Your current page stays open.`,
    });
  }, []);

  // The workspace's page count decides the first-run screen. The workspace
  // read already has it, and it reads again with the page lists (a creation
  // or a delete). Only the starter page shows it, so only then is it read.
  const workspace = useQuery({ ...workspaceQuery(workspaceId), enabled: documentId === null });
  const pageCount = workspace.data?.counts.pages ?? null;

  // A page sent to the Trash from another tab, or with its collection, is
  // found when where it lives is read again: the tree does that when the
  // workspace's `tree_version` moved elsewhere, and a trash here does it too.
  // A read of a page in the Trash is 409 `document_in_trash`. The page's own
  // read fills the placement, so this observer asks nothing of its own.
  const placement = useQuery({
    ...pagePlacementQuery(workspaceId, documentId ?? ''),
    enabled: documentId !== null && loadingDocumentId === null,
  });
  const placementError = placement.status === 'error' && placement.errorUpdatedAt > placement.dataUpdatedAt
    ? placement.error
    : null;
  // Read again after it was marked, and found: it was restored, here or elsewhere.
  const placementReadAt = placement.status === 'success' ? placement.dataUpdatedAt : 0;
  const trashedMarkedAt = trashed && trashed.documentId === documentId ? trashed.markedAt : null;
  useEffect(() => {
    if (!documentId) return;
    if (placementError && isInTrash(placementError)) {
      markPageTrashed(documentId, trashOf(placementError, documentId));
    } else if (trashedMarkedAt !== null && placementReadAt > trashedMarkedAt) {
      markPageRestored(documentId);
    }
  }, [documentId, markPageRestored, markPageTrashed, placementError, placementReadAt, trashedMarkedAt]);

  // Local draft cache, keyed by the document it belongs to.
  useEffect(() => {
    if (loadingDocumentId !== null) return;
    const raf = requestAnimationFrame(() => {
      if (loadingDocumentIdRef.current === null && !endedRef.current) saveDoc(workspaceId, doc, documentId, etagRef.current);
    });
    return () => cancelAnimationFrame(raf);
  }, [doc, documentId, loadingDocumentId, workspaceId]);

  // Persist current document id
  useEffect(() => {
    if (loadingDocumentId !== null || endedRef.current) return;
    saveDocumentId(workspaceId, documentId);
  }, [documentId, loadingDocumentId, workspaceId]);

  /** An edit: arms the autosave timer and goes into the editor's undo journal. */
  const editDoc = useCallback((updater: (prev: Doc) => Doc, coalesceKey: string | null = null) => {
    if (loadingDocumentIdRef.current !== null) return;
    // A read-only page takes no edit: nothing the author can do there may
    // change a body the session would then have to save.
    if (readOnlyRef.current) return;
    const before = docRef.current;
    editRevisionRef.current += 1;
    const next = updater(before);
    commitDoc(next);
    setDirtyTick(editRevisionRef.current);
    editorRef.current?.journal(before, next, coalesceKey);
  }, [commitDoc]);

  /**
   * Put a body on screen as the page `id`.
   *
   * Every transition that adopts a document — opening one, creating one,
   * starting a local draft, giving a draft its id, taking a server-side
   * restore — goes through here, so the body, its id, its ETag and the
   * dirty revisions can never be left half-switched. Returns false when the
   * transition was superseded and nothing changed.
   */
  const commitDocument = useCallback((next: Doc, options: CommitOptions): boolean => {
    if (options.token !== undefined && options.token !== documentRequestRef.current) return false;
    if (options.newSession) setDocumentSessionId(uid());
    if (next !== docRef.current) commitDoc(next);
    if (options.etag !== undefined) {
      etagRef.current = options.etag;
      etagEpochRef.current += 1;
    }
    if (options.persistedRevision === undefined) {
      editRevisionRef.current = 0;
      persistedRevisionRef.current = 0;
      afterSaveRef.current = [];
      setDirtyTick(0);
    } else {
      persistedRevisionRef.current = options.persistedRevision;
    }
    setDocumentId(options.id);
    documentIdRef.current = options.id;
    loadedForIdRef.current = options.id;
    if (options.savedAt !== undefined) setLastSavedAt(options.savedAt);
    setSaveError(null);
    if (options.newSession || options.resetSurface) {
      editorRef.current?.clearActive();
      editorRef.current?.closeMenus();
    }
    if (options.newSession) {
      editorRef.current?.resetHistory();
      editorRef.current?.clearSelection();
    }
    return true;
  }, [commitDoc]);

  /**
   * Adopt a server-side restore of the open document.
   *
   * A restore is written by the server outside the editor's save path, so the
   * restored content and its ETag become the new persisted baseline. That is
   * neither an edit (autosave must not re-save what the server just wrote)
   * nor a navigation (the document session — and with it the assistant
   * transcript — must survive).
   */
  const adoptRestoredDocument = useCallback((
    next: Doc,
    etag: string,
    reason: RestoreReason = 'restore',
  ) => {
    cancelAutoSave();
    commitDocument(
      { ...next, blocks: reconcileBlocks(next.blocks) },
      { id: documentIdRef.current, newSession: false, etag },
    );
    // The document is now a different version of its tree: anything staged
    // against the pre-restore content (pending proposals, in-flight agent
    // streams, the undo journal) must not apply to it.
    editorRef.current?.resetHistory();
    setRestoreReason(reason);
    setRestoreEpoch(epoch => epoch + 1);
    // The restore changed `updated_at` server-side, so list order can change.
    listsChanged();
  }, [cancelAutoSave, commitDocument, listsChanged]);

  const newLocal = useCallback(() => {
    const requestToken = beginDocumentTransition(null);
    commitDocument(makeDefaultDoc(), { id: null, newSession: true, savedAt: null, etag: null });
    finishDocumentTransition(requestToken);
  }, [beginDocumentTransition, commitDocument, finishDocumentTransition]);

  // API-backed persistence
  const createRemote = useCallback(async (docOverride?: Doc): Promise<string> => {
    if (readOnlyRef.current) throw new Error(READ_ONLY_MESSAGE);
    const requestToken = beginDocumentTransition(null);
    const payload = docOverride ?? docRef.current;
    const revisionAtStart = editRevisionRef.current;
    const res = await apiCreateDocument(workspaceId, payload);
    notePlacement(res);

    // The creation itself succeeded even if navigation moved on while it was
    // in flight, so list metadata still changes. Only the still-current
    // transition may adopt the created document into the editor.
    commitDocument(docRef.current, {
      id: res.id,
      token: requestToken,
      etag: res.etag,
      // Deliberately not a new document session: this is the document that
      // was already open, now with an id the server recognises.
      newSession: false,
      persistedRevision: revisionAtStart,
      // The caret stays where it is. Clearing the active block unconditionally
      // made saving a draft mid-edit look like a document switch to `Editable`,
      // which then rewrote the paragraph's DOM from state — throwing away an AI
      // suggestion or a streaming widget the author was in the middle of. Only
      // a caller that replaced the body on screen has invalidated it.
      resetSurface: docOverride !== undefined,
    });
    listsChanged();
    return res.id;
  }, [beginDocumentTransition, commitDocument, listsChanged, notePlacement, workspaceId]);

  /**
   * Keep the open document's unsaved body on this device.
   *
   * Called when unsaved work is about to leave the screen: a switch whose
   * flush failed, the tab closing, the editor unmounting, the author
   * opening the server's newer version over their own, or the page turning
   * read-only.
   */
  const keepUnsavedEdits = useCallback((): boolean => {
    if (endedRef.current) return false;
    const id = documentIdRef.current;
    // No check for a transition in flight: a switch calls this after its own
    // transition began, and the body cannot change while one is.
    if (!id || loadedForIdRef.current !== id) return false;
    if (editRevisionRef.current <= persistedRevisionRef.current) return false;
    saveUnsavedDraft(workspaceId, id, docRef.current);
    return true;
  }, [workspaceId]);

  // Serialize saves so a switch can wait for an active autosave, then
  // re-check whether a newer edit still needs its own write.
  const doRemoteSave = useCallback(async (source: 'auto' | 'manual', docOverride?: Doc): Promise<void> => {
    if (endedRef.current) return;
    // A read-only page is never written: what it holds stays on this device.
    if (readOnlyRef.current) {
      keepUnsavedEdits();
      return;
    }
    // Cancel any pending autosave timer to avoid duplicate saves
    cancelAutoSave();
    // Snapshot before any await: an override is a body snapshot of the
    // document open *at call time*, and the workspace can move to another
    // document while a queued save below is awaited.
    const originId = documentIdRef.current;
    const pendingSave = saveInFlightRef.current;
    if (pendingSave) {
      try {
        await pendingSave;
      } catch {
        // The caller that started the failed request reports it. Re-evaluate
        // the current dirty revision here so an explicit retry can proceed.
      }
    }

    const targetId = documentIdRef.current;
    if (!targetId) {
      if (docOverride !== undefined && documentIdRef.current !== originId) return;
      const createdId = await createRemote(docOverride ?? docRef.current);
      if (
        documentIdRef.current === createdId
        && loadedForIdRef.current === createdId
      ) {
        setLastSavedAt(Date.now());
        setLastSaveSource(source);
      }
      return;
    }

    // Never write the in-state body to a document it did not come from. The id
    // and the body are separate state, and they disagree for a moment while
    // switching documents — long enough for a queued autosave to land.
    if (loadedForIdRef.current !== targetId) {
      return;
    }
    // An override body came from the document that was open at call time; if
    // the editor moved on, this PUT would write that body over the newly
    // active document — and the lock would not catch it, because the ETag
    // moved with the switch.
    if (docOverride !== undefined && targetId !== originId) {
      return;
    }

    const revisionAtStart = editRevisionRef.current;
    const hasUnsavedRevision = revisionAtStart > persistedRevisionRef.current;
    if (!hasUnsavedRevision && docOverride === undefined) {
      if (source === 'manual') {
        setSaveError(null);
        setLastSavedAt(Date.now());
        setLastSaveSource(source);
      }
      return;
    }

    const payload = docOverride ?? docRef.current;
    const etag = etagRef.current;
    const epochAtStart = etagEpochRef.current;
    if (!etag) throw new Error('The page has not been read from the server yet.');

    const request = (async () => {
      const res = await apiSaveDocument(workspaceId, targetId, payload, etag);
      // The server has this body now. A copy kept from an earlier failure is
      // older than it — unless it is on offer, and then the author decides.
      if (keptDraftRef.current?.documentId !== targetId) clearUnsavedDraft(workspaceId, targetId);
      setConflictId(current => (current === targetId ? null : current));

      // A local reset can happen while a request is in flight. The old
      // document was still saved, but its response must not alter the newly
      // active document's ETag or clean revision.
      if (
        documentIdRef.current !== targetId
        || loadedForIdRef.current !== targetId
      ) {
        return;
      }

      // A stale response (a save that was in flight across a restore) is
      // neither the head the page is on nor a revision it holds: the next
      // edit must not count as already saved.
      if (epochAtStart === etagEpochRef.current) {
        etagRef.current = res.etag;
        persistedRevisionRef.current = Math.max(
          persistedRevisionRef.current,
          revisionAtStart,
        );
        // The local copy is based on the new head now.
        if (!endedRef.current) saveDoc(workspaceId, docRef.current, targetId, res.etag);
        const ready = afterSaveRef.current.filter(({ revision }) => revision <= revisionAtStart);
        afterSaveRef.current = afterSaveRef.current.filter(({ revision }) => revision > revisionAtStart);
        if (!endedRef.current) for (const { run } of ready) run();
      }
      setSaveError(null);
      setLastSavedAt(Date.now());
      setLastSaveSource(source);
    })();

    saveInFlightRef.current = request;
    try {
      await request;
    } finally {
      if (saveInFlightRef.current === request) {
        saveInFlightRef.current = null;
      }
    }
  }, [cancelAutoSave, createRemote, keepUnsavedEdits, workspaceId]);

  const saveRemote = useCallback(async (docOverride?: Doc): Promise<void> => {
    await doRemoteSave('manual', docOverride);
  }, [doRemoteSave]);

  /**
   * Give the open document a server id, creating it if it does not have one.
   *
   * Everything the assistant does is addressed by document id: the agent reads
   * and edits `document_id`, and a chat session is stored against it. A draft
   * that exists only in this browser therefore has nothing to talk about — the
   * old behaviour was to refuse and tell the author to save first, which is a
   * chore in the middle of a sentence they are asking for help with.
   *
   * Concurrent callers share one creation. Returning `null` means the document
   * could not be created, which the caller reports; it never throws past here
   * because the writing surface stays usable either way.
   */
  const attachInFlightRef = useRef<Promise<string | null> | null>(null);
  const ensureRemoteDocument = useCallback(async (): Promise<string | null> => {
    if (documentIdRef.current) return documentIdRef.current;
    // A viewer cannot create the page a draft would become.
    if (readOnlyRef.current) return null;
    if (attachInFlightRef.current) return attachInFlightRef.current;

    const request = (async () => {
      try {
        return await createRemote();
      } catch (error) {
        setSaveError(describeSaveError(error));
        return null;
      }
    })();

    attachInFlightRef.current = request;
    try {
      return await request;
    } finally {
      if (attachInFlightRef.current === request) attachInFlightRef.current = null;
    }
  }, [createRemote]);

  const loadRemoteForRequest = useCallback(async (
    id: string,
    requestToken: number,
  ): Promise<boolean> => {
    // A newer transition can supersede this one while it is waiting for a dirty
    // save to flush. Do not start an obsolete GET afterward.
    if (requestToken !== documentRequestRef.current) return false;

    let fetched: OpenedDocument;
    const controller = new AbortController();
    documentLoadControllerRef.current = controller;
    try {
      fetched = await apiGetDocument(workspaceId, id, { signal: controller.signal });
    } catch (error) {
      // Callers surface only the latest failure. An older request failing after
      // the author has moved on is no longer actionable.
      if (requestToken !== documentRequestRef.current || controller.signal.aborted) return false;
      throw error;
    }
    if (controller.signal.aborted) return false;
    notePlacement(fetched);

    // Keep html and children in step, so an orphan does not keep failing the
    // agent's edits.
    const loaded: Doc = { ...fetched.doc, blocks: reconcileBlocks(fetched.doc.blocks) };
    const committed = commitDocument(loaded, {
      id,
      token: requestToken,
      newSession: true,
      savedAt: savedTime(fetched.updatedAt),
      etag: fetched.etag,
    });
    if (!committed) return false;
    setConflictId(null);
    // Edits that never reached the server the last time this document was
    // open. They are offered, never applied: the server copy may be newer.
    const kept = loadUnsavedDraft(workspaceId, id);
    if (kept && !sameContent(kept.doc, loaded)) {
      // Read-only here, they cannot be put back: they wait on this device
      // for an open that can edit.
      offerKeptDraft(readOnlyRef.current ? null : { documentId: id, savedAt: kept.savedAt });
    } else {
      if (kept) clearUnsavedDraft(workspaceId, id);
      offerKeptDraft(null);
    }
    return true;
  }, [commitDocument, notePlacement, offerKeptDraft, workspaceId]);

  const loadRemote = useCallback(async (id: string): Promise<boolean> => {
    if (id === documentIdRef.current && loadingDocumentIdRef.current === null) return true;
    if (id === loadingDocumentIdRef.current) return false;
    const requestToken = beginDocumentTransition(id);
    try {
      return await loadRemoteForRequest(id, requestToken);
    } catch (error) {
      if (requestToken === documentRequestRef.current) {
        reportDocumentLoadFailure(error);
      }
      throw error;
    } finally {
      finishDocumentTransition(requestToken);
    }
  }, [beginDocumentTransition, loadRemoteForRequest, reportDocumentLoadFailure, finishDocumentTransition]);

  const hydrateRemote = useEffectEvent(
    (id: string, requestToken: number) => loadRemoteForRequest(id, requestToken),
  );
  const autoSave = useEffectEvent(() => doRemoteSave('auto'));
  const autoSaveRetryRef = useRef(0);

  /**
   * Show a failed save, and stand autosave down when it was a conflict, or
   * when the page went to the Trash meanwhile: the page says so instead.
   */
  const reportSaveFailure = useCallback((error: unknown) => {
    const id = documentIdRef.current;
    if (isInTrash(error) && id) {
      setSaveError(null);
      markPageTrashed(id, trashOf(error, id));
      return;
    }
    // The account's role here no longer allows the write: the page turns
    // read-only at once, its edits are kept on this device, and the
    // workspace is read again for the role.
    if (isRoleRefusal(error)) {
      setSaveError(null);
      setRoleRefusal({ whileCanEdit: canEdit });
      // Read now, whoever else watches it: the role read back decides.
      void queryClient.fetchQuery({ ...workspaceQuery(workspaceId), staleTime: 0 }).catch(() => undefined);
      return;
    }
    setSaveError(describeSaveError(error));
    if (isSaveConflict(error) && id) setConflictId(id);
  }, [canEdit, markPageTrashed, queryClient, workspaceId]);

  useEffect(() => {
    // `pagehide` rather than `beforeunload`: it also fires when a phone puts
    // the tab away, and it does not fire when the author cancels leaving.
    const onPageHide = () => { keepUnsavedEdits(); };
    window.addEventListener('pagehide', onPageHide);
    return () => window.removeEventListener('pagehide', onPageHide);
  }, [keepUnsavedEdits]);

  /** Edits the server has not confirmed, of a body that belongs to the open page. */
  const hasUnflushedEdits = useCallback(() => (
    editRevisionRef.current > persistedRevisionRef.current
    && (documentIdRef.current
      ? loadedForIdRef.current === documentIdRef.current
      : editRevisionRef.current > 0)
  ), []);

  /**
   * Send the unsaved edits, or keep them on this device when the server does
   * not take them. Never throws; the failure comes back for the caller to show.
   *
   * A draft without a server id is created remotely, where it used to be
   * silently abandoned in the local cache with no way back.
   */
  const flushEdits = useCallback(async (): Promise<{ cause: unknown } | null> => {
    // A page in the Trash takes no save: its edits are kept on this device
    // and offered back if it is restored and opened again.
    if (documentIdRef.current !== null && trashedRef.current === documentIdRef.current) {
      keepUnsavedEdits();
      return null;
    }
    // Nor does a read-only one: the edits wait on this device.
    if (readOnlyRef.current) {
      keepUnsavedEdits();
      return null;
    }
    try {
      await doRemoteSave('auto');
      return null;
    } catch (cause) {
      // The keyed draft cache cannot do this: the next load of the page from
      // the server overwrites it.
      keepUnsavedEdits();
      return { cause };
    }
  }, [doRemoteSave, keepUnsavedEdits]);

  const flushPendingSave = useCallback(async (): Promise<boolean> => {
    if (endedRef.current || !hasUnflushedEdits()) return true;
    const failure = await flushEdits();
    if (failure) reportSaveFailure(failure.cause);
    return failure === null;
  }, [flushEdits, hasUnflushedEdits, reportSaveFailure]);

  const afterDocumentSaved = useCallback((id: string, run: () => void) => {
    if (endedRef.current || documentIdRef.current !== id || loadedForIdRef.current !== id) return;
    const revision = editRevisionRef.current;
    if (revision <= persistedRevisionRef.current) run();
    else afterSaveRef.current.push({ revision, run });
  }, []);

  // A deliberate sign-out flushes through here before the account's storage
  // is cleared, then ends the session so nothing is written back after it.
  useEffect(() => registerPendingSave({
    flush: flushPendingSave,
    end: () => {
      endedRef.current = true;
      cancelAutoSave();
    },
  }), [flushPendingSave, cancelAutoSave]);

  /**
   * The editor is going away (a scope remount, the surface unmounting) with
   * edits still inside the autosave window. The body is kept on this device
   * first, synchronously, because the save below may never finish; a save
   * that does finish removes the kept copy again.
   *
   * A draft with no server id is not created from here: its local cache is
   * written instead, and the next mount opens it from there.
   */
  const flushOnUnmount = useCallback(() => {
    if (endedRef.current || loadingDocumentIdRef.current !== null) return;
    saveDoc(workspaceId, docRef.current, documentIdRef.current, etagRef.current);
    if (!documentIdRef.current || !keepUnsavedEdits()) return;
    void flushEdits();
  }, [flushEdits, keepUnsavedEdits, workspaceId]);
  useEffect(() => () => flushOnUnmount(), [flushOnUnmount]);

  const autoSaveAttempt = useEffectEvent(async function attemptAutoSave() {
    isAutoSavingRef.current = true;
    setIsAutoSaving(true);
    try {
      await autoSave();
      autoSaveRetryRef.current = 0;
    } catch (error) {
      reportSaveFailure(error);
      // A transient failure used to leave the server stale until the next
      // keystroke. Retry with capped backoff (15s, 30s, 60s); a new edit
      // re-arms the normal debounce via `dirtyTick` and resets the backoff.
      // A stale head is not transient: the same save is refused every time,
      // so it waits for the author's choice instead.
      if (!isSaveConflict(error) && !isInTrash(error) && !isRoleRefusal(error) && editRevisionRef.current > persistedRevisionRef.current) {
        const attempt = autoSaveRetryRef.current++;
        const delay = Math.min(15000 * 2 ** attempt, 60000);
        autoSaveTimerRef.current = window.setTimeout(() => {
          autoSaveTimerRef.current = null;
          void attemptAutoSave();
        }, delay);
      }
    } finally {
      isAutoSavingRef.current = false;
      setIsAutoSaving(false);
    }
  });

  // Hydrate from the server on mount. The cached draft is a fallback for going
  // offline, not a source of truth: adopting it unconditionally meant a stale
  // (or another account's) body could be saved over the real document.
  useEffect(() => {
    const id = initialRequestedDocumentId;
    if (!id) return;

    let cancelled = false;
    const hydrationToken = 0;
    void hydrateRemote(id, hydrationToken)
      .catch((error) => {
        if (!cancelled && hydrationToken === documentRequestRef.current) {
          // This device's copy of a page in the Trash is on screen: the page
          // says it is in the Trash, with Restore, rather than that it failed.
          if (isInTrash(error) && documentIdRef.current === id) {
            markPageTrashed(id, trashOf(error, id));
            return;
          }
          // The committed state was selected synchronously from a body keyed to
          // its own id, so failure only has to reveal it again.
          reportDocumentLoadFailure(error, { mount: true });
        }
      })
      .finally(() => {
        if (!cancelled && hydrationToken === documentRequestRef.current) {
          finishDocumentTransition(hydrationToken);
        }
      });
    return () => {
      cancelled = true;
      if (hydrationToken === documentRequestRef.current) {
        documentLoadControllerRef.current?.abort();
        documentLoadControllerRef.current = null;
      }
    };
    // Mount only: later document switches go through loadRemote/switchTo.
    // The two transition helpers are stable callbacks; listing them does not
    // re-arm the effect.
  }, [initialRequestedDocumentId, reportDocumentLoadFailure, finishDocumentTransition, markPageTrashed]);

  // Debounced remote auto-save (5 seconds after last change).
  // Keyed on `dirtyTick` rather than `doc` so adopting a server head does not
  // count as a change and re-arm the timer. The starter page is saved like
  // any other: its first save creates it.
  useEffect(() => {
    if (
      loadingDocumentId !== null
      || dirtyTick === 0
      || endedRef.current
      || editRevisionRef.current <= persistedRevisionRef.current
    ) {
      return;
    }

    cancelAutoSave();

    // The server refuses every save until the conflict is settled, and every
    // save of a page in the Trash until it is restored.
    if (conflictId !== null && conflictId === documentId) return;
    if (trashedId !== null && trashedId === documentId) return;
    // A read-only page is never saved; edits made before it turned so wait
    // on this device, and go out again if the role comes back.
    if (readOnly) return;

    // A new edit supersedes any pending retry and starts the backoff over.
    autoSaveRetryRef.current = 0;
    autoSaveTimerRef.current = window.setTimeout(() => {
      autoSaveTimerRef.current = null;
      void autoSaveAttempt();
    }, 5000);
    return cancelAutoSave;
  }, [cancelAutoSave, dirtyTick, documentId, loadingDocumentId, conflictId, trashedId, readOnly]);

  // The page turned read-only (a demotion read, or a save refused for the
  // role): what the server never got is kept on this device, and the page
  // says so. Nothing is sent from now on.
  const noteEditsKept = useCallback((id: string | null) => setEditsKeptFor(id), []);
  useEffect(() => {
    if (!readOnly) return;
    cancelAutoSave();
    if (keepUnsavedEdits()) noteEditsKept(documentIdRef.current);
  }, [cancelAutoSave, keepUnsavedEdits, noteEditsKept, readOnly]);

  /** Save pending local edits (or keep them), then switch to another document. */
  const switchTo = useCallback(async (
    id: string,
    options?: { source?: 'selection' | 'history' },
  ): Promise<boolean> => {
    if (id === documentIdRef.current && loadingDocumentIdRef.current === null) return true;
    // Duplicate activation is ignored without disabling the row, so focus stays
    // where the author put it and a different row can still supersede the load.
    if (id === loadingDocumentIdRef.current) return false;
    let requestToken = beginDocumentTransition(id);
    // Switching used to drop whatever had not hit the 5s autosave yet. The
    // assistant creating a document made that a routine occurrence.
    if (hasUnflushedEdits()) {
      // A failed flush must not block the switch: the author asked to move
      // on. The edits the server did not take are kept on this device and
      // offered back the next time this document opens.
      const failure = await flushEdits();
      if (failure && requestToken === documentRequestRef.current) {
        setSaveError(describeSaveError(failure.cause));
      }
      // Creating the draft remotely ran its own document transition, which
      // superseded this switch's token. Re-mark the pending switch before
      // loading; harmless when the flush kept the token all along.
      requestToken = beginDocumentTransition(id);
    }
    try {
      return await loadRemoteForRequest(id, requestToken);
    } catch (error) {
      if (requestToken === documentRequestRef.current) {
        reportDocumentLoadFailure(error, { source: options?.source });
      }
      throw error;
    } finally {
      finishDocumentTransition(requestToken);
    }
  }, [beginDocumentTransition, flushEdits, hasUnflushedEdits, loadRemoteForRequest, reportDocumentLoadFailure, finishDocumentTransition]);

  const createInFlightRef = useRef<Promise<string> | null>(null);
  const createAndSwitch = useCallback((input: Doc, place: NewPagePlace = {}): Promise<string> => {
    if (createInFlightRef.current) return createInFlightRef.current;
    if (readOnlyRef.current) return Promise.reject(new Error(READ_ONLY_MESSAGE));
    const creation = (async (): Promise<string> => {
      // As for a switch, edits the server does not take are kept on this
      // device rather than holding up the new page.
      if (hasUnflushedEdits()) {
        const failure = await flushEdits();
        if (failure) setSaveError(describeSaveError(failure.cause));
      }

      const requestToken = beginDocumentTransition(null);
      const res = await apiCreateDocument(workspaceId, input, place);
      notePlacement(res);
      const committed = commitDocument(input, {
        id: res.id,
        token: requestToken,
        newSession: true,
        savedAt: Date.now(),
        etag: res.etag,
      });
      if (committed) setLastSaveSource('manual');
      listsChanged();
      return res.id;
    })();
    createInFlightRef.current = creation;
    setCreatingDocument(true);
    const settle = () => {
      if (createInFlightRef.current !== creation) return;
      createInFlightRef.current = null;
      setCreatingDocument(false);
    };
    creation.then(settle, settle);
    return creation;
  }, [beginDocumentTransition, commitDocument, flushEdits, hasUnflushedEdits, listsChanged, notePlacement, workspaceId]);

  const save = useCallback(() => {
    if (loadingDocumentIdRef.current !== null) return;
    if (readOnlyRef.current) return;
    // Refs rather than state closures: the save must describe the document as
    // it is at call time, and closing over `doc`/`documentId` would make this
    // action change identity on every edit.
    saveDoc(workspaceId, docRef.current, documentIdRef.current, etagRef.current);
    saveDocumentId(workspaceId, documentIdRef.current);
    // Ctrl+S must mean what the header shows: a save the server actually
    // received. Writing only the local cache here used to flash "Saved" while
    // the server copy stayed stale until the next autosave.
    const shouldPersistRemote =
      documentIdRef.current !== null || editRevisionRef.current > persistedRevisionRef.current;
    if (shouldPersistRemote) {
      void doRemoteSave('manual').catch(reportSaveFailure);
      return;
    }
    setLastSavedAt(Date.now());
    setLastSaveSource('manual');
  }, [doRemoteSave, reportSaveFailure, workspaceId]);

  /**
   * Settle a save the server refused because someone saved the page since
   * the head it was based on (412 `stale_head`).
   *
   * `mine` writes this body over the newer version. `theirs` opens the newer
   * version and keeps this body on the device, where the kept-edits bar offers
   * it back — so neither choice destroys anything the author wrote.
   */
  const resolveSaveConflict = useCallback(async (keep: 'mine' | 'theirs'): Promise<void> => {
    const id = documentIdRef.current;
    if (!id || loadedForIdRef.current !== id) return;
    let latest: OpenedDocument;
    try {
      latest = await apiGetDocument(workspaceId, id);
    } catch (error) {
      setSaveError(describeSaveError(error));
      return;
    }
    if (documentIdRef.current !== id || loadedForIdRef.current !== id) return;

    if (keep === 'theirs') {
      if (keepUnsavedEdits()) offerKeptDraft({ documentId: id, savedAt: Date.now() });
      setConflictId(null);
      adoptRestoredDocument(latest.doc, latest.etag, 'newer-version');
      setLastSavedAt(savedTime(latest.updatedAt));
      editorRef.current?.clearActive();
      return;
    }

    // Lock on the head that is there now, so this save replaces it. The
    // conflict stays until the save lands (`doRemoteSave` clears it): clearing
    // it first armed an autosave for the edit still in flight, which then
    // found nothing to send and left the status at "Unsaved".
    etagRef.current = latest.etag;
    etagEpochRef.current += 1;
    try {
      await doRemoteSave('manual');
    } catch (error) {
      // Refused again when someone wrote in between: the choice comes back.
      reportSaveFailure(error);
    }
  }, [adoptRestoredDocument, doRemoteSave, keepUnsavedEdits, offerKeptDraft, reportSaveFailure, workspaceId]);

  /** Put the kept edits back as one undoable change, which autosave then sends. */
  const restoreKeptDraft = useCallback((): boolean => {
    if (readOnlyRef.current) return false;
    const id = documentIdRef.current;
    const kept = id ? loadUnsavedDraft(workspaceId, id) : null;
    offerKeptDraft(null);
    if (!id || !kept || loadedForIdRef.current !== id) return false;
    clearUnsavedDraft(workspaceId, id);
    editorRef.current?.clearActive();
    editDoc(() => ({ ...kept.doc, blocks: reconcileBlocks(kept.doc.blocks) }));
    return true;
  }, [editDoc, offerKeptDraft, workspaceId]);

  const discardKeptDraft = useCallback(() => {
    const id = documentIdRef.current;
    if (id) clearUnsavedDraft(workspaceId, id);
    offerKeptDraft(null);
  }, [offerKeptDraft, workspaceId]);

  // Read-only, nothing is pending: nothing will be sent, and what the server
  // never got was kept on this device when the page turned read-only.
  const hasPendingEdits = useCallback(() => !readOnlyRef.current && (
    editRevisionRef.current > persistedRevisionRef.current
    || autoSaveTimerRef.current !== null
    || isAutoSavingRef.current
  ), []);

  const clearSaveError = useCallback(() => setSaveError(null), []);
  const clearDocumentLoadNotice = useCallback(() => setDocumentLoadNotice(null), []);

  const body: DocumentBody = useMemo(() => ({
    readDoc: () => docRef.current,
    commitDoc,
    editDoc,
    isLoading: () => loadingDocumentIdRef.current !== null,
    getEditRevision: () => editRevisionRef.current,
    attachEditor: (editor: EditorHandle) => {
      editorRef.current = editor;
      return () => {
        if (editorRef.current === editor) editorRef.current = null;
      };
    },
  }), [commitDoc, editDoc]);

  const actions: DocumentActionsValue = useMemo(() => ({
    save,
    saveRemote,
    flushPendingSave,
    afterDocumentSaved,
    createRemote,
    createAndSwitch,
    ensureRemoteDocument,
    loadRemote,
    switchTo,
    newLocal,
    markPageTrashed,
    markPageRestored,
    hasPendingEdits,
    resolveSaveConflict,
    restoreKeptDraft,
    discardKeptDraft,
    clearSaveError,
    clearDocumentLoadNotice,
    adoptRestoredDocument,
  }), [
    save,
    saveRemote,
    flushPendingSave,
    afterDocumentSaved,
    createRemote,
    createAndSwitch,
    ensureRemoteDocument,
    loadRemote,
    switchTo,
    newLocal,
    markPageTrashed,
    markPageRestored,
    hasPendingEdits,
    resolveSaveConflict,
    restoreKeptDraft,
    discardKeptDraft,
    clearSaveError,
    clearDocumentLoadNotice,
    adoptRestoredDocument,
  ]);

  const docValue: EditorDocValue = useMemo(() => ({ doc, blocks: doc.blocks }), [doc]);

  const session: DocumentSessionValue = useMemo(() => ({
    documentId,
    documentSessionId,
    loadingDocumentId,
    creatingDocument,
    restoreEpoch,
    restoreReason,
    pageCount,
    readOnly,
  }), [
    documentId,
    documentSessionId,
    loadingDocumentId,
    creatingDocument,
    restoreEpoch,
    restoreReason,
    pageCount,
    readOnly,
  ]);

  const saveConflict = conflictId !== null && conflictId === documentId;
  const editsKeptReadOnly = readOnly && editsKeptFor !== null && editsKeptFor === documentId;
  const unsavedDraftAt = keptDraft && keptDraft.documentId === documentId ? keptDraft.savedAt : null;
  const inTrash = useMemo<PageInTrash | null>(
    () => (trashed && trashed.documentId === documentId ? { trashRoot: trashed.trashRoot, purgeAfter: trashed.purgeAfter } : null),
    [documentId, trashed],
  );
  const status: DocumentStatusValue = useMemo(() => ({
    lastSavedAt,
    isAutoSaving,
    lastSaveSource,
    saveError,
    saveConflict,
    unsavedDraftAt,
    inTrash,
    editsKeptReadOnly,
    documentLoadNotice,
  }), [lastSavedAt, isAutoSaving, lastSaveSource, saveError, saveConflict, unsavedDraftAt, inTrash, editsKeptReadOnly, documentLoadNotice]);

  return (
    <DocumentActionsContext.Provider value={actions}>
      <DocumentBodyContext.Provider value={body}>
        <DocumentSessionContext.Provider value={session}>
          <DocumentStatusContext.Provider value={status}>
            <EditorDocContext.Provider value={docValue}>{children}</EditorDocContext.Provider>
          </DocumentStatusContext.Provider>
        </DocumentSessionContext.Provider>
      </DocumentBodyContext.Provider>
    </DocumentActionsContext.Provider>
  );
}
