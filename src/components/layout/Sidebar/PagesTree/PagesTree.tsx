import {
  useCallback,
  useContext,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type DragEvent,
  type KeyboardEvent,
  type RefObject,
} from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ArrowUpRight,
  FilePlus2,
  FileText,
  Folder,
  FolderOpen,
  FolderPlus,
  ListFilter,
  Loader2,
  MoreHorizontal,
  Plus,
  RefreshCw,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { pageLink } from '@/lib/pageLink';
import { describeApiError } from '@/api/errors';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { EmptyState } from '@/components/ui/empty-state';
import { InlineError } from '@/components/ui/inline-error';
import { ListSkeleton } from '@/components/ui/list-skeleton';
import { Spinner } from '@/components/ui/spinner';
import { useToast } from '@/components/ui/toastContext';
import { TreeView, type DropPlacement, type TreeRow, type TreeRowBase, type TreeViewHandle } from '@/components/ui/tree';
import { focusPageTitle, useDocumentActions, useDocumentSession, useDocumentStatus, useEditorDoc } from '@/editor';
import { useWorkspaceId } from '@/components/workspace/workspaceContextState';
import { PanelsContext } from '@/components/panels/panelsContextState';
import { displayTitle, isUntitledName } from '@/components/layout/displayTitle';
import { editedLabel, shortDateTime } from '@/components/layout/editedLabel';
import { CollectionEditorDialog } from '@/components/panels/Library/CollectionDialogs';
import { CollectionTrashDialog } from '@/components/collections/CollectionTrashDialog';
import { readLibraryDragPayload, type LibraryDragPayload } from '@/components/panels/Library/collectionDnd';
import { MoveToDialog, type MoveDestination, type MoveSubject } from '@/components/collections/MoveToDialog';
import { CopyToWorkspaceDialog } from '@/components/collections/CopyToWorkspaceDialog';
import { useNewPage } from '@/actions/useNewPage';
import { useTrash } from '@/actions/useTrash';
import { useMoveTo, type CollectionToMove, type PageToMove } from '@/actions/useMoveTo';
import {
  documentListQuery,
  pagePlacementQuery,
  type DocumentSummary,
} from '@/data/documents';
import {
  collectionDetailQuery,
  collectionKeys,
  pathLabel,
  resourceQuery,
  useCollectionMutations,
  useCollectionPaths,
  type CollectionItem,
  type CollectionRef,
} from '@/data/resources';
import { noteOwnTreeChange, updateWorkspace, workspaceKeys, workspaceQuery, type SortMode } from '@/data/workspaces';
import { sidebarHoverAction, sidebarRowActive } from '../sidebarStyles';
import { CollectionRowMenu, PageRowMenu, SortChoices } from './TreeRowMenu';
import { useWorkspaceAccess } from '@/components/workspace/workspaceAccess';
import { useWorkspaceTree, type WorkspaceTree } from './useWorkspaceTree';
import { useRevealRequests } from './treeReveal';
import {
  acceptsRootDrop,
  acceptsTreeDrag,
  canDragRows,
  dropPlacements,
  endRowDrag,
  startRowDrag,
  type DropRow,
} from './treeDnd';

/** Below this many pages a filter field is clutter, not help. */
const FILTER_THRESHOLD = 8;
const FILTER_DEBOUNCE_MS = 250;
const FILTER_LIMIT = 20;
/** How many pages of rows the tree reads to reach the open page in a long collection. */
const REVEAL_PAGES = 10;
const EMPTY_COLLECTION = 'Nothing here yet. Drag pages here, or use Move to….';
/** An empty collection, for a viewer, who cannot fill it. */
const EMPTY_COLLECTION_READ_ONLY = 'Nothing here yet.';
/**
 * A row's "+" and "…": shown on hover, on keyboard focus, while the menu is
 * open and always on touch. Hidden, they take no room from the name.
 */
const ROW_ACTIONS =
  'hidden shrink-0 items-center gap-0.5 group-hover:flex group-focus-visible:flex has-[[data-state=open]]:flex pointer-coarse:flex';

type CollectionRow = TreeRowBase & { kind: 'collection'; item: CollectionItem; ancestors: string[] };
type PageRow = TreeRowBase & { kind: 'page'; page: DocumentSummary };
type MoreRow = TreeRowBase & { kind: 'more'; parentId: number | null; list: 'collections' | 'pages'; loading: boolean };
type Row = CollectionRow | PageRow | MoreRow;

const collectionKey = (id: number) => `c:${id}`;
const pageKey = (id: string) => `p:${id}`;

type OpenPage = { documentId: string | null; name: string | undefined; savedAt: string | null };

/**
 * The tree's rows in display order: each home's collections, then its pages,
 * each with "Show more". A viewer's rows take no drag and no drop.
 */
function flatten(tree: WorkspaceTree, open: OpenPage, draggable: boolean, canEdit: boolean) {
  const rows: TreeRow<Row>[] = [];
  const errors: string[] = [];
  let busy = false;

  const push = (parentId: number | null, level: number, parentKey: string | null, ancestors: string[]) => {
    const branch = tree.branch(parentId);
    if (!branch) return;
    const homeKey = parentId ?? 'root';
    const moreCollections = branch.loaded && branch.moreCollections;
    const morePages = branch.loaded && branch.morePages;
    const setSize = branch.collections.length + Number(moreCollections) + branch.pages.length + Number(morePages);
    let position = 0;

    for (const item of branch.collections) {
      const key = collectionKey(item.id);
      const expanded = tree.isExpanded(item.id);
      rows.push({
        kind: 'collection', item, ancestors, key, label: item.name, level, parentKey,
        position: ++position, setSize, expandable: true, expanded, droppable: canEdit, draggable: draggable && canEdit,
      });
      if (expanded) push(item.id, level + 1, key, [...ancestors, key]);
    }
    if (moreCollections) {
      const loading = branch.loadingMore === 'collections';
      rows.push({
        kind: 'more', parentId, list: 'collections', loading, key: `more:c:${homeKey}`, label: 'Show more collections',
        level, parentKey, position: ++position, setSize, selectable: false, disabled: loading,
      });
    }
    for (const row of branch.pages) {
      const isOpen = row.id === open.documentId;
      // The open page shows what the editor knows: its name as typed.
      const page = isOpen ? { ...row, name: open.name?.trim() || row.name, updatedAt: open.savedAt ?? row.updatedAt } : row;
      rows.push({
        kind: 'page', page, key: pageKey(row.id), label: displayTitle(page.name), level, parentKey,
        position: ++position, setSize, current: isOpen, droppable: canEdit, draggable: draggable && canEdit,
      });
    }
    if (morePages) {
      const loading = branch.loadingMore === 'pages';
      rows.push({
        kind: 'more', parentId, list: 'pages', loading, key: `more:p:${homeKey}`, label: 'Show more pages',
        level, parentKey, position: position + 1, setSize, selectable: false, disabled: loading,
      });
    }
    if (!branch.loaded && branch.loading) {
      busy = true;
      if (parentId !== null) rows.push({ kind: 'note', tone: 'loading', text: 'Loading…', key: `loading:${homeKey}`, level: level });
    }
    if (branch.error) {
      errors.push(branch.error);
      if (parentId !== null) rows.push({ kind: 'note', tone: 'error', text: branch.error, key: `error:${homeKey}`, level });
    }
    if (parentId !== null && branch.loaded && setSize === 0 && !branch.error) {
      rows.push({ kind: 'note', tone: 'empty', text: canEdit ? EMPTY_COLLECTION : EMPTY_COLLECTION_READ_ONLY, key: `empty:${homeKey}`, level });
    }
  };

  push(null, 1, null, []);
  return { rows, errors, busy };
}

function collectionToMove(item: CollectionItem): CollectionToMove {
  return { id: item.id, name: item.name, parentId: item.parent_id, etag: item.etag };
}

function pageToMove(page: DocumentSummary): PageToMove {
  return { id: page.id, name: page.name, collectionId: page.collectionId, placementEtag: page.placementEtag };
}

type EditorState = { parentId: number | null; parentName: string | null };
type MoveState = { subject: MoveSubject; page?: PageToMove; collection?: CollectionToMove; key: string };

/**
 * The sidebar's "Pages" section: the workspace's tree (08 §6.1, 14 §3.1).
 *
 * Collections and pages, each collection opening to its own collections and
 * then its pages, in the order its home is in. The open page is revealed and
 * marked. Typing in the filter swaps the tree for workspace-wide results with
 * their paths. Every row has a menu, and every drag has a menu twin.
 */
export function PagesTree({ onPageOpened }: { onPageOpened?: () => void } = {}) {
  const workspaceId = useWorkspaceId();
  const queryClient = useQueryClient();
  const tree = useWorkspaceTree({ pages: true, persist: true, watch: true });
  const { switchTo } = useDocumentActions();
  const { documentId, loadingDocumentId } = useDocumentSession();
  const { doc } = useEditorDoc();
  const { lastSavedAt } = useDocumentStatus();
  const panels = useContext(PanelsContext);
  const { toast } = useToast();
  const newPage = useNewPage();
  const { trashPage, trashing } = useTrash();
  const move = useMoveTo();
  const mutations = useCollectionMutations(workspaceId);
  const headingId = useId();
  const handle = useRef<TreeViewHandle | null>(null);
  // Where a dialog gives focus back when it closes: a row, found when it
  // closes, so a row that moved or was just made is found where it is now.
  const returnKey = useRef<string | null>(null);
  const returnFocus = useMemo<RefObject<HTMLElement | null>>(() => ({
    get current() {
      return returnKey.current ? (handle.current?.rowElement(returnKey.current) ?? null) : null;
    },
    set current(_element) {
      // Written only through `returnKey`.
    },
  }), []);
  const filterRef = useRef<HTMLInputElement | null>(null);
  const pendingFilterFocus = useRef(false);

  const [menuKey, setMenuKey] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<number | null>(null);
  const [editor, setEditor] = useState<EditorState | null>(null);
  const [trashingCollection, setTrashingCollection] = useState<{ collection: CollectionRef; nextKey: string | null } | null>(null);
  const [moving, setMoving] = useState<MoveState | null>(null);
  /** The page "Copy to workspace…" was chosen for, from its row. */
  const [copying, setCopying] = useState<{ id: string; name: string; collectionId: number | null } | null>(null);
  const [focusTarget, setFocusTarget] = useState<string | null>(null);
  const [rootDrop, setRootDrop] = useState(false);
  const [filterOpen, setFilterOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [term, setTerm] = useState('');

  const draggable = useMemo(() => canDragRows(), []);
  // A viewer (D6) opens, reads and links; nothing here creates, renames,
  // sorts, moves or trashes for them. The top level's order is an admin's.
  const { canEdit, isAdmin } = useWorkspaceAccess();
  const savedAt = lastSavedAt === null ? null : new Date(lastSavedAt).toISOString();
  const { rows, errors, busy } = useMemo(
    () => flatten(tree, { documentId, name: doc.name, savedAt }, draggable, canEdit),
    [canEdit, doc.name, documentId, draggable, savedAt, tree],
  );
  const rowsByKey = useMemo(() => {
    const map = new Map<string, Row>();
    for (const row of rows) if (row.kind !== 'note') map.set(row.key, row);
    return map;
  }, [rows]);

  /* ------------------------------------------------------- the open page */

  const placement = useQuery({ ...pagePlacementQuery(workspaceId, documentId ?? ''), enabled: documentId !== null });
  const homeId = placement.data?.collectionId ?? null;
  const homeDetail = useQuery({ ...collectionDetailQuery(workspaceId, homeId ?? 0), enabled: homeId !== null });
  const revealedFor = useRef<string | null>(null);
  const homePath = homeDetail.data?.path;
  const expandPath = tree.expandPath;
  useEffect(() => {
    if (!documentId || placement.data === undefined) return;
    const key = `${documentId}:${homeId ?? 'root'}`;
    if (revealedFor.current === key) return;
    if (homeId !== null && !homePath) return;
    revealedFor.current = key;
    if (homePath) expandPath(homePath.map((item) => item.id));
  }, [documentId, expandPath, homeId, homePath, placement.data]);

  // The open page may be past "Show more" in a long collection: read on to it.
  const homeBranch = tree.branch(homeId);
  const paged = useRef<{ documentId: string | null; count: number }>({ documentId: null, count: 0 });
  const loadMore = tree.loadMore;
  useEffect(() => {
    if (!documentId || !homeBranch?.loaded || homeBranch.loading || homeBranch.loadingMore) return;
    if (!homeBranch.morePages || homeBranch.pages.some((page) => page.id === documentId)) return;
    if (paged.current.documentId !== documentId) paged.current = { documentId, count: 0 };
    if (paged.current.count >= REVEAL_PAGES) return;
    paged.current.count += 1;
    void loadMore(homeId, 'pages');
  }, [documentId, homeBranch, homeId, loadMore]);

  /* ------------------------------------------------------------- reveal */

  const pathOf = useCallback(async (collectionId: number | null): Promise<number[]> => {
    if (collectionId === null) return [];
    try {
      const detail = await queryClient.fetchQuery(collectionDetailQuery(workspaceId, collectionId));
      return detail.path.map((item) => item.id);
    } catch {
      return [];
    }
  }, [queryClient, workspaceId]);

  useRevealRequests(async (request) => {
    if (request.kind === 'page') {
      tree.expandPath(await pathOf(request.collectionId));
      if (request.focus) setFocusTarget(pageKey(request.id));
      return;
    }
    const path = await pathOf(request.id);
    tree.expandPath(request.expand ? path : path.slice(0, -1));
    if (request.focus !== false) setFocusTarget(collectionKey(request.id));
  });

  useEffect(() => {
    if (focusTarget && handle.current?.focusRow(focusTarget)) setFocusTarget(null);
  }, [focusTarget, rows]);

  /* ------------------------------------------------------------ actions */

  const openPage = async (id: string) => {
    if (id === documentId || id === loadingDocumentId) return;
    try {
      if (await switchTo(id)) onPageOpened?.();
    } catch {
      // The editor owns the one load-failure notice and keeps the open page.
    }
  };

  const copyLink = async (id: string) => {
    try {
      await navigator.clipboard.writeText(pageLink(id));
      toast({ title: 'Link copied', variant: 'success' });
    } catch {
      toast({ title: 'Could not copy the link', variant: 'error' });
    }
  };

  /** A page is renamed through its title, so it saves like any edit. */
  const renamePage = async (page: DocumentSummary) => {
    if (page.id !== documentId) {
      try {
        if (!(await switchTo(page.id))) return;
      } catch {
        return;
      }
    }
    requestAnimationFrame(() => focusPageTitle());
  };

  const saveName = async (item: CollectionItem, name: string) => {
    setRenaming(null);
    setFocusTarget(collectionKey(item.id));
    const trimmed = name.trim();
    if (!trimmed || trimmed === item.name) return;
    try {
      await mutations.rename({ collection: item, changes: { name: trimmed } });
    } catch (error) {
      toast({ title: `Could not rename ${item.name}`, description: describeApiError(error, 'The server refused the change.'), variant: 'error' });
    }
  };

  const setSort = async (item: CollectionItem, mode: SortMode) => {
    if (mode === item.sort_mode) return;
    try {
      await mutations.rename({ collection: item, changes: { sort_mode: mode } });
    } catch (error) {
      toast({ title: `Could not sort ${item.name}`, description: describeApiError(error, 'The server refused the change.'), variant: 'error' });
    }
  };

  const setRootSort = async (mode: SortMode) => {
    if (mode === tree.root.sortMode || !tree.root.etag) return;
    try {
      const detail = await updateWorkspace(workspaceId, tree.root.etag, { root_sort_mode: mode });
      noteOwnTreeChange(workspaceId, detail.tree_version);
      queryClient.setQueryData(workspaceKeys.detail(workspaceId), detail);
      void queryClient.invalidateQueries({ queryKey: [...collectionKeys.all(workspaceId), 'branch'] });
    } catch (error) {
      void queryClient.invalidateQueries({ queryKey: workspaceKeys.detail(workspaceId) });
      toast({ title: 'Could not change the order', description: describeApiError(error, 'The server refused the change.'), variant: 'error' });
    }
  };

  const setGrantNewPages = async (item: CollectionItem, on: boolean) => {
    try {
      await mutations.rename({ collection: item, changes: { grant_new_pages: on } });
      toast({
        title: on
          ? `Pages added to ${item.name} can now use its PDFs`
          : `Pages added to ${item.name} no longer use its PDFs`,
        variant: 'success',
      });
    } catch (error) {
      toast({ title: `Could not change ${item.name}`, description: describeApiError(error, 'The server refused the change.'), variant: 'error' });
    }
  };

  const showPdfs = (item: CollectionItem) => panels?.openSidebar('library', { tab: 'library', collectionId: item.id });

  /** The row a dialog opened from gets focus back when it closes. */
  const rememberRow = (key: string) => {
    returnKey.current = key;
  };

  const siblingsOf = (row: CollectionRow | PageRow) => {
    const branch = tree.branch(row.kind === 'collection' ? row.item.parent_id : row.page.collectionId);
    return row.kind === 'collection' ? (branch?.collections ?? []).map((item) => item.id) : (branch?.pages ?? []).map((page) => page.id);
  };
  const isCustom = (home: number | null) =>
    (home === null ? tree.root.sortMode : tree.findCollection(home)?.sort_mode ?? tree.branch(home)?.sortMode) === 'custom';

  const moveBy = (row: CollectionRow | PageRow, step: -1 | 1) => {
    const ids = siblingsOf(row);
    const id = row.kind === 'collection' ? row.item.id : row.page.id;
    const index = ids.findIndex((candidate) => candidate === id);
    const neighbour = ids[index + step];
    if (index < 0 || neighbour === undefined) return;
    if (row.kind === 'collection') {
      const position = step < 0 ? { before_id: neighbour as number } : { after_id: neighbour as number };
      void move.reorderCollection(collectionToMove(row.item), position);
    } else {
      const position = step < 0 ? { before_id: neighbour as string } : { after_id: neighbour as string };
      void move.reorderPage(pageToMove(row.page), position);
    }
  };

  const canMove = (row: CollectionRow | PageRow, step: -1 | 1) => {
    const ids = siblingsOf(row);
    const index = ids.findIndex((candidate) => candidate === (row.kind === 'collection' ? row.item.id : row.page.id));
    return index >= 0 && ids[index + step] !== undefined;
  };

  /** The row focus goes to once this one has gone to the Trash: the next one, else the one before. */
  const rowAfter = (row: CollectionRow | PageRow): string | null => {
    const index = rows.findIndex((candidate) => candidate.key === row.key);
    const later = rows.slice(index + 1).find((candidate) => candidate.kind !== 'note' && candidate.kind !== 'more'
      && candidate.level <= row.level);
    const earlier = rows.slice(0, Math.max(0, index)).reverse().find((candidate) => candidate.kind !== 'note' && candidate.kind !== 'more');
    return (later ?? earlier)?.key ?? null;
  };

  const trashRow = (row: CollectionRow | PageRow) => {
    rememberRow(row.key);
    const nextKey = rowAfter(row);
    if (row.kind === 'page') {
      void trashPage({ id: row.page.id, name: row.page.name, collectionId: row.page.collectionId }).then((trashed) => {
        if (trashed && nextKey) setFocusTarget(nextKey);
      });
    } else {
      setTrashingCollection({ collection: row.item, nextKey });
    }
  };

  const openMoveTo = (row: CollectionRow | PageRow) => {
    rememberRow(row.key);
    if (row.kind === 'page') {
      setMoving({
        key: row.key,
        subject: { kind: 'page', name: displayTitle(row.page.name), collectionId: row.page.collectionId },
        page: pageToMove(row.page),
      });
    } else {
      setMoving({
        key: row.key,
        subject: { kind: 'collection', name: row.item.name, collectionId: row.item.id, parentId: row.item.parent_id },
        collection: collectionToMove(row.item),
      });
    }
  };

  const chooseDestination = async (destination: MoveDestination) => {
    if (!moving) return;
    const to = destination.kind === 'collection'
      ? { id: destination.collectionId, name: destination.name }
      : { id: null, name: null };
    if (moving.page) await move.movePage(moving.page, to);
    else if (moving.collection) await move.moveCollection(moving.collection, to);
  };

  /* -------------------------------------------------------------- drops */

  const dropRowOf = (row: Row): DropRow => {
    if (row.kind === 'collection') return { kind: 'collection', id: row.item.id, parentId: row.item.parent_id, key: row.key, ancestors: row.ancestors };
    if (row.kind === 'page') return { kind: 'page', id: row.page.id, collectionId: row.page.collectionId, key: row.key };
    return { kind: 'other' };
  };

  const draggedPage = (payload: Extract<LibraryDragPayload, { kind: 'document' }>): PageToMove | null => {
    const row = rowsByKey.get(pageKey(payload.id));
    return row?.kind === 'page' ? { ...pageToMove(row.page), placementEtag: payload.placementEtag } : null;
  };
  const draggedCollection = (payload: Extract<LibraryDragPayload, { kind: 'collection' }>): CollectionToMove | null => {
    const item = tree.findCollection(payload.id);
    return item ? { ...collectionToMove(item), etag: payload.etag ?? item.etag } : null;
  };

  /** Into a collection, or (`null`) to the top level. */
  const dropInto = async (payload: LibraryDragPayload, target: { id: number | null; name: string | null }) => {
    if (payload.kind === 'document') {
      const page = draggedPage(payload);
      if (page && page.collectionId !== target.id) await move.movePage(page, target);
    } else if (payload.kind === 'collection') {
      const collection = draggedCollection(payload);
      if (collection && collection.parentId !== target.id && collection.id !== target.id) await move.moveCollection(collection, target);
    } else if (target.id !== null) {
      try {
        const resource = await queryClient.fetchQuery(resourceQuery(workspaceId, payload.id));
        await move.movePdf(resource, { collectionId: target.id, name: target.name ?? 'that collection' });
      } catch (error) {
        toast({ title: 'Could not move that PDF', description: describeApiError(error, 'The server refused the move.'), variant: 'error' });
      }
    }
  };

  const onDrop = (row: Row, placement: DropPlacement, dataTransfer: DataTransfer) => {
    const payload = readLibraryDragPayload(dataTransfer);
    endRowDrag();
    if (!payload) return;
    if (row.kind === 'collection' && placement === 'inside') {
      void dropInto(payload, { id: row.item.id, name: row.item.name });
      return;
    }
    if (row.kind === 'collection' && payload.kind === 'collection') {
      const collection = draggedCollection(payload);
      if (!collection || collection.id === row.item.id) return;
      const position = placement === 'before' ? { before_id: row.item.id } : { after_id: row.item.id };
      if (collection.parentId === row.item.parent_id) void move.reorderCollection(collection, position);
      else void move.moveCollection(collection, { id: row.item.parent_id, name: tree.findCollection(row.item.parent_id ?? 0)?.name ?? null, position });
      return;
    }
    if (row.kind === 'page' && payload.kind === 'document') {
      const page = draggedPage(payload);
      if (!page || page.id === row.page.id) return;
      const position = placement === 'before' ? { before_id: row.page.id } : { after_id: row.page.id };
      if (page.collectionId === row.page.collectionId) void move.reorderPage(page, position);
      else void move.movePage(page, { id: row.page.collectionId, name: tree.findCollection(row.page.collectionId ?? 0)?.name ?? null, position });
    }
  };

  const rootDropProps = {
    onDragEnter: (event: DragEvent<HTMLDivElement>) => {
      if (!acceptsRootDrop(event.dataTransfer)) return;
      event.preventDefault();
      setRootDrop(true);
    },
    onDragOver: (event: DragEvent<HTMLDivElement>) => {
      if (!acceptsRootDrop(event.dataTransfer)) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = 'move';
      setRootDrop(true);
    },
    onDragLeave: (event: DragEvent<HTMLDivElement>) => {
      if (event.currentTarget.contains(event.relatedTarget as Node | null)) return;
      setRootDrop(false);
    },
    onDrop: (event: DragEvent<HTMLDivElement>) => {
      setRootDrop(false);
      if (!acceptsRootDrop(event.dataTransfer)) return;
      event.preventDefault();
      const payload = readLibraryDragPayload(event.dataTransfer);
      endRowDrag();
      if (payload) void dropInto(payload, { id: null, name: null });
    },
  };

  /* --------------------------------------------------------------- keys */

  const onRowKeyDown = (row: Row, event: KeyboardEvent<HTMLDivElement>) => {
    if (row.kind === 'more') return;
    if ((event.key === 'F10' && event.shiftKey) || event.key === 'ContextMenu') {
      event.preventDefault();
      setMenuKey(row.key);
      return;
    }
    if (!canEdit && (event.key === 'F2' || event.key === 'Delete' || (event.altKey && event.shiftKey))) return;
    if (event.key === 'F2') {
      event.preventDefault();
      if (row.kind === 'collection') setRenaming(row.item.id);
      else void renamePage(row.page);
      return;
    }
    if (event.key === 'Delete') {
      event.preventDefault();
      trashRow(row);
      return;
    }
    if (event.altKey && event.shiftKey && (event.key === 'ArrowUp' || event.key === 'ArrowDown')) {
      event.preventDefault();
      const home = row.kind === 'collection' ? row.item.parent_id : row.page.collectionId;
      if (isCustom(home)) moveBy(row, event.key === 'ArrowUp' ? -1 : 1);
    }
  };

  /* ------------------------------------------------------------- filter */

  useEffect(() => {
    const timer = window.setTimeout(() => setTerm(query.trim()), FILTER_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [query]);
  const workspace = useQuery(workspaceQuery(workspaceId));
  const filtering = term !== '';
  const results = useQuery({
    ...documentListQuery(workspaceId, { limit: FILTER_LIMIT, query: term || undefined, sortBy: 'updated_at', sortOrder: 'desc' }),
    enabled: filtering,
  });
  const found = filtering ? (results.data?.documents ?? []) : [];
  const paths = useCollectionPaths(workspaceId, found.map((page) => page.collectionId));
  const showFilter = filterOpen || query !== '' || (workspace.data?.counts.pages ?? 0) > FILTER_THRESHOLD;

  /* ------------------------------------------------------------- render */

  const root = tree.branch(null);
  const hasRows = rows.some((row) => row.kind !== 'note');
  const rootError = root?.error ?? null;
  const busyAction = trashing || Boolean(loadingDocumentId);

  const renderRow = (row: Row) => {
    if (row.kind === 'more') {
      return (
        <span className="flex min-w-0 flex-1 items-center gap-2 text-muted-foreground">
          {row.loading ? <Loader2 aria-hidden="true" className="size-4 animate-spin" /> : <Plus aria-hidden="true" className="size-4" />}
          {row.loading ? 'Loading…' : row.label}
        </span>
      );
    }
    if (row.kind === 'collection') {
      const { item } = row;
      const Icon = row.expanded ? FolderOpen : Folder;
      return (
        <>
          <Icon aria-hidden="true" className="size-[18px] shrink-0 text-muted-foreground" />
          {renaming === item.id ? (
            <input
              autoFocus
              defaultValue={item.name}
              aria-label={`Rename ${item.name}`}
              maxLength={191}
              className="h-6 min-w-0 flex-1 rounded-sm bg-subtle px-1 text-sm text-foreground outline-none ring-2 ring-ring/40"
              onClick={(event) => event.stopPropagation()}
              onKeyDown={(event) => {
                event.stopPropagation();
                if (event.key === 'Enter') void saveName(item, event.currentTarget.value);
                if (event.key === 'Escape') {
                  setRenaming(null);
                  setFocusTarget(row.key);
                }
              }}
              onBlur={(event) => {
                if (renaming === item.id) void saveName(item, event.currentTarget.value);
              }}
            />
          ) : (
            <span className="min-w-0 flex-1 truncate" title={item.name}>{item.name}</span>
          )}
          {item.pdf_count > 0 && renaming !== item.id && (
            <button
              type="button"
              tabIndex={-1}
              className="flex shrink-0 items-center gap-0.5 rounded-xs px-1 text-2xs tabular-nums text-muted-foreground hover:bg-active hover:text-foreground"
              aria-label={`Show the ${item.pdf_count} PDF${item.pdf_count === 1 ? '' : 's'} in ${item.name} in the Library`}
              title="Show in the Library"
              onClick={(event) => {
                event.stopPropagation();
                showPdfs(item);
              }}
            >
              {item.pdf_count} PDF{item.pdf_count === 1 ? '' : 's'}
              <ArrowUpRight aria-hidden="true" className="size-3" />
            </button>
          )}
          <span className={ROW_ACTIONS}>
            {canEdit && (
            <button
              type="button"
              tabIndex={-1}
              className={sidebarHoverAction}
              aria-label={`New page in ${item.name}`}
              title="New page here"
              disabled={newPage.disabled}
              onClick={(event) => {
                event.stopPropagation();
                void newPage.newPage(undefined, { collectionId: item.id });
              }}
            >
              <Plus aria-hidden="true" />
            </button>
            )}
            <CollectionRowMenu
              canEdit={canEdit}
              open={menuKey === row.key}
              onOpenChange={(open) => setMenuKey(open ? row.key : null)}
              onCloseFocus={(event) => {
                event.preventDefault();
                handle.current?.focusRow(row.key);
              }}
              label={item.name}
              sortMode={item.sort_mode}
              grantNewPages={item.grant_new_pages}
              pdfCount={item.pdf_count}
              custom={isCustom(item.parent_id)}
              canMoveUp={canMove(row, -1)}
              canMoveDown={canMove(row, 1)}
              onNewPage={() => void newPage.newPage(undefined, { collectionId: item.id })}
              onNewCollection={() => {
                rememberRow(row.key);
                setEditor({ parentId: item.id, parentName: item.name });
              }}
              onRename={() => setRenaming(item.id)}
              onSort={(mode) => void setSort(item, mode)}
              onMoveTo={() => openMoveTo(row)}
              onMoveUp={() => moveBy(row, -1)}
              onMoveDown={() => moveBy(row, 1)}
              onShowPdfs={() => showPdfs(item)}
              onGrantNewPages={(on) => void setGrantNewPages(item, on)}
              onTrash={() => trashRow(row)}
            />
          </span>
        </>
      );
    }
    const { page } = row;
    const pending = loadingDocumentId === page.id;
    const updated = shortDateTime(page.updatedAt);
    return (
      <>
        {pending ? <Spinner className="size-[18px]" /> : <FileText aria-hidden="true" className="size-[18px] shrink-0 text-muted-foreground" />}
        <span
          className={cn('min-w-0 flex-1 truncate', isUntitledName(page.name) && 'text-muted-foreground')}
          title={updated ? `${row.label}\nEdited ${updated}` : row.label}
        >
          {row.label}
        </span>
        {pending && <span className="sr-only">Opening…</span>}
        <span className={ROW_ACTIONS}>
        <PageRowMenu
          canEdit={canEdit}
          open={menuKey === row.key}
          onOpenChange={(open) => setMenuKey(open ? row.key : null)}
          onCloseFocus={(event) => {
            event.preventDefault();
            handle.current?.focusRow(row.key);
          }}
          label={row.label}
          pageId={page.id}
          isOpenPage={page.id === documentId}
          busy={busyAction}
          custom={isCustom(page.collectionId)}
          canMoveUp={canMove(row, -1)}
          canMoveDown={canMove(row, 1)}
          edited={editedLabel(page.updatedAt)}
          onOpen={() => void openPage(page.id)}
          onCopyLink={() => void copyLink(page.id)}
          onRename={() => void renamePage(page)}
          onMoveTo={() => openMoveTo(row)}
          onCopyToWorkspace={() => setCopying({ id: page.id, name: row.label, collectionId: page.collectionId })}
          onMoveUp={() => moveBy(row, -1)}
          onMoveDown={() => moveBy(row, 1)}
          onTrash={() => trashRow(row)}
        />
        </span>
      </>
    );
  };

  return (
    <section aria-labelledby={headingId} className="pages-tree flex flex-col gap-px">
      <div
        className={cn(
          'group/section flex h-7 items-center gap-0.5 rounded-md pl-2 pr-1 hover:bg-hover',
          rootDrop && 'bg-primary/10 ring-1 ring-primary',
        )}
        {...(canEdit ? rootDropProps : {})}
      >
        <h2 id={headingId} className="min-w-0 flex-1 truncate text-xs font-medium text-muted-foreground">
          Pages
        </h2>
        {rootDrop && <span className="text-2xs text-primary">Move to the top level</span>}
        <div className="flex items-center gap-0.5 opacity-0 transition-opacity focus-within:opacity-100 group-hover/section:opacity-100 has-[[data-state=open]]:opacity-100 pointer-coarse:opacity-100">
          <DropdownMenu>
            <DropdownMenuTrigger className={sidebarHoverAction} aria-label="Page list options">
              <MoreHorizontal aria-hidden="true" />
            </DropdownMenuTrigger>
            <DropdownMenuContent
              align="start"
              className="w-60"
              onCloseAutoFocus={(event) => {
                if (!pendingFilterFocus.current) return;
                pendingFilterFocus.current = false;
                event.preventDefault();
                filterRef.current?.focus();
              }}
            >
              {isAdmin && (
                <>
                  <SortChoices label="Sort the top level" value={tree.root.sortMode} onChange={(mode) => void setRootSort(mode)} />
                  <DropdownMenuSeparator />
                </>
              )}
              <DropdownMenuItem
                onSelect={() => {
                  setFilterOpen(true);
                  pendingFilterFocus.current = true;
                }}
              >
                <ListFilter aria-hidden="true" />
                Filter pages
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => void tree.refresh()}>
                <RefreshCw aria-hidden="true" />
                Refresh
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          {canEdit && (
          <DropdownMenu>
            <DropdownMenuTrigger className={sidebarHoverAction} aria-label="Add a page or a collection" disabled={newPage.disabled}>
              {newPage.creating ? <Spinner /> : <Plus aria-hidden="true" />}
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-52">
              <DropdownMenuItem onSelect={() => void newPage.newPage(undefined, { collectionId: null })}>
                <FilePlus2 aria-hidden="true" />
                New page
              </DropdownMenuItem>
              <DropdownMenuItem
                onSelect={() => {
                  returnKey.current = null;
                  setEditor({ parentId: null, parentName: null });
                }}
              >
                <FolderPlus aria-hidden="true" />
                New collection
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          )}
        </div>
      </div>

      {showFilter && (
        <input
          ref={filterRef}
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Escape' && query) {
              event.preventDefault();
              setQuery('');
              setTerm('');
            }
          }}
          placeholder="Filter pages…"
          aria-label="Search pages"
          className="mb-1 h-7 w-full rounded-md bg-transparent px-2 text-sm text-foreground outline-none transition-colors placeholder:text-placeholder hover:bg-hover focus:bg-subtle focus:ring-2 focus:ring-ring/40 pointer-coarse:h-9"
        />
      )}

      {filtering ? (
        <FilterResults
          loading={results.isFetching && !results.data}
          failed={results.isError}
          term={term}
          pages={found}
          pathOf={(collectionId) => (collectionId === null ? 'Top level' : (paths.get(collectionId) ? pathLabel(paths.get(collectionId) ?? []) : ''))}
          documentId={documentId}
          onOpen={(id) => void openPage(id)}
          onRetry={() => void results.refetch()}
        />
      ) : (
        <>
          {!hasRows && root?.loading && <ListSkeleton dense />}
          <TreeView
            rows={rows}
            ariaLabel="Pages"
            selectedKey={documentId ? pageKey(documentId) : null}
            busy={busy}
            handleRef={handle}
            onActivate={(row) => {
              if (row.kind === 'more') void tree.loadMore(row.parentId, row.list);
              else if (row.kind === 'collection') tree.setExpanded(row.item.id, !tree.isExpanded(row.item.id));
              else void openPage(row.page.id);
            }}
            onExpandedChange={(row, expanded) => {
              if (row.kind === 'collection') tree.setExpanded(row.item.id, expanded);
            }}
            onRowKeyDown={onRowKeyDown}
            drop={{
              accepts: acceptsTreeDrag,
              placements: (row, dataTransfer) => dropPlacements(dropRowOf(row), dataTransfer, isCustom),
              onDrop,
            }}
            drag={{
              onDragStart: (row, dataTransfer) => {
                if (row.kind === 'page') startRowDrag(dataTransfer, row, { kind: 'document', id: row.page.id, placementEtag: row.page.placementEtag });
                else if (row.kind === 'collection') startRowDrag(dataTransfer, row, { kind: 'collection', id: row.item.id, etag: row.item.etag });
              },
              onDragEnd: endRowDrag,
            }}
            rowClassName={(row, state) => cn(
              'min-h-[30px] cursor-pointer text-sm text-sidebar-foreground pointer-coarse:min-h-11',
              row.kind === 'more' ? 'text-muted-foreground hover:bg-hover' : 'hover:bg-hover has-[[data-state=open]]:bg-hover',
              (state.selected || row.current) && sidebarRowActive,
            )}
            renderRow={renderRow}
          />
          {root?.loaded && !hasRows && !rootError && (
            <EmptyState size="inline" title="No pages yet" description="Create a page or a collection with the “+” above." />
          )}
          {/* Outside the tree, which may own only its rows. */}
          {rootError && !hasRows ? (
            <InlineError title="Could not load pages" detail={rootError} onRetry={() => void tree.refresh()} />
          ) : (
            errors[0] !== undefined && <InlineError title={errors[0]} onRetry={() => void tree.refresh()} />
          )}
        </>
      )}

      {editor && (
        <CollectionEditorDialog
          key={`create-${editor.parentId ?? 'root'}`}
          open
          mode="create"
          parentName={editor.parentName}
          onOpenChange={(open) => !open && setEditor(null)}
          onSave={async (values) => {
            const created = await mutations.create({ ...values, parentId: editor.parentId });
            noteOwnTreeChange(workspaceId, created.tree_version);
            tree.expandPath(created.path.slice(0, -1).map((item) => item.id));
            // The new row is revealed and takes focus once the dialog closes.
            returnKey.current = collectionKey(created.id);
            setFocusTarget(collectionKey(created.id));
          }}
          returnFocusRef={returnFocus}
        />
      )}
      {trashingCollection && (
        <CollectionTrashDialog
          collection={trashingCollection.collection}
          onOpenChange={(open) => !open && setTrashingCollection(null)}
          // Focus goes to the row after it once it has gone.
          onTrashed={() => {
            returnKey.current = trashingCollection.nextKey;
          }}
          returnFocusRef={returnFocus}
        />
      )}
      {moving && (
        <MoveToDialog
          open
          subject={moving.subject}
          onOpenChange={(open) => !open && setMoving(null)}
          onChoose={chooseDestination}
          returnFocusRef={returnFocus}
        />
      )}
      {copying && (
        <CopyToWorkspaceDialog page={copying} onOpenChange={(open) => !open && setCopying(null)} returnFocusRef={returnFocus} />
      )}
    </section>
  );
}

/** The filter's answer: pages from the whole workspace, each with where it lives. */
function FilterResults({
  loading,
  failed,
  term,
  pages,
  pathOf,
  documentId,
  onOpen,
  onRetry,
}: {
  loading: boolean;
  failed: boolean;
  term: string;
  pages: DocumentSummary[];
  pathOf: (collectionId: number | null) => string;
  documentId: string | null;
  onOpen: (id: string) => void;
  onRetry: () => void;
}) {
  if (loading) return <ListSkeleton dense />;
  if (failed) return <InlineError title="Could not search the pages" onRetry={onRetry} />;
  if (pages.length === 0) return <EmptyState size="inline" title={`Nothing matches “${term}”`} />;
  return (
    <ul className="flex flex-col gap-px" aria-label="Matching pages">
      {pages.map((page) => {
        const current = page.id === documentId;
        const path = pathOf(page.collectionId);
        return (
          <li key={page.id}>
            <button
              type="button"
              aria-current={current ? 'page' : undefined}
              className={cn(
                'flex w-full min-w-0 items-center gap-2 rounded-md px-2 py-1 text-left text-sm text-sidebar-foreground transition-colors hover:bg-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring pointer-coarse:min-h-11',
                current && sidebarRowActive,
              )}
              onClick={() => onOpen(page.id)}
            >
              <FileText aria-hidden="true" className="size-[18px] shrink-0 text-muted-foreground" />
              <span className="min-w-0 flex-1">
                <span className={cn('block truncate', isUntitledName(page.name) && 'text-muted-foreground')}>{displayTitle(page.name)}</span>
                {path && <span className="block truncate text-2xs text-muted-foreground">{path}</span>}
              </span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}
