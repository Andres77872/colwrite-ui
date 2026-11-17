import {
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from 'react';
import { FileText, FolderPlus, Inbox, Library as LibraryIcon, RefreshCw, Search, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { InlineError } from '@/components/ui/inline-error';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton, Spinner } from '@/components/ui/spinner';
import { useToast } from '@/components/ui/toastContext';
import { useDocumentActions, useDocumentId, useDocumentSession } from '@/editor';
import { displayTitle, isUntitledName } from '@/components/layout/displayTitle';
import { useMoveTo } from '@/actions/useMoveTo';
import { MoveToDialog, type MoveDestination } from '@/components/collections/MoveToDialog';
import { useFileDropZone } from '@/hooks/useFileDropZone';
import { errorMessage } from '@/api/errors';
import { useQueryClient } from '@tanstack/react-query';
import {
  MAX_SEARCH_QUERY_CHARS,
  refreshCollectionDetails,
  resourceCollectionId,
  type CollectionRef,
  type ResourceAttachmentTarget,
  type ResourceItem,
  type ResourceLibraryLocation,
} from '@/data/resources';
import { useWorkspaceId } from '@/components/workspace/workspaceContextState';
import { useWorkspaceAccess } from '@/components/workspace/workspaceAccess';
import {
  sameUploadTarget,
  uploadPlace,
  useUploadPdfs,
  type PdfUploadTarget,
} from '@/actions/useUploadPdfs';
import { PanelsContext } from '../panelsContextState';
import { useResourceLibrary } from './useResourceLibrary';
import { useLibrarySearch } from './useLibrarySearch';
import { useCollectionBrowse } from './useCollectionBrowse';
import { useGrantSources } from './useGrantSources';
import { useSettledNotice } from './useSettledNotice';
import { ResourceDetail } from './ResourceDetail';
import { CollectionBreadcrumbs } from './CollectionBreadcrumbs';
import { CollectionFolderHeader } from './CollectionFolderHeader';
import { CollectionEditorDialog } from './CollectionDialogs';
import { CollectionTrashDialog } from '@/components/collections/CollectionTrashDialog';
import { useTrash } from '@/actions/useTrash';
import { CollectionChildren, ResourceList, SearchResults } from './LibraryResources';
import { UploadControl } from './UploadControl';
import { UsedByThisPage } from './UsedByThisPage';
import { isExternalFileDrag, type LibraryDragPayload } from './collectionDnd';

type LibraryView = 'used' | 'browse';

/** Where Browse is. The Library is the root; Unfiled and All PDFs are views. */
type BrowsePlace =
  | { kind: 'root' }
  | { kind: 'unfiled' }
  | { kind: 'all' }
  | { kind: 'collection'; collectionId: number };

type SearchMode = 'names' | 'inside';

type EditorState =
  | { mode: 'create'; parentId: number | null; parentName: string | null }
  | { mode: 'edit'; collection: CollectionRef };

type PickerState =
  | { kind: 'resource'; resource: ResourceItem }
  | { kind: 'collection'; collection: CollectionRef }
  | { kind: 'grant' };

/** The loads that can fail, each said in place with its own retry. */
type ProblemSource = 'search' | 'collections' | 'collection' | 'library';

const VIEWS: ReadonlyArray<{ id: LibraryView; label: string }> = [
  { id: 'used', label: 'Used by this page' },
  { id: 'browse', label: 'Browse' },
];

const MODES: ReadonlyArray<{ id: SearchMode; label: string }> = [
  { id: 'names', label: 'Names' },
  { id: 'inside', label: 'Inside PDFs' },
];

const SEGMENT =
  'inline-flex h-7 shrink-0 items-center whitespace-nowrap rounded-md px-2 text-sm transition-colors duration-120 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';
const SEGMENT_ON = 'bg-active font-medium text-foreground';
const SEGMENT_OFF = 'text-muted-foreground hover:bg-hover hover:text-foreground';

const ROW =
  'flex w-full min-w-0 items-center gap-2 rounded-md p-2 text-left transition-colors duration-150 hover:bg-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';

const placeKey = (view: LibraryView, place: BrowsePlace) =>
  view === 'used' ? 'used' : place.kind === 'collection' ? `collection:${place.collectionId}` : place.kind;

function SegmentedSwitch<T extends string>({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: ReadonlyArray<{ id: T; label: string }>;
  value: T;
  onChange: (value: T) => void;
}) {
  return (
    <div role="radiogroup" aria-label={label} className="flex shrink-0 items-center gap-0.5">
      {options.map((option) => (
        <button
          key={option.id}
          type="button"
          role="radio"
          aria-checked={value === option.id}
          className={cn(SEGMENT, value === option.id ? SEGMENT_ON : SEGMENT_OFF)}
          onClick={() => onChange(option.id)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

function ListSkeletonRows() {
  return (
    <div className="space-y-1.5" aria-hidden="true">
      <Skeleton className="h-14 w-full" />
      <Skeleton className="h-14 w-full" />
      <Skeleton className="h-14 w-full" />
    </div>
  );
}

/**
 * The Library: the workspace's PDFs, as a right-sidebar tab of its own.
 *
 * Two views, named for what they show. "Used by this page" is what this page's
 * assistant can read, grouped by why. "Browse" walks the collections with a
 * breadcrumb and a list; the tree lives in the sidebar. One search box serves
 * both, with a visible switch between matching names and searching inside the
 * PDFs, and uploads always say where they go before they go.
 *
 * A page that was never saved works like any other: an action that needs the
 * page saves it first.
 */
export function LibraryPanel() {
  const documentId = useDocumentId();
  const workspaceId = useWorkspaceId();
  // A viewer (D6) browses, searches and reads every PDF; nothing here
  // uploads, moves, renames, converts, trashes or grants for them.
  const { canEdit } = useWorkspaceAccess();
  const { ensureRemoteDocument, switchTo } = useDocumentActions();
  const { loadingDocumentId } = useDocumentSession();
  const moveTo = useMoveTo();
  const { trashPdf } = useTrash();
  const intent = useContext(PanelsContext)?.intent ?? null;
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [view, setView] = useState<LibraryView>('used');
  const [place, setPlace] = useState<BrowsePlace>({ kind: 'root' });
  const [mode, setMode] = useState<SearchMode>('names');
  const [term, setTerm] = useState('');
  const [jump, setJump] = useState<{ offset: number; term: string } | null>(null);
  const [editor, setEditor] = useState<EditorState | null>(null);
  const [picker, setPicker] = useState<PickerState | null>(null);
  const [trashingCollection, setTrashingCollection] = useState<CollectionRef | null>(null);
  const [grantBusy, setGrantBusy] = useState<number | null>(null);
  const [uploadChoice, setUploadChoice] = useState<{ place: string; target: PdfUploadTarget } | null>(null);

  const searchInputRef = useRef<HTMLInputElement>(null);
  const actionButtonRef = useRef<HTMLButtonElement>(null);
  const newCollectionRef = useRef<HTMLButtonElement>(null);
  const addGrantRef = useRef<HTMLButtonElement>(null);
  const resourceMoveRef = useRef<HTMLButtonElement>(null);
  const resourceReturnFocusIdRef = useRef<number | null>(null);

  const browsingCollection = view === 'browse' && place.kind === 'collection' ? place.collectionId : null;
  const nameFilter = mode === 'names' ? term : '';
  const filtering = nameFilter.trim() !== '';

  // What the list shows. Browse's top level lists collections, and PDFs only
  // when their names are being matched.
  const listLocation = useMemo<ResourceLibraryLocation | null>(() => {
    if (view === 'used') {
      return documentId ? { kind: 'smart', scope: 'context', documentId } : { kind: 'unfiled' };
    }
    switch (place.kind) {
      case 'root':
        return filtering ? { kind: 'smart', scope: 'library' } : null;
      case 'all':
        return { kind: 'smart', scope: 'library' };
      case 'unfiled':
        return { kind: 'unfiled' };
      case 'collection':
        return { kind: 'collection', collectionId: place.collectionId };
    }
  }, [documentId, filtering, place, view]);

  // What "Inside PDFs" searches: the same PDFs, and inside a collection,
  // everything in the collections within it too.
  const searchLocation = useMemo<ResourceLibraryLocation>(() => {
    if (view === 'used') {
      return documentId ? { kind: 'smart', scope: 'context', documentId } : { kind: 'unfiled' };
    }
    if (place.kind === 'unfiled') return { kind: 'unfiled' };
    if (place.kind === 'collection') return { kind: 'collection', collectionId: place.collectionId };
    return { kind: 'smart', scope: 'library' };
  }, [documentId, place, view]);

  const library = useResourceLibrary(listLocation);
  const search = useLibrarySearch(searchLocation);
  const browse = useCollectionBrowse(browsingCollection, documentId, { enabled: view === 'browse' });
  const grantCollectionIds = useMemo(
    () =>
      view === 'used'
        ? library.resources.flatMap((resource) => {
            const collectionId = resourceCollectionId(resource);
            return collectionId !== null ? [collectionId] : [];
          })
        : [],
    [library.resources, view],
  );
  const grants = useGrantSources(documentId, grantCollectionIds);
  const openCollectionDetail = browse.detail;
  const selectedResource = library.selected;

  /** Leaving a place drops what belonged to it: a jump target, an error. */
  const resetTransient = () => {
    setJump(null);
  };

  // Research's "Search inside my PDFs" hands its query here: search every
  // PDF. A tree row's PDF count hands a collection: Browse opens there. The
  // view moves while rendering, so the search below already runs against
  // the place it was meant for.
  const libraryIntent = intent?.tab === 'library' ? intent : null;
  const [seenIntent, setSeenIntent] = useState<number | null>(null);
  if (libraryIntent && libraryIntent.id !== seenIntent) {
    setSeenIntent(libraryIntent.id);
    setView('browse');
    if ('collectionId' in libraryIntent) {
      setPlace({ kind: 'collection', collectionId: libraryIntent.collectionId });
      setMode('names');
      setTerm('');
    } else {
      setPlace({ kind: 'root' });
      setMode('inside');
      setTerm(libraryIntent.query);
    }
    resetTransient();
  }
  const searchIntent = libraryIntent && 'query' in libraryIntent ? libraryIntent : null;
  const intentId = searchIntent?.id ?? null;
  const intentQuery = searchIntent?.query ?? '';
  const runSearch = search.search;
  const selectResource = library.select;
  useEffect(() => {
    if (intentId === null) return;
    void selectResource(null);
    void runSearch(intentQuery);
    // Once per intent, with the search of the render that took it in.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [intentId]);

  useEffect(() => {
    if (selectedResource !== null || resourceReturnFocusIdRef.current === null) return;
    const resourceId = resourceReturnFocusIdRef.current;
    resourceReturnFocusIdRef.current = null;
    queueMicrotask(() => {
      const origin = document.querySelector<HTMLElement>(`[data-library-resource-id="${resourceId}"]`);
      (origin ?? searchInputRef.current)?.focus();
    });
  }, [selectedResource]);

  const settledNotice = useSettledNotice(library.resources);

  /* ---------------------------------------------------------------- upload */

  const currentPlace = placeKey(view, place);
  const collectionName = openCollectionDetail?.name ?? 'this collection';
  const collectionTarget = useMemo<PdfUploadTarget | null>(
    () =>
      browsingCollection === null
        ? null
        : { kind: 'collection', collectionId: browsingCollection, name: collectionName },
    [browsingCollection, collectionName],
  );
  const defaultTarget = useMemo<PdfUploadTarget>(
    () => (view === 'used' ? { kind: 'page' } : (collectionTarget ?? { kind: 'unfiled' })),
    [collectionTarget, view],
  );
  const uploadTarget = uploadChoice?.place === currentPlace ? uploadChoice.target : defaultTarget;
  const uploadChoices: PdfUploadTarget[] = [
    { kind: 'page' },
    { kind: 'unfiled' },
    ...(collectionTarget ? [collectionTarget] : []),
  ];
  const uploads = useUploadPdfs(uploadTarget, { ensurePage: ensureRemoteDocument });

  const addFiles = useCallback(
    async (files: FileList | File[] | null) => {
      const target = uploadTarget;
      const { stored } = await uploads.upload(files);
      if (stored.length === 0) return;
      // Shown at once where they belong to the list on screen; a page saved by
      // this upload loads its own list, which already has them. The upload
      // itself marked every other list stale.
      if (sameUploadTarget(target, defaultTarget)) library.addUploaded(stored);
    },
    [defaultTarget, library, uploadTarget, uploads],
  );

  const { dragOver, dropHandlers } = useFileDropZone({
    onFiles: (files) => void addFiles(files),
    accepts: isExternalFileDrag,
  });

  /* ------------------------------------------------------------ navigation */

  const openView = (next: LibraryView) => {
    setView(next);
    resetTransient();
    void library.select(null);
  };

  const openPlace = (next: BrowsePlace) => {
    setView('browse');
    setPlace(next);
    resetTransient();
    void library.select(null);
  };

  const openCollection = (collectionId: number) => openPlace({ kind: 'collection', collectionId });

  /* ---------------------------------------------------------------- search */

  const changeMode = (next: SearchMode) => {
    setMode(next);
    if (next === 'inside' && term.trim()) void search.search(term);
    if (next === 'names') search.clear();
  };

  const onSearch = (event: FormEvent) => {
    event.preventDefault();
    if (mode === 'inside') void search.search(term);
  };

  const clearSearch = () => {
    setTerm('');
    search.clear();
    searchInputRef.current?.focus();
  };

  /* --------------------------------------------------------------- actions */

  /** The open page's id, saving it first. Reports a page that could not be saved. */
  const pageId = useCallback(async (): Promise<string> => {
    const id = await ensureRemoteDocument();
    if (!id) throw new Error('This page could not be saved. Try again.');
    return id;
  }, [ensureRemoteDocument]);

  // A move reads every list it touched again before it resolves; a search
  // answered where the PDF was.
  const clearResults = search.clear;
  const moveResource = useCallback(
    async (resourceId: number, target: ResourceAttachmentTarget = {}) => {
      const moved = await library.move(resourceId, target);
      clearResults();
      return moved;
    },
    [clearResults, library],
  );

  const handleDrop = useCallback(
    async (payload: LibraryDragPayload, targetCollectionId: number) => {
      const target = browse.collections.find((item) => item.id === targetCollectionId);
      if (payload.kind === 'collection') {
        const dragged = browse.collections.find((item) => item.id === payload.id);
        if (!dragged || dragged.id === targetCollectionId) return;
        await moveTo.moveCollection(
          { id: dragged.id, name: dragged.name, parentId: dragged.parent_id, etag: payload.etag ?? dragged.etag },
          { id: targetCollectionId, name: target?.name ?? null },
        );
        return;
      }
      if (payload.kind !== 'resource') return;
      try {
        await moveResource(payload.id, { collectionId: targetCollectionId });
      } catch (caught) {
        toast({ title: 'Could not move that item', description: errorMessage(caught, 'Request failed'), variant: 'error' });
      }
    },
    [browse.collections, moveResource, moveTo, toast],
  );

  const setUsed = async (collection: { id: number; name: string }, used: boolean) => {
    setGrantBusy(collection.id);
    try {
      await browse.setUsed(collection.id, used, await pageId());
      toast({
        title: used ? `This page now uses ${collection.name}` : `This page no longer uses ${collection.name}`,
        variant: 'success',
      });
    } catch (caught) {
      toast({
        title: 'Could not change whether this page uses the collection',
        description: errorMessage(caught, 'Request failed'),
        variant: 'error',
      });
    } finally {
      setGrantBusy(null);
    }
  };

  const grantFromPicker = async (target: MoveDestination) => {
    if (target.kind !== 'collection') return;
    const state = await browse.setUsed(target.collectionId, true, await pageId());
    const name = state?.via_collection_name ?? 'the collection';
    toast({ title: `This page now uses ${name}`, variant: 'success' });
  };

  const moveFromPicker = async (target: MoveDestination) => {
    if (!picker || picker.kind === 'grant') return;
    if (picker.kind === 'collection') {
      const { collection } = picker;
      await moveTo.moveCollection(
        { id: collection.id, name: collection.name, parentId: collection.parent_id, etag: collection.etag },
        target.kind === 'collection' ? { id: target.collectionId, name: target.name } : { id: null, name: null },
      );
      return;
    }
    const destination: ResourceAttachmentTarget =
      target.kind === 'collection'
        ? { collectionId: target.collectionId }
        : target.kind === 'page'
          ? { documentId: await pageId() }
          : {};
    await moveResource(picker.resource.id, destination);
    setJump(null);
  };

  const saveCollection = async (values: { name: string; description: string | null }) => {
    if (!editor) return;
    if (editor.mode === 'edit') {
      await browse.rename(editor.collection, values);
      return;
    }
    const created = await browse.create({ ...values, parentId: editor.parentId });
    openCollection(created.id);
  };

  /** Browse goes up to where the collection was, once it is in the Trash. */
  const leaveTrashedCollection = () => {
    const parent = trashingCollection?.parent_id ?? null;
    openPlace(parent === null ? { kind: 'root' } : { kind: 'collection', collectionId: parent });
  };

  const refreshAll = () => {
    void Promise.allSettled([library.refresh(), browse.refresh(), refreshCollectionDetails(queryClient, workspaceId)]);
  };

  const openResource = (resource: ResourceItem | number, match?: { offset: number; term: string }) => {
    resourceReturnFocusIdRef.current = typeof resource === 'number' ? resource : resource.id;
    setJump(match ?? null);
    void library.select(resource).catch(() => setJump(null));
  };

  const moveMatchHere = async (resourceId: number) => {
    try {
      const moved = await moveResource(resourceId, { documentId: await pageId() });
      toast({ title: `Moved ${moved.title || moved.filename} to this page`, variant: 'success' });
    } catch (caught) {
      toast({ title: 'Could not move the PDF', description: errorMessage(caught, 'Request failed'), variant: 'error' });
    }
  };

  /* ---------------------------------------------------------------- render */

  const pickerDialog = picker && (
    <MoveToDialog
      open
      subject={
        picker.kind === 'resource'
          ? { kind: 'pdf', name: picker.resource.filename, location: picker.resource.location, pageId: documentId }
          : picker.kind === 'collection'
            ? { kind: 'collection', name: picker.collection.name, collectionId: picker.collection.id, parentId: picker.collection.parent_id }
            : { kind: 'grant' }
      }
      onOpenChange={(open) => !open && setPicker(null)}
      onChoose={picker.kind === 'grant' ? grantFromPicker : moveFromPicker}
      returnFocusRef={
        picker.kind === 'resource' ? resourceMoveRef : picker.kind === 'grant' ? addGrantRef : actionButtonRef
      }
    />
  );

  const openPage = (id: string) => {
    if (loadingDocumentId) return;
    switchTo(id, { source: 'selection' }).catch(() => undefined);
  };

  if (selectedResource) {
    return (
      <div className="h-full min-h-0 px-3 pb-3">
        <ResourceDetail
          resource={selectedResource}
          documentId={documentId}
          ensurePage={ensureRemoteDocument}
          highlight={jump?.term}
          jumpToOffset={jump?.offset}
          moveButtonRef={resourceMoveRef}
          onBack={() => {
            resourceReturnFocusIdRef.current = selectedResource.id;
            void library.select(null);
            setJump(null);
          }}
          readOnly={!canEdit}
          onOpenMove={() => setPicker({ kind: 'resource', resource: selectedResource })}
          onMove={moveResource}
          onRename={library.rename}
          onTrash={async (resource) => {
            const trashed = await trashPdf(resource);
            if (trashed) {
              resourceReturnFocusIdRef.current = resource.id;
              void library.select(null);
              search.clear();
              setJump(null);
            }
            return trashed;
          }}
          onRetry={library.retry}
        />
        {pickerDialog}
      </div>
    );
  }

  const problems: Array<{ source: ProblemSource; message: string; retry?: () => void }> = [];
  if (search.error) problems.push({ source: 'search', message: search.error });
  if (view === 'browse' && browse.error) {
    problems.push({ source: 'collections', message: browse.error, retry: () => void browse.refresh() });
  }
  if (view === 'browse' && browse.detailError) {
    problems.push({ source: 'collection', message: browse.detailError, retry: () => void browse.refresh() });
  }
  if (library.error) problems.push({ source: 'library', message: library.error, retry: () => void library.refresh() });

  const placeholder = mode === 'names' ? 'Filter by name…' : 'Search inside PDFs, then press Enter…';
  const searchLabel = mode === 'names' ? 'Filter PDFs and collections by name' : 'Search inside the PDFs';

  /** The PDFs at the current place, or why there are none. */
  const pdfList = (emptyTitle: string, emptyDescription: string): ReactNode =>
    library.loading && library.resources.length === 0 ? (
      <ListSkeletonRows />
    ) : library.error && library.resources.length === 0 ? null : (
      // A failure with nothing loaded renders nothing rather than the empty
      // state: "empty" is a claim about the server that a failed request did
      // not establish. Rows already on screen survive a failed refresh.
      <ResourceList
        resources={library.resources}
        filter={nameFilter}
        filterHint="Switch to Inside PDFs to search their text."
        emptyTitle={emptyTitle}
        emptyDescription={emptyDescription}
        onOpen={(resource) => openResource(resource)}
      />
    );

  const loadMorePdfs = library.hasMore && (
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
  );

  const moreCollections = browse.hasMore && (
    <Button
      variant="ghost"
      size="sm"
      className="w-full"
      disabled={browse.loadingMore}
      onClick={() => void browse.loadMore()}
    >
      {browse.loadingMore && <Spinner />}
      {browse.loadingMore ? 'Loading…' : 'Show more collections'}
    </Button>
  );

  const collectionRows = browse.collections.filter(
    (collection) => !filtering || collection.name.toLowerCase().includes(nameFilter.trim().toLowerCase()),
  );

  let content: ReactNode;
  if (search.result) {
    content = (
      <SearchResults
        result={search.result}
        loadingMore={search.loadingMore}
        onLoadMore={() => void search.loadMore()}
        onOpen={(resourceId, offset, query) => openResource(resourceId, { offset, term: query })}
        onOpenResource={(resourceId) => openResource(resourceId)}
        onAttach={canEdit ? (resourceId) => void moveMatchHere(resourceId) : undefined}
      />
    );
  } else if (search.loading) {
    content = <ListSkeletonRows />;
  } else if (view === 'used') {
    content =
      library.loading && library.resources.length === 0 ? (
        <ListSkeletonRows />
      ) : library.error && library.resources.length === 0 ? null : (
        <>
          <UsedByThisPage
            resources={library.resources}
            documentId={documentId}
            filter={nameFilter}
            sourceOf={grants.sourceOf}
            stoppingGrantId={grantBusy}
            onOpen={(resource) => openResource(resource)}
            onStopUsing={(grant) => void setUsed(grant, false)}
            onAddGrant={() => setPicker({ kind: 'grant' })}
            addGrantRef={addGrantRef}
            readOnly={!canEdit}
          />
          {loadMorePdfs}
        </>
      );
  } else {
    const breadcrumbs = (
      <CollectionBreadcrumbs
        path={place.kind === 'collection' ? (browse.detail?.path ?? []) : []}
        view={place.kind === 'unfiled' ? 'Unfiled' : place.kind === 'all' ? 'All PDFs' : undefined}
        onSelectRoot={() => openPlace({ kind: 'root' })}
        onSelectCollection={openCollection}
      />
    );
    const newCollection = (parentId: number | null, parentName: string | null) => (
      <Button
        ref={parentId === null ? newCollectionRef : undefined}
        variant="ghost"
        size="xs"
        onClick={() => setEditor({ mode: 'create', parentId, parentName })}
      >
        <FolderPlus aria-hidden="true" /> {parentId === null ? 'New collection' : 'New sub-collection'}
      </Button>
    );

    if (place.kind === 'root') {
      content = (
        <div className="space-y-3">
          {breadcrumbs}
          {browse.loading ? (
            <ListSkeletonRows />
          ) : (
            <CollectionChildren
              collections={collectionRows}
              heading="Collections"
              action={canEdit ? newCollection(null, null) : undefined}
              emptyText={filtering ? 'No collection name matches.' : 'No collections yet. Create one to group the PDFs you are writing against.'}
              parentEffective={false}
              onOpen={openCollection}
              onDrop={handleDrop}
            />
          )}
          {moreCollections}
          {!filtering && (
            <ul className="space-y-1" aria-label="Other views">
              <li>
                <button type="button" className={ROW} onClick={() => openPlace({ kind: 'unfiled' })}>
                  <Inbox aria-hidden="true" className="h-4 w-4 shrink-0 text-muted-foreground" />
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-medium">Unfiled</span>
                    <span className="block text-2xs text-muted-foreground">PDFs not in a collection or on a page</span>
                  </span>
                </button>
              </li>
              <li>
                <button type="button" className={ROW} onClick={() => openPlace({ kind: 'all' })}>
                  <LibraryIcon aria-hidden="true" className="h-4 w-4 shrink-0 text-muted-foreground" />
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-medium">All PDFs</span>
                    <span className="block text-2xs text-muted-foreground">Every PDF, wherever it is</span>
                  </span>
                </button>
              </li>
            </ul>
          )}
          {filtering && (
            <section aria-label="Matching PDFs" className="space-y-1">
              <h3 className="text-2xs font-semibold uppercase tracking-wide text-muted-foreground">PDFs</h3>
              {pdfList('Your Library is empty', 'Add the papers you are writing against.')}
              {loadMorePdfs}
            </section>
          )}
        </div>
      );
    } else if (place.kind === 'collection') {
      content = (
        <div className="space-y-3">
          {breadcrumbs}
          <CollectionFolderHeader
            collection={openCollectionDetail}
            loading={browse.detailLoading}
            attachment={browse.grant}
            inheritedFromAncestor={false}
            attachmentBusy={grantBusy === place.collectionId}
            readOnly={!canEdit}
            actionButtonRef={actionButtonRef}
            onCreateChild={() =>
              openCollectionDetail &&
              setEditor({ mode: 'create', parentId: openCollectionDetail.id, parentName: openCollectionDetail.name })
            }
            onEdit={() => openCollectionDetail && setEditor({ mode: 'edit', collection: openCollectionDetail })}
            onMove={() => openCollectionDetail && setPicker({ kind: 'collection', collection: openCollectionDetail })}
            onTrash={() => openCollectionDetail && setTrashingCollection(openCollectionDetail)}
            onToggleAttachment={() =>
              openCollectionDetail && void setUsed(openCollectionDetail, !browse.grant?.direct)
            }
          />
          <CollectionChildren
            collections={collectionRows}
            heading="Sub-collections"
            parentEffective={Boolean(browse.grant?.effective)}
            onOpen={openCollection}
            onDrop={handleDrop}
          />
          {moreCollections}
          <CollectionPages
            pages={browse.pages.filter((page) => !filtering || page.name.toLowerCase().includes(nameFilter.trim().toLowerCase()))}
            loading={browse.pagesLoading}
            documentId={documentId}
            hasMore={browse.hasMorePages}
            loadingMore={browse.loadingMorePages}
            onLoadMore={() => void browse.loadMorePages()}
            onOpen={openPage}
          />
          <section aria-label="PDFs in this collection" className="space-y-1">
            {pdfList('No PDFs directly in this collection', 'Upload here, or move a PDF into this collection.')}
            {loadMorePdfs}
          </section>
        </div>
      );
    } else {
      content = (
        <div className="space-y-3">
          {breadcrumbs}
          {place.kind === 'unfiled' && (
            <p className="text-2xs text-muted-foreground">
              PDFs that are not in a collection or on a page. Every page’s assistant can read them.
            </p>
          )}
          {pdfList(
            place.kind === 'unfiled' ? 'Unfiled is empty' : 'Your Library is empty',
            place.kind === 'unfiled'
              ? 'PDFs that are not in a collection or on a page appear here.'
              : 'Add the papers you are writing against. The assistant reads them once conversion finishes.',
          )}
          {loadMorePdfs}
        </div>
      );
    }
  }

  return (
    <div className="relative flex h-full min-h-0 flex-col" {...(canEdit ? dropHandlers : {})}>
      <div className="shrink-0 space-y-2 px-3 pb-2 pt-3">
        <div className="flex items-center gap-1">
          <SegmentedSwitch label="Library view" options={VIEWS} value={view} onChange={openView} />
          <Button
            variant="icon"
            size="icon-sm"
            className="ml-auto shrink-0"
            disabled={library.refreshing}
            onClick={refreshAll}
            aria-label="Refresh the Library"
          >
            <RefreshCw aria-hidden="true" className={cn(library.refreshing && 'animate-spin')} />
          </Button>
        </div>

        <form role="search" onSubmit={onSearch} className="space-y-1.5">
          <div className="relative">
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
              placeholder={placeholder}
              aria-label={searchLabel}
              aria-busy={search.loading}
              value={term}
              maxLength={MAX_SEARCH_QUERY_CHARS}
              onChange={(event) => {
                setTerm(event.target.value);
                // Results answer the query that was run, not one being typed.
                if (search.result || search.error) search.clear();
              }}
            />
            {term && (
              <button
                type="button"
                aria-label="Clear the search"
                onClick={clearSearch}
                className="absolute right-2 top-1/2 grid h-5 w-5 -translate-y-1/2 place-items-center rounded-sm text-muted-foreground transition-colors hover:bg-hover hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <X aria-hidden="true" className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
          <SegmentedSwitch label="Search by" options={MODES} value={mode} onChange={changeMode} />
        </form>

        {canEdit ? (
          <UploadControl
            uploads={uploads}
            choices={uploadChoices}
            onChoose={(target) => setUploadChoice({ place: currentPlace, target })}
            onFiles={(files) => void addFiles(files)}
          />
        ) : (
          <p className="text-2xs text-muted-foreground">You’re a viewer here: you can read these PDFs, not add or change them.</p>
        )}

        {problems.map((problem) => (
          <InlineError key={problem.source} title={problem.message} onRetry={problem.retry} />
        ))}
      </div>

      {/* The one scroll box: the controls above stay put, the list scrolls. */}
      <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-4" aria-busy={library.loading || search.loading}>
        {content}
      </div>

      {dragOver && (
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-1 grid place-items-center rounded-lg bg-tint-blue/80 ring-2 ring-primary/50"
        >
          <p className="text-sm font-medium">Drop to upload to {uploadPlace(uploadTarget)}</p>
        </div>
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
          onSave={saveCollection}
          returnFocusRef={editor.mode === 'create' && editor.parentId === null ? newCollectionRef : actionButtonRef}
        />
      )}
      {pickerDialog}
      {trashingCollection && (
        <CollectionTrashDialog
          collection={trashingCollection}
          onOpenChange={(open) => !open && setTrashingCollection(null)}
          onTrashed={leaveTrashedCollection}
          // The menu that opened the dialog goes with its collection.
          returnFocusRef={searchInputRef}
        />
      )}
    </div>
  );
}

/** The pages that live in the collection Browse is at; one opens it. */
function CollectionPages({
  pages,
  loading,
  documentId,
  hasMore,
  loadingMore,
  onLoadMore,
  onOpen,
}: {
  pages: ReadonlyArray<{ id: string; name: string }>;
  loading: boolean;
  documentId: string | null;
  hasMore: boolean;
  loadingMore: boolean;
  onLoadMore: () => void;
  onOpen: (id: string) => void;
}) {
  if (loading) return null;
  if (pages.length === 0) return null;
  return (
    <section aria-label="Pages in this collection" className="space-y-1">
      <h3 className="text-2xs font-semibold uppercase tracking-wide text-muted-foreground">Pages</h3>
      <ul className="space-y-1">
        {pages.map((page) => (
          <li key={page.id}>
            <button
              type="button"
              className={ROW}
              aria-current={page.id === documentId ? 'page' : undefined}
              onClick={() => onOpen(page.id)}
            >
              <FileText aria-hidden="true" className="h-4 w-4 shrink-0 text-muted-foreground" />
              <span className={cn('min-w-0 flex-1 truncate text-sm', isUntitledName(page.name) && 'text-muted-foreground', page.id === documentId && 'font-medium')}>
                {displayTitle(page.name)}
              </span>
              {page.id === documentId && <span className="shrink-0 text-2xs text-muted-foreground">Open</span>}
            </button>
          </li>
        ))}
      </ul>
      {hasMore && (
        <Button variant="ghost" size="sm" className="w-full" disabled={loadingMore} onClick={onLoadMore}>
          {loadingMore && <Spinner />}
          {loadingMore ? 'Loading…' : 'Show more pages'}
        </Button>
      )}
    </section>
  );
}
