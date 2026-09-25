import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type FormEvent,
} from 'react';
import { ArrowLeft, FolderPlus, RefreshCw, Search, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Alert } from '@/components/ui/alert';
import { Skeleton, Spinner } from '@/components/ui/spinner';
import { useToast } from '@/components/ui/toastContext';
import { useEditor } from '@/editor';
import { partitionPdfs, skippedNonPdfMessage } from '@/lib/fileDrop';
import { errorMessage } from '@/services/contracts';
import { describeExtraction } from '@/components/common/ExtractionStatus';
import {
  MAX_SEARCH_QUERY_CHARS,
  resourceLocationKey,
  resourceScopeOptions,
  searchResources,
  type CollectionDeletePreview,
  type CollectionItem,
  type ExtractionStatus,
  type ResourceAttachmentTarget,
  type ResourceItem,
  type ResourceLibraryLocation,
  type ResourceSearchResponse,
  type SmartResourceScope,
} from '@/services/resources';
import { useResourceLibrary } from './useResourceLibrary';
import { useCollectionTree } from './useCollectionTree';
import { ResourceDetail } from './ResourceDetail';
import { CollectionTree } from './CollectionTree';
import { CollectionFolderHeader } from './CollectionFolderHeader';
import {
  CollectionDeleteDialog,
  CollectionEditorDialog,
} from './CollectionDialogs';
import {
  CollectionPickerDialog,
  type CollectionPickerTarget,
} from './CollectionPickerDialog';
import {
  CollectionChildren,
  ResourceList,
  SearchResults,
  UploadDropZone,
} from './LibraryResources';
import type { LibraryDragPayload } from './collectionDnd';

const SCOPES: ReadonlyArray<{ id: SmartResourceScope; label: string; hint: string }> = [
  {
    id: 'context',
    label: 'Available',
    hint: 'Everything the assistant can read while editing this document.',
  },
  { id: 'document', label: 'Attached', hint: 'Only files attached to this document.' },
  { id: 'library', label: 'All', hint: 'Every PDF on your account.' },
];

/** Why the document-scoped views are unavailable, in the user's terms. */
const NO_DOCUMENT_REASON = 'Save this document first.';

type LibraryView =
  | { kind: 'smart'; scope: SmartResourceScope }
  | { kind: 'unfiled' }
  | { kind: 'collection'; collectionId: number };

type SearchState = {
  term: string;
  result: ResourceSearchResponse | null;
  loading: boolean;
  loadingMore: boolean;
  error: string | null;
};

type EditorState =
  | { mode: 'create'; parentId: number | null; parentName: string | null }
  | { mode: 'edit'; collection: CollectionItem };

type PickerState =
  | { kind: 'collection'; collection: CollectionItem }
  | { kind: 'resource'; resource: ResourceItem };

/**
 * The four independent things that can go wrong here.
 *
 * They used to share one slot coalesced with `??`, so a stale search error hid
 * a fresh move failure and none of them could be dismissed. Keyed by source so
 * each is shown, retried and dismissed on its own.
 */
type ProblemSource = 'search' | 'action' | 'selection' | 'library';

const NO_SEARCH: SearchState = {
  term: '',
  result: null,
  loading: false,
  loadingMore: false,
  error: null,
};

function loadedCollection(
  branches: ReturnType<typeof useCollectionTree>['branches'],
  collectionId: number,
): CollectionItem | null {
  for (const branch of Object.values(branches)) {
    const found = branch.collections.find((collection) => collection.id === collectionId);
    if (found) return found;
  }
  return null;
}

/** A file to open straight away, optionally scrolled to a search match. */
export type LibraryFocus = { resourceId: number; offset?: number; term?: string };

export function LibraryPanel({
  initialResource = null,
  onExit,
}: {
  initialResource?: LibraryFocus | null;
  /** Leave the file manager (back to Research). Adds the "← My PDFs" header. */
  onExit?: () => void;
}) {
  const { documentId } = useEditor();
  const { toast } = useToast();
  const [view, setView] = useState<LibraryView>({ kind: 'smart', scope: 'context' });
  const [jump, setJump] = useState<{ offset: number; term: string } | null>(null);
  // Opened straight onto a file from a Research match: its back arrow returns
  // to that search, not to a file list the author never saw.
  const [directEntry, setDirectEntry] = useState(Boolean(initialResource && onExit));
  const [search, setSearch] = useState<SearchState>(NO_SEARCH);
  const [actionError, setActionError] = useState<string | null>(null);
  const [dismissed, setDismissed] = useState<Partial<Record<ProblemSource, string>>>({});
  const [editor, setEditor] = useState<EditorState | null>(null);
  const [picker, setPicker] = useState<PickerState | null>(null);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [attachmentBusy, setAttachmentBusy] = useState(false);
  const [settledNotice, setSettledNotice] = useState('');
  const folderActionRef = useRef<HTMLButtonElement>(null);
  const newRootRef = useRef<HTMLButtonElement>(null);
  const resourceMoveRef = useRef<HTMLButtonElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const resourceReturnFocusIdRef = useRef<number | null>(null);
  const searchRequestRef = useRef(0);
  const folderHeadingId = useId();

  const effectiveView = useMemo<LibraryView>(() => {
    if (view.kind === 'smart' && documentId === null && view.scope !== 'library') {
      return { kind: 'smart', scope: 'library' };
    }
    return view;
  }, [documentId, view]);

  const location = useMemo<ResourceLibraryLocation>(() => {
    if (effectiveView.kind === 'collection') {
      return { kind: 'collection', collectionId: effectiveView.collectionId };
    }
    if (effectiveView.kind === 'unfiled') return { kind: 'unfiled' };
    if (effectiveView.scope === 'library' || documentId === null) {
      return { kind: 'smart', scope: 'library' };
    }
    return { kind: 'smart', scope: effectiveView.scope, documentId };
  }, [documentId, effectiveView]);

  const locationKey = resourceLocationKey(location);
  const locationKeyRef = useRef(locationKey);
  locationKeyRef.current = locationKey;
  const library = useResourceLibrary(location);
  const tree = useCollectionTree({ documentId });
  const selectedResource = library.selected;
  const selectedFolder =
    effectiveView.kind === 'collection' && tree.selectedId === effectiveView.collectionId
      ? tree.selectedCollection
      : null;

  useEffect(() => {
    if (selectedResource !== null || resourceReturnFocusIdRef.current === null) return;
    const resourceId = resourceReturnFocusIdRef.current;
    resourceReturnFocusIdRef.current = null;
    queueMicrotask(() => {
      const origin = document.querySelector<HTMLElement>(
        `[data-library-resource-id="${resourceId}"]`,
      );
      // Falls back to the search box through a ref rather than a query on its
      // aria-label: that coupled focus restoration to a copy string, so
      // rewording the label silently broke it.
      (origin ?? searchInputRef.current)?.focus();
    });
  }, [selectedResource]);

  useEffect(() => {
    searchRequestRef.current += 1;
    setSearch(NO_SEARCH);
    setJump(null);
    setActionError(null);
    setDismissed({});
    return () => {
      searchRequestRef.current += 1;
    };
  }, [locationKey]);

  // Opened from a Research match: go straight to that file, at the match.
  // Declared after the location reset above, which clears `jump` on mount;
  // `select` is stable, so this runs again only for a new target.
  const selectResource = library.select;
  useEffect(() => {
    if (!initialResource) return;
    const { resourceId, offset, term } = initialResource;
    if (offset !== undefined && term) setJump({ offset, term });
    void selectResource(resourceId).catch(() => setJump(null));
  }, [initialResource, selectResource]);

  // Announce a conversion finishing, once. Polling silently swapped a row's
  // badge from Converting to Ready, which is invisible to anyone not watching
  // that row.
  const statusRef = useRef(new Map<number, ExtractionStatus | null>());
  useEffect(() => {
    const previous = statusRef.current;
    const next = new Map<number, ExtractionStatus | null>();
    const settled: string[] = [];
    for (const resource of library.resources) {
      next.set(resource.id, resource.extraction_status);
      const before = previous.get(resource.id);
      if (before === undefined || before === resource.extraction_status) continue;
      if (!describeExtraction(before).settling) continue;
      if (describeExtraction(resource.extraction_status).settling) continue;
      settled.push(
        `${resource.title || resource.filename}: ${describeExtraction(resource.extraction_status).label}`,
      );
    }
    statusRef.current = next;
    if (settled.length > 0) setSettledNotice(settled.join('. '));
  }, [library.resources]);

  const openUnfiled = useCallback(() => {
    setView({ kind: 'unfiled' });
    setActionError(null);
    void tree.selectCollection(null);
  }, [tree]);

  const openSmart = (scope: SmartResourceScope) => {
    setView({ kind: 'smart', scope });
    setActionError(null);
    void tree.selectCollection(null);
  };

  const openCollection = useCallback(
    async (collectionId: number) => {
      setView({ kind: 'collection', collectionId });
      setActionError(null);
      try {
        await Promise.all([
          tree.selectCollection(collectionId),
          tree.loadChildren(collectionId),
        ]);
      } catch (caught) {
        setActionError(errorMessage(caught, 'Could not open that folder'));
      }
    },
    [tree],
  );

  const uploadTarget = useMemo<ResourceAttachmentTarget>(() => {
    if (effectiveView.kind === 'collection') {
      return { collectionId: effectiveView.collectionId };
    }
    if (
      effectiveView.kind === 'smart' &&
      effectiveView.scope === 'document' &&
      documentId !== null
    ) {
      return { documentId };
    }
    return { documentId: null };
  }, [documentId, effectiveView]);

  const uploadTargetLabel =
    effectiveView.kind === 'collection'
      ? selectedFolder?.name ?? 'this folder'
      : effectiveView.kind === 'smart' && effectiveView.scope === 'document'
        ? 'the current document'
        : 'Unfiled';

  const addFiles = useCallback(
    async (files: FileList | null) => {
      const { pdfs, skipped } = partitionPdfs(files);
      const skippedMessage = skippedNonPdfMessage(skipped);
      if (skippedMessage) toast({ ...skippedMessage, variant: 'warning' });
      if (pdfs.length === 0) return;

      const { stored, failures } = await library.upload(pdfs, uploadTarget);
      if (stored.length > 0) {
        toast({
          title: `Uploaded ${stored.length} file${stored.length === 1 ? '' : 's'}`,
          description: `Added to ${uploadTargetLabel}. Converting to text now.`,
          variant: 'success',
        });
        await tree.refreshLoaded();
      }
      if (failures.length > 0) {
        toast({
          title: `${failures.length} file${failures.length === 1 ? '' : 's'} rejected`,
          description: failures.join(' · '),
          variant: 'error',
        });
      }
    },
    [library, toast, tree, uploadTarget, uploadTargetLabel],
  );

  const onSearch = async (event: FormEvent) => {
    event.preventDefault();
    const term = search.term.trim();
    const request = ++searchRequestRef.current;
    const requestLocationKey = locationKey;
    if (!term) {
      setSearch(NO_SEARCH);
      return;
    }
    setSearch((previous) => ({ ...previous, loading: true, error: null }));
    const searchLocation: ResourceLibraryLocation =
      location.kind === 'collection' ? { ...location, recursive: true } : location;
    try {
      const result = await searchResources({
        query: term,
        ...resourceScopeOptions(searchLocation),
      });
      if (
        request !== searchRequestRef.current ||
        requestLocationKey !== locationKeyRef.current
      ) {
        return;
      }
      setSearch((previous) => ({ ...previous, result, loading: false, error: null }));
    } catch (caught) {
      if (
        request !== searchRequestRef.current ||
        requestLocationKey !== locationKeyRef.current
      ) {
        return;
      }
      setSearch((previous) => ({
        ...previous,
        result: null,
        loading: false,
        error: errorMessage(caught, 'Search failed'),
      }));
    }
  };

  const loadMoreSearch = async () => {
    const current = search.result;
    if (!current || current.next_offset === null || search.loadingMore) return;
    const request = ++searchRequestRef.current;
    const requestLocationKey = locationKey;
    const searchLocation: ResourceLibraryLocation =
      location.kind === 'collection' ? { ...location, recursive: true } : location;
    setSearch((previous) => ({ ...previous, loadingMore: true, error: null }));
    try {
      const page = await searchResources({
        query: current.query,
        ...resourceScopeOptions(searchLocation),
        offset: current.next_offset,
      });
      if (
        request !== searchRequestRef.current ||
        requestLocationKey !== locationKeyRef.current
      ) {
        return;
      }
      setSearch((previous) => {
        if (!previous.result || previous.result.query !== current.query) return previous;
        const skipped = new Map(
          [...previous.result.resources_skipped, ...page.resources_skipped].map((item) => [
            item.resource_id,
            item,
          ]),
        );
        const result: ResourceSearchResponse = {
          ...page,
          matches: [...previous.result.matches, ...page.matches],
          match_count: previous.result.match_count + page.match_count,
          resources_searched:
            previous.result.resources_searched + page.resources_searched,
          resources_skipped: [...skipped.values()],
          truncated: previous.result.truncated || page.truncated,
        };
        return { ...previous, result, loadingMore: false, error: null };
      });
    } catch (caught) {
      if (
        request !== searchRequestRef.current ||
        requestLocationKey !== locationKeyRef.current
      ) {
        return;
      }
      setSearch((previous) => ({
        ...previous,
        loadingMore: false,
        error: errorMessage(caught, 'Could not search more files'),
      }));
    }
  };

  const refreshCanonical = useCallback(async () => {
    await Promise.allSettled([
      library.refresh(),
      tree.refreshLoaded(),
      tree.selectedId === null ? Promise.resolve(null) : tree.refreshSelected(),
    ]);
  }, [library, tree]);

  const movePayload = useCallback(
    async (payload: LibraryDragPayload, targetCollectionId: number | null) => {
      setActionError(null);
      try {
        if (payload.kind === 'collection') {
          await tree.moveFolder(payload.id, targetCollectionId);
        } else {
          await library.move(
            payload.id,
            targetCollectionId === null ? {} : { collectionId: targetCollectionId },
          );
          searchRequestRef.current += 1;
          setSearch(NO_SEARCH);
          await tree.refreshLoaded();
        }
      } catch (caught) {
        await refreshCanonical();
        const message = errorMessage(caught, 'Could not move that item');
        setActionError(message);
        throw caught instanceof Error ? caught : new Error(message);
      }
    },
    [library, refreshCanonical, tree],
  );

  const handleDrop = useCallback(
    async (payload: LibraryDragPayload, targetCollectionId: number | null) => {
      try {
        await movePayload(payload, targetCollectionId);
      } catch {
        // The inline alert contains the authoritative server message. Keeping
        // the rejection inside this event handler avoids an unhandled promise.
      }
    },
    [movePayload],
  );

  const saveFolder = async (values: { name: string; description: string | null }) => {
    if (!editor) return;
    if (editor.mode === 'edit') {
      await tree.renameFolder(editor.collection.id, values);
      return;
    }
    const created = await tree.createFolder({ ...values, parentId: editor.parentId });
    await openCollection(created.id);
  };

  const deleteFolder = async (
    collectionId: number,
    expected: CollectionDeletePreview,
  ) => {
    const result = await tree.deleteFolder(collectionId, expected);
    openUnfiled();
    await library.refresh();
    if (result.cleanup_pending_count > 0) {
      toast({
        title: 'Folder deleted; storage cleanup is still pending',
        description: `${result.cleanup_pending_count} PDF${result.cleanup_pending_count === 1 ? '' : 's'} still require background cleanup.`,
        variant: 'warning',
      });
    } else {
      toast({ title: 'Folder and its contents were permanently deleted', variant: 'success' });
    }
    // The menu button that opened the dialog was deleted with its folder.
    // Return keyboard focus to the stable new-root action instead.
    queueMicrotask(() => newRootRef.current?.focus());
  };

  const toggleFolderAttachment = async () => {
    if (!selectedFolder || !documentId) return;
    setAttachmentBusy(true);
    setActionError(null);
    const wasAttached = Boolean(tree.attachment?.direct);
    try {
      if (wasAttached) await tree.detachDocument(selectedFolder.id);
      else await tree.attachDocument(selectedFolder.id);
      toast({
        title: wasAttached
          ? `${selectedFolder.name} is no longer attached to this document`
          : `${selectedFolder.name} is attached to this document`,
        variant: 'success',
      });
    } catch (caught) {
      setActionError(errorMessage(caught, 'Could not change the folder attachment'));
    } finally {
      setAttachmentBusy(false);
    }
  };

  const moveFromPicker = async (target: CollectionPickerTarget) => {
    if (!picker) return;
    if (picker.kind === 'collection') {
      const parentId = target.kind === 'collection' ? target.collectionId : null;
      await movePayload({ kind: 'collection', id: picker.collection.id }, parentId);
      return;
    }

    let attachmentTarget: ResourceAttachmentTarget;
    if (target.kind === 'collection') attachmentTarget = { collectionId: target.collectionId };
    else if (target.kind === 'document') attachmentTarget = { documentId: target.documentId };
    else attachmentTarget = {};

    try {
      await library.move(picker.resource.id, attachmentTarget);
      searchRequestRef.current += 1;
      setSearch(NO_SEARCH);
      await tree.refreshLoaded();
      // Keep the detail view mounted until the dialog closes so Radix can
      // restore focus to the Move button. The canonical list is already
      // refreshed, so Back cannot reveal a stale row in the old location.
      setJump(null);
    } catch (caught) {
      await refreshCanonical();
      throw caught;
    }
  };

  const selectedPath = useMemo(
    () => (selectedFolder ? tree.path : []),
    [selectedFolder, tree.path],
  );
  const inheritedFromAncestor = useMemo(
    () =>
      selectedPath
        .slice(0, -1)
        .some((crumb) => Boolean(loadedCollection(tree.branches, crumb.id)?.attachment?.direct)),
    [selectedPath, tree.branches],
  );

  const childFolders =
    effectiveView.kind === 'collection'
      ? tree.childrenOf(effectiveView.collectionId)
      : effectiveView.kind === 'unfiled'
        ? tree.roots
        : [];

  if (selectedResource) {
    return (
      <>
        <ResourceDetail
          resource={selectedResource}
          documentId={documentId}
          highlight={jump?.term}
          jumpToOffset={jump?.offset}
          moveButtonRef={resourceMoveRef}
          backLabel={directEntry && onExit ? 'Back to search' : 'Back to the file list'}
          onBack={() => {
            if (directEntry && onExit) {
              onExit();
              return;
            }
            resourceReturnFocusIdRef.current = selectedResource.id;
            void library.select(null);
            setJump(null);
          }}
          onOpenMove={() => setPicker({ kind: 'resource', resource: selectedResource })}
          onMove={async (id, target) => {
            const moved = await library.move(id, target);
            searchRequestRef.current += 1;
            setSearch(NO_SEARCH);
            return moved;
          }}
          onDeleted={async (id) => {
            setDirectEntry(false);
            resourceReturnFocusIdRef.current = id;
            await library.remove(id);
            searchRequestRef.current += 1;
            setSearch(NO_SEARCH);
            await tree.refreshLoaded();
            setJump(null);
          }}
          onRetry={library.retry}
        />
        {picker?.kind === 'resource' && (
          <CollectionPickerDialog
            open
            mode="resource"
            subjectName={selectedResource.filename}
            controller={tree}
            documentId={documentId}
            initialTarget={
              selectedResource.collection_id
                ? { kind: 'collection', collectionId: selectedResource.collection_id }
                : selectedResource.document_id === documentId && documentId
                  ? { kind: 'document', documentId }
                  : { kind: 'unfiled' }
            }
            onOpenChange={(open) => !open && setPicker(null)}
            onMove={moveFromPicker}
            returnFocusRef={resourceMoveRef}
          />
        )}
      </>
    );
  }

  const folderView = effectiveView.kind === 'collection' || effectiveView.kind === 'unfiled';
  const activeScope = effectiveView.kind === 'smart' ? effectiveView.scope : null;

  const problems: Array<{ source: ProblemSource; message: string; retry?: () => void }> = [];
  if (search.error) problems.push({ source: 'search', message: search.error });
  if (actionError) problems.push({ source: 'action', message: actionError });
  if (tree.selectionError) problems.push({ source: 'selection', message: tree.selectionError });
  if (library.error) {
    problems.push({
      source: 'library',
      message: library.error,
      retry: () => void library.refresh(),
    });
  }
  const visibleProblems = problems.filter(
    (problem) => dismissed[problem.source] !== problem.message,
  );

  const dismiss = (source: ProblemSource, message: string) =>
    setDismissed((previous) => ({ ...previous, [source]: message }));

  // Shown as soon as more pages exist, not only once a page happens to push the
  // count past four — otherwise the control appears mid-scroll and shifts the
  // list under the pointer.
  // One box: typing narrows the list by name at once, Enter searches inside
  // the files. (It used to be a name filter plus a second search field with
  // its own "Find" button.)
  const filter = search.result ? '' : search.term;

  return (
    <div className="flex h-full min-h-0 flex-col gap-2.5">
      {documentId === null && (
        <Alert variant="info" role="status" className="text-xs">
          Save this document to attach files or folders. Until then, Available and Attached are unavailable and uploads go to Unfiled.
        </Alert>
      )}

      {onExit && (
        <div className="-ml-1 flex h-10 shrink-0 items-center gap-1">
          <Button variant="icon" size="icon-sm" onClick={onExit} aria-label="Back to search">
            <ArrowLeft aria-hidden="true" />
          </Button>
          <h2 className="text-sm font-semibold">My PDFs</h2>
        </div>
      )}

      <div className="flex items-center gap-0.5" role="group" aria-label="Which files to show">
        {SCOPES.map((option) => {
          const disabled = documentId === null && option.id !== 'library';
          const hint = disabled ? `${option.hint} ${NO_DOCUMENT_REASON}` : option.hint;
          const active = activeScope === option.id;
          return (
            <span key={option.id} className="shrink-0">
              <button
                type="button"
                // Same quiet pills as the Research source switch.
                className={cn(
                  'inline-flex h-7 items-center whitespace-nowrap rounded-md px-2 text-sm transition-colors duration-120 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50',
                  active ? 'bg-active font-medium text-foreground' : 'text-muted-foreground hover:bg-hover hover:text-foreground',
                )}
                aria-pressed={active}
                // The hint is a description, not part of the name: these are
                // one-word toggles and "All — Every PDF on your account" is a
                // worse name than "All". It used to live only in `title`, which
                // is not announced at all — least of all on a disabled button,
                // where the reason it is disabled is the whole point.
                aria-describedby={`${folderHeadingId}-${option.id}-hint`}
                disabled={disabled}
                onClick={() => openSmart(option.id)}
              >
                {option.label}
              </button>
              <span id={`${folderHeadingId}-${option.id}-hint`} className="sr-only">
                {hint}
              </span>
            </span>
          );
        })}
        <Button
          variant="icon"
          size="icon-sm"
          className="ml-auto shrink-0"
          disabled={library.refreshing}
          onClick={() => void refreshCanonical()}
          aria-label="Refresh library and folders"
        >
          <RefreshCw aria-hidden="true" className={cn(library.refreshing && 'animate-spin')} />
        </Button>
      </div>

      <section aria-labelledby={folderHeadingId}>
        <div className="mb-0.5 flex items-center justify-between gap-2 pl-1">
          <h3 id={folderHeadingId} className="text-xs font-medium text-muted-foreground">
            Folders
          </h3>
          <Button
            ref={newRootRef}
            variant="ghost"
            size="xs"
            onClick={() => setEditor({ mode: 'create', parentId: null, parentName: null })}
          >
            <FolderPlus aria-hidden="true" /> New
          </Button>
        </div>
        <CollectionTree
          controller={tree}
          selected={
            effectiveView.kind === 'unfiled'
              ? 'unfiled'
              : effectiveView.kind === 'collection'
                ? effectiveView.collectionId
                : null
          }
          className="max-h-44 overflow-y-auto"
          onSelectUnfiled={openUnfiled}
          onSelectCollection={(collectionId) => void openCollection(collectionId)}
          onDrop={handleDrop}
        />
      </section>

      {folderView && (
        <CollectionFolderHeader
          view={effectiveView.kind === 'unfiled' ? 'unfiled' : 'collection'}
          collection={selectedFolder}
          loading={tree.selecting}
          path={selectedPath}
          attachment={tree.attachment}
          inheritedFromAncestor={inheritedFromAncestor}
          attachmentBusy={attachmentBusy}
          attachmentDisabledReason={documentId === null ? NO_DOCUMENT_REASON : null}
          actionButtonRef={folderActionRef}
          onSelectRoot={openUnfiled}
          onSelectCollection={(collectionId) => void openCollection(collectionId)}
          onCreateChild={() => {
            if (selectedFolder) {
              setEditor({
                mode: 'create',
                parentId: selectedFolder.id,
                parentName: selectedFolder.name,
              });
            }
          }}
          onEdit={() => selectedFolder && setEditor({ mode: 'edit', collection: selectedFolder })}
          onMove={() => selectedFolder && setPicker({ kind: 'collection', collection: selectedFolder })}
          onDelete={() => setDeleteOpen(true)}
          onToggleAttachment={() => void toggleFolderAttachment()}
        />
      )}

      <form onSubmit={onSearch} className="relative">
        {search.loading ? (
          <Spinner className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2" />
        ) : (
          <Search
            aria-hidden="true"
            className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
          />
        )}
        <Input
          ref={searchInputRef}
          type="search"
          enterKeyHint="search"
          className="h-9 pl-8 pr-8 text-sm [&::-webkit-search-cancel-button]:appearance-none"
          placeholder={folderView ? 'Filter, or press Enter to search this folder…' : 'Filter, or press Enter to search inside…'}
          // Tracks the scope, so the announced name and the visible
          // placeholder cannot describe two different searches.
          aria-label={
            folderView ? 'Search this folder and its subfolders' : 'Search inside your PDFs'
          }
          aria-busy={search.loading}
          value={search.term}
          maxLength={MAX_SEARCH_QUERY_CHARS}
          onChange={(event) => {
            searchRequestRef.current += 1;
            setSearch({
              term: event.target.value,
              result: null,
              loading: false,
              loadingMore: false,
              error: null,
            });
          }}
        />
        {search.term && (
          <button
            type="button"
            aria-label="Clear the search"
            onClick={() => {
              searchRequestRef.current += 1;
              setSearch(NO_SEARCH);
              searchInputRef.current?.focus();
            }}
            className="absolute right-2 top-1/2 grid h-5 w-5 -translate-y-1/2 place-items-center rounded-sm text-muted-foreground transition-colors hover:bg-hover hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <X aria-hidden="true" className="h-3.5 w-3.5" />
          </button>
        )}
      </form>

      {visibleProblems.map((problem) => (
        <Alert key={problem.source} variant="destructive">
          <div className="flex min-w-0 items-start gap-2">
            <span className="min-w-0 flex-1 break-words">{problem.message}</span>
            <div className="flex shrink-0 items-center gap-1">
              {problem.retry && (
                <Button variant="outline" size="xs" onClick={problem.retry}>
                  <RefreshCw aria-hidden="true" />
                  Retry
                </Button>
              )}
              <Button
                variant="ghost"
                size="icon-xs"
                onClick={() => dismiss(problem.source, problem.message)}
                aria-label="Dismiss this error"
              >
                <X aria-hidden="true" />
              </Button>
            </div>
          </div>
        </Alert>
      ))}

      {search.result ? (
        <SearchResults
          result={search.result}
          loadingMore={search.loadingMore}
          onLoadMore={() => void loadMoreSearch()}
          onOpen={(resourceId, offset, term) => {
            resourceReturnFocusIdRef.current = resourceId;
            setJump({ offset, term });
            void library.select(resourceId).catch(() => setJump(null));
          }}
          onOpenResource={(resourceId) => {
            resourceReturnFocusIdRef.current = resourceId;
            setJump(null);
            void library.select(resourceId).catch(() => undefined);
          }}
        />
      ) : (
        <>
          {folderView && (
            <CollectionChildren
              collections={childFolders}
              parentEffective={Boolean(tree.attachment?.effective)}
              onOpen={(collectionId) => void openCollection(collectionId)}
              onDrop={handleDrop}
            />
          )}

          <UploadDropZone
            compact={library.resources.length > 0 || childFolders.length > 0}
            uploading={library.uploading}
            targetLabel={uploadTargetLabel}
            onFiles={(files) => void addFiles(files)}
          />

          {/* A floor rather than pure `flex-1`: with eight fixed blocks stacked
              above it, a short window squeezed this to nothing instead of
              letting the panel scroll as a whole. */}
          <div
            className="min-h-32 flex-1 overflow-y-auto"
            aria-busy={library.loading}
          >
            {library.loading && library.resources.length === 0 ? (
              <div className="space-y-1.5">
                <Skeleton className="h-14 w-full" />
                <Skeleton className="h-14 w-full" />
                <Skeleton className="h-14 w-full" />
              </div>
            ) : library.error && library.resources.length === 0 ? null : (
              // Rows survive a failed refresh: blanking the list threw away
              // rows that were still perfectly valid. But a failure with
              // nothing loaded renders nothing at all rather than the empty
              // state — "your library is empty" is a claim about the server,
              // and a request that failed did not establish it.
              <ResourceList
                resources={library.resources}
                filter={filter}
                filterHint="Press Enter to search inside the files instead."
                emptyTitle={
                  effectiveView.kind === 'collection'
                    ? 'No PDFs directly in this folder'
                    : effectiveView.kind === 'unfiled'
                      ? 'Unfiled is empty'
                      : effectiveView.scope === 'document'
                        ? 'Nothing attached to this document'
                        : 'Your library is empty'
                }
                emptyDescription={
                  effectiveView.kind === 'collection'
                    ? 'Upload here or move a PDF into this folder.'
                    : effectiveView.kind === 'unfiled'
                      ? 'PDFs not assigned to a folder or document appear here.'
                      : effectiveView.scope === 'document'
                        ? 'Upload a PDF here to attach it to the current document.'
                        : 'Add the papers you are writing against. The assistant reads them once conversion finishes.'
                }
                onOpen={(resource) => {
                  resourceReturnFocusIdRef.current = resource.id;
                  setJump(null);
                  void library.select(resource);
                }}
              />
            )}
            {library.hasMore && (
              <Button
                variant="ghost"
                size="sm"
                className="mt-2 w-full"
                disabled={library.loadingMore}
                onClick={() => void library.loadMore()}
              >
                {library.loadingMore && <Spinner />}
                {library.loadingMore ? 'Loading…' : 'Show more PDFs'}
              </Button>
            )}
          </div>
        </>
      )}

      {/* One polite region for the whole list. */}
      <p className="sr-only" role="status">
        {settledNotice}
      </p>

      {editor && (
        <CollectionEditorDialog
          key={editor.mode === 'edit' ? `edit-${editor.collection.id}` : `create-${editor.parentId ?? 'root'}`}
          open
          mode={editor.mode}
          collection={editor.mode === 'edit' ? editor.collection : null}
          parentName={editor.mode === 'create' ? editor.parentName : null}
          onOpenChange={(open) => !open && setEditor(null)}
          onSave={saveFolder}
          returnFocusRef={editor.mode === 'create' && editor.parentId === null ? newRootRef : folderActionRef}
        />
      )}
      {picker?.kind === 'collection' && (
        <CollectionPickerDialog
          open
          mode="collection"
          subjectName={picker.collection.name}
          subjectCollectionId={picker.collection.id}
          controller={tree}
          initialTarget={
            picker.collection.parent_id
              ? { kind: 'collection', collectionId: picker.collection.parent_id }
              : { kind: 'root' }
          }
          onOpenChange={(open) => !open && setPicker(null)}
          onMove={moveFromPicker}
          returnFocusRef={folderActionRef}
        />
      )}
      {deleteOpen && selectedFolder && (
        <CollectionDeleteDialog
          open
          collection={selectedFolder}
          onOpenChange={setDeleteOpen}
          onPreview={tree.previewDelete}
          onDelete={deleteFolder}
          returnFocusRef={folderActionRef}
        />
      )}
    </div>
  );
}
