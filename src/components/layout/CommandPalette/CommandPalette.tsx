import { useEffect, useId, useMemo, useRef, useState, type ElementType } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useWorkspace, useWorkspaceId } from '@/components/workspace/workspaceContextState';
import { CreateWorkspaceDialog } from '@/components/workspace/CreateWorkspaceDialog';
import { useWorkspaceAccess, workspaceBadge } from '@/components/workspace/workspaceAccess';
import { InviteDialog } from '@/components/profile/InviteDialog';
import { requestSettingsPane } from '@/components/profile/settingsPane';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import {
  BookOpen,
  FileText,
  FolderInput,
  FolderPlus,
  Hash,
  Keyboard,
  Layers,
  Plus,
  Moon,
  PanelLeft,
  PanelRight,
  Search,
  Settings,
  Sparkles,
  SquarePen,
  Sun,
  Trash2,
  UserPlus,
  Users,
} from 'lucide-react';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { Kbd } from '@/components/ui/kbd';
import { Spinner } from '@/components/ui/spinner';
import { cn } from '@/lib/utils';
import { useTheme } from '@/lib/theme';
import { htmlToText, useDocumentActions, useDocumentId, useEditorActions, useEditorDoc } from '@/editor';
import { usePanels } from '@/components/panels/panelsContextState';
import { toolsForEnabledSources } from '@/components/panels/toolsConfig';
import { useAgentTools } from '@/components/preferences';
import { SHORTCUTS, modifierLabel, type ShortcutId } from '../Shortcuts/shortcuts';
import { useView } from '../viewContextState';
import { useNewPage } from '@/actions/useNewPage';
import { useSidebarToggle } from '../useShellLayout';
import { relativeTime } from '../relativeTime';
import { displayTitle, isUntitledName } from '../displayTitle';
import { useReturnFocus } from '@/hooks/useReturnFocus';
import { useMediaQuery } from '@/hooks/useMediaQuery';
import { scrollBehavior } from '@/lib/motion';
import { documentListQuery, pagePlacementQuery, type DocumentSummary } from '@/data/documents';
import { pathLabel, useCollectionMutations, useCollectionPaths } from '@/data/resources';
import { noteOwnTreeChange } from '@/data/workspaces';
import { MoveToDialog, type MoveDestination } from '@/components/collections/MoveToDialog';
import { CollectionEditorDialog } from '@/components/panels/Library/CollectionDialogs';
import { revealInTree } from '../Sidebar/PagesTree/treeReveal';
import { useMoveTo } from '@/actions/useMoveTo';

type Group = 'Recent' | 'On this page' | 'Pages' | 'Switch workspace' | 'Commands' | 'Panels';

type Item = {
  id: string;
  group: Group;
  label: string;
  /** Shown muted, like an untitled page's "Untitled". */
  muted?: boolean;
  hint?: string;
  shortcut?: ShortcutId;
  icon: ElementType;
  keywords?: string;
  /**
   * Opens another dialog. Focus then goes back, when that dialog closes, to
   * where it was before the palette opened, not to the palette's field.
   */
  opensDialog?: boolean;
  run: () => void;
};

/** Recent pages shown before anything is typed. */
const RECENT_LIMIT = 5;
const SEARCH_LIMIT = 8;
const SEARCH_DEBOUNCE_MS = 180;
const NO_DOCUMENTS: DocumentSummary[] = [];

const GROUP_ORDER: readonly Group[] = ['Recent', 'On this page', 'Pages', 'Switch workspace', 'Commands', 'Panels'];

/** The dialogs a command opens; they outlive the palette, which closes first. */
type PaletteDialog = 'new-collection' | 'move-page' | 'new-workspace' | 'invite';

function matches(item: Item, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return `${item.label} ${item.hint ?? ''} ${item.keywords ?? ''}`.toLowerCase().includes(q);
}

/** The keycaps of an action's first binding, for the hint at the row's end. */
function shortcutKeys(id: ShortcutId): string[] {
  const modifier = modifierLabel();
  const binding = SHORTCUTS.find((shortcut) => shortcut.id === id);
  return binding ? binding.keys.map((key) => (key === 'Mod' ? modifier : key)) : [];
}

/**
 * The command palette (Mod+K / Mod+P), shaped like Notion's search: a wide
 * field near the top of the window, recent pages before anything is
 * typed, then commands with their shortcuts, and a key legend at the foot.
 *
 * Pages are searched on the server as the author types, debounced, with
 * the previous request aborted so a slow answer never overwrites a newer one.
 */
export function CommandPalette({
  open,
  onOpenChange,
  onShowShortcuts,
  onOpenTrash,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onShowShortcuts: () => void;
  onOpenTrash: () => void;
}) {
  const returnFocus = useReturnFocus();
  // The dialogs a command opens outlive the palette, which closes first.
  const [dialog, setDialog] = useState<PaletteDialog | null>(null);
  return (
    <>
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        onCloseAutoFocus={returnFocus.onCloseAutoFocus}
        onOpenAutoFocus={(event) => {
          // Note where focus was before moving it into the search field
          // (an `autoFocus` attribute would move it first, during mount).
          returnFocus.onOpenAutoFocus();
          event.preventDefault();
          (event.currentTarget as HTMLElement | null)
            ?.querySelector<HTMLInputElement>('input[role="combobox"]')
            ?.focus();
        }}
        showCloseButton={false}
        // Anchored near the top rather than centred, so the field does not
        // jump as results arrive and the list grows downward.
        className="mt-[calc(12vh-1rem)] max-w-[640px] self-start overflow-hidden p-0"
      >
        <DialogTitle className="sr-only">Search</DialogTitle>
        <DialogDescription className="sr-only">
          Search your pages and the headings on this one, or run a command.
        </DialogDescription>
        {/* Mounted per opening (Radix unmounts closed content), so every
            opening starts from an empty query. */}
        <PaletteBody
          close={() => onOpenChange(false)}
          handOffFocus={returnFocus.handOff}
          onShowShortcuts={onShowShortcuts}
          onOpenTrash={onOpenTrash}
          onOpenDialog={setDialog}
        />
      </DialogContent>
    </Dialog>
    {dialog === 'new-collection' && <NewCollection onClose={() => setDialog(null)} />}
    {dialog === 'move-page' && <MoveOpenPage onClose={() => setDialog(null)} />}
    {dialog === 'new-workspace' && <CreateWorkspaceDialog open onOpenChange={(next) => !next && setDialog(null)} />}
    {dialog === 'invite' && <InviteShown onClose={() => setDialog(null)} />}
    </>
  );
}

/** "Invite people…" from the palette, into the workspace being shown. */
function InviteShown({ onClose }: { onClose: () => void }) {
  const { workspace } = useWorkspace();
  return <InviteDialog workspaceId={workspace.id} workspaceName={workspace.name} onClose={onClose} />;
}

/** "New collection" from the palette: a top-level collection, shown in the tree once made. */
function NewCollection({ onClose }: { onClose: () => void }) {
  const workspaceId = useWorkspaceId();
  const { create } = useCollectionMutations(workspaceId);
  return (
    <CollectionEditorDialog
      open
      mode="create"
      onOpenChange={(next) => !next && onClose()}
      onSave={async (values) => {
        const created = await create({ ...values, parentId: null });
        noteOwnTreeChange(workspaceId, created.tree_version);
        revealInTree({ kind: 'collection', id: created.id, focus: false });
      }}
    />
  );
}

/** "Move page to…" from the palette: the open page, through the one picker. */
function MoveOpenPage({ onClose }: { onClose: () => void }) {
  const workspaceId = useWorkspaceId();
  const documentId = useDocumentId();
  const { doc } = useEditorDoc();
  const move = useMoveTo();
  const queryClient = useQueryClient();
  const placement = queryClient.getQueryData<{ collectionId: number | null; placementEtag: string }>(
    pagePlacementQuery(workspaceId, documentId ?? '').queryKey,
  );
  if (!documentId || !placement) return null;
  const name = displayTitle(doc.name);
  return (
    <MoveToDialog
      open
      subject={{ kind: 'page', name, collectionId: placement.collectionId }}
      onOpenChange={(next) => !next && onClose()}
      onChoose={async (destination: MoveDestination) => {
        await move.movePage(
          { id: documentId, name: doc.name ?? '', collectionId: placement.collectionId, placementEtag: placement.placementEtag },
          destination.kind === 'collection' ? { id: destination.collectionId, name: destination.name } : { id: null, name: null },
        );
      }}
    />
  );
}

function PaletteBody({
  close,
  handOffFocus,
  onShowShortcuts,
  onOpenTrash,
  onOpenDialog,
}: {
  close: () => void;
  handOffFocus: () => void;
  onShowShortcuts: () => void;
  onOpenTrash: () => void;
  onOpenDialog: (dialog: PaletteDialog) => void;
}) {
  const { blocks } = useEditorDoc();
  const documentId = useDocumentId();
  const { switchTo } = useDocumentActions();
  const { markRecentlyChanged } = useEditorActions();
  const { setTool, toggle, setAssistantOpen } = usePanels();
  const { setView } = useView();
  const { resolved, setPreference } = useTheme();
  const { isSourceEnabled } = useAgentTools();
  const { newPage } = useNewPage();
  const toggleSidebar = useSidebarToggle().toggle;
  // Touch screens have no keys to hint at, and less room for the prompt.
  const compact = useMediaQuery('(max-width: 639px), (pointer: coarse)');
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const listId = useId();
  const listRef = useRef<HTMLDivElement | null>(null);
  const searchingText = query.trim() !== '';

  // The server searches every page of the workspace; typing waits for a pause before asking.
  const workspaceId = useWorkspaceId();
  const { workspace, workspaces, multiWorkspace, switchWorkspace } = useWorkspace();
  // A viewer is offered nothing that writes (D6).
  const { canEdit, isAdmin } = useWorkspaceAccess();
  const shared = workspace.kind === 'shared';
  const [searchTerm, setSearchTerm] = useState('');
  useEffect(() => {
    const timer = window.setTimeout(() => setSearchTerm(query.trim()), SEARCH_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [query]);
  const pageSearch = useQuery({
    ...documentListQuery(workspaceId, { limit: SEARCH_LIMIT, query: searchTerm || undefined, sortBy: 'updated_at', sortOrder: 'desc' }),
    // The last answer stays while the next one is on its way.
    placeholderData: keepPreviousData,
  });
  const searching = pageSearch.isFetching;
  const documents = (!pageSearch.isError && pageSearch.data?.documents) || NO_DOCUMENTS;
  // Each result's path, so two pages of one name can be told apart (C-18).
  const paths = useCollectionPaths(workspaceId, documents.map((doc) => doc.collectionId));

  const items = useMemo<Item[]>(() => {
    const writing: Item[] = [
      {
        id: 'new-doc',
        group: 'Commands',
        label: 'New page',
        shortcut: 'new-page',
        icon: SquarePen,
        keywords: 'create blank document',
        run: () => void newPage(),
      },
      {
        id: 'new-collection',
        group: 'Commands',
        label: 'New collection',
        icon: FolderPlus,
        keywords: 'create folder group',
        opensDialog: true,
        run: () => onOpenDialog('new-collection'),
      },
      ...(documentId
        ? [{
            id: 'move-page',
            group: 'Commands' as const,
            label: 'Move page to…',
            icon: FolderInput,
            keywords: 'move collection folder file',
            opensDialog: true,
            run: () => onOpenDialog('move-page'),
          }]
        : []),
    ];
    const commands: Item[] = [
      ...(canEdit ? writing : []),
      {
        id: 'library',
        group: 'Commands',
        label: 'Library',
        shortcut: 'library',
        icon: BookOpen,
        keywords: 'pdfs papers upload',
        run: () => {
          setView('editor');
          setTool('library');
        },
      },
      {
        id: 'trash',
        group: 'Commands',
        label: 'Trash',
        icon: Trash2,
        keywords: 'deleted restore bin recycle',
        opensDialog: true,
        run: () => onOpenTrash(),
      },
      {
        id: 'assistant',
        group: 'Commands',
        label: 'Ask AI',
        shortcut: 'toggle-assistant',
        icon: Sparkles,
        keywords: 'assistant agent chat help',
        run: () => setAssistantOpen(true),
      },
      {
        id: 'sidebar',
        group: 'Commands',
        label: 'Toggle sidebar',
        shortcut: 'toggle-sidebar',
        icon: PanelLeft,
        keywords: 'navigation pages documents',
        run: toggleSidebar,
      },
      {
        id: 'right-sidebar',
        group: 'Commands',
        label: 'Toggle right sidebar',
        shortcut: 'toggle-tools',
        icon: PanelRight,
        keywords: 'tools panel',
        run: () => toggle(),
      },
      {
        id: 'theme',
        group: 'Commands',
        label: resolved === 'dark' ? 'Switch to light mode' : 'Switch to dark mode',
        icon: resolved === 'dark' ? Sun : Moon,
        keywords: 'appearance theme dark light',
        run: () => setPreference(resolved === 'dark' ? 'light' : 'dark'),
      },
      {
        id: 'shortcuts',
        group: 'Commands',
        label: 'Keyboard shortcuts',
        shortcut: 'help',
        icon: Keyboard,
        keywords: 'keys help hotkeys',
        opensDialog: true,
        run: () => onShowShortcuts(),
      },
      {
        id: 'settings',
        group: 'Commands',
        label: 'Settings',
        icon: Settings,
        keywords: 'profile account preferences agent tools usage',
        opensDialog: true,
        run: () => setView('settings'),
      },
      {
        id: 'workspace-settings',
        group: 'Commands',
        label: 'Workspace settings',
        icon: Settings,
        keywords: 'workspace name icon policy export delete restore',
        opensDialog: true,
        run: () => {
          requestSettingsPane('workspace');
          setView('settings');
        },
      },
      ...(shared
        ? [{
            id: 'members',
            group: 'Commands' as const,
            label: 'Members',
            icon: Users,
            keywords: 'people share roles invite remove leave owner transfer',
            opensDialog: true,
            run: () => {
              requestSettingsPane('members');
              setView('settings');
            },
          }]
        : []),
      ...(shared && isAdmin
        ? [{
            id: 'invite',
            group: 'Commands' as const,
            label: 'Invite people…',
            icon: UserPlus,
            keywords: 'share invite link member add person',
            opensDialog: true,
            run: () => onOpenDialog('invite'),
          }]
        : []),
      ...(multiWorkspace
        ? [{
            id: 'new-workspace',
            group: 'Commands' as const,
            label: 'New workspace…',
            icon: Plus,
            keywords: 'create workspace',
            opensDialog: true,
            run: () => onOpenDialog('new-workspace'),
          }]
        : []),
    ];
    // The account's other workspaces, most recently opened first. Picking one
    // switches there, saving the open page first.
    const switching: Item[] = workspaces
      .filter((item) => item.id !== workspaceId)
      .map((item) => ({
        id: `workspace-${item.id}`,
        group: 'Switch workspace',
        label: item.name,
        hint: workspaceBadge(item) ?? (item.kind === 'personal' ? 'Personal' : undefined),
        icon: Layers,
        keywords: 'switch workspace',
        run: () => void switchWorkspace(item.id),
      }));
    // Sources the account has switched off are not offered at all. The
    // Library is a command of its own, so it is not listed twice.
    const panels: Item[] = toolsForEnabledSources(isSourceEnabled)
      .filter((tool) => tool.id !== 'library')
      .map((tool) => ({
        id: `tool-${tool.id}`,
        group: 'Panels',
        label: tool.label,
        hint: tool.description,
        icon: tool.icon,
        run: () => {
          setView('editor');
          setTool(tool.id);
        },
      }));
    // Headings only answer a query; before one is typed they would bury the
    // recent pages under the outline of the page already on screen.
    const headings: Item[] = !searchingText
      ? []
      : blocks.flatMap((block) => {
          if (block.type !== 'heading') return [];
          const text = htmlToText(block.html).trim();
          return [
            {
              id: `heading-${block.id}`,
              group: 'On this page' as const,
              label: text || 'Untitled heading',
              hint: `H${block.level}`,
              icon: Hash,
              run: () => {
                setView('editor');
                requestAnimationFrame(() => {
                  document
                    .querySelector(`[data-block-id="${CSS.escape(block.id)}"]`)
                    ?.scrollIntoView({ block: 'start', behavior: scrollBehavior() });
                  markRecentlyChanged([block.id]);
                });
              },
            },
          ];
        });
    // "Recent" skips the page already open; a search keeps it, or typing
    // its own title would answer that the page does not exist.
    const docs: Item[] = documents
      .filter((doc) => searchingText || doc.id !== documentId)
      .slice(0, searchingText ? SEARCH_LIMIT : RECENT_LIMIT)
      .map((doc) => ({
        id: `doc-${doc.id}`,
        group: searchingText ? ('Pages' as const) : ('Recent' as const),
        label: displayTitle(doc.name),
        muted: isUntitledName(doc.name),
        hint: [
          doc.collectionId === null ? null : pathLabel(paths.get(doc.collectionId) ?? []),
          doc.id === documentId ? 'Current page' : relativeTime(doc.updatedAt),
        ].filter(Boolean).join(' · ') || undefined,
        icon: FileText,
        // The server already matched these against the query.
        keywords: query,
        run: () => {
          setView('editor');
          // The editor shows the one load-failure notice and keeps the open
          // page; the rejection needs no second report here.
          switchTo(doc.id, { source: 'selection' }).catch(() => undefined);
        },
      }));
    const all = [...docs, ...headings, ...switching, ...commands, ...(searchingText ? panels : [])];
    // Keep the flat list in display order so arrow keys walk it top to bottom.
    return GROUP_ORDER.flatMap((group) =>
      all.filter((item) => item.group === group && matches(item, query)),
    );
  }, [
    blocks,
    documents,
    documentId,
    newPage,
    onOpenDialog,
    onOpenTrash,
    paths,
    isSourceEnabled,
    markRecentlyChanged,
    onShowShortcuts,
    query,
    resolved,
    searchingText,
    setAssistantOpen,
    setPreference,
    setTool,
    setView,
    toggleSidebar,
    switchTo,
    switchWorkspace,
    toggle,
    workspaceId,
    workspaces,
    multiWorkspace,
    canEdit,
    isAdmin,
    shared,
  ]);

  useEffect(() => {
    listRef.current?.querySelector('[data-active="true"]')?.scrollIntoView({ block: 'nearest' });
  }, [active]);

  const runItem = (item: Item | undefined) => {
    if (!item) return;
    if (item.opensDialog) handOffFocus();
    close();
    item.run();
  };

  return (
    <>
      <div className="flex h-12 items-center gap-2.5 border-b border-border px-4">
        <Search aria-hidden="true" className="size-[18px] shrink-0 text-muted-foreground" />
        <input
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setActive(0);
          }}
          onKeyDown={(event) => {
            if (event.key === 'ArrowDown') {
              event.preventDefault();
              setActive((index) => (items.length ? (index + 1) % items.length : 0));
            } else if (event.key === 'ArrowUp') {
              event.preventDefault();
              setActive((index) => (items.length ? (index - 1 + items.length) % items.length : 0));
            } else if (event.key === 'Enter') {
              event.preventDefault();
              runItem(items[active]);
            }
          }}
          role="combobox"
          aria-expanded="true"
          aria-controls={listId}
          aria-activedescendant={items[active] ? `${listId}-${items[active].id}` : undefined}
          aria-label="Search pages or run a command"
          placeholder={compact ? 'Search…' : 'Search pages or run a command…'}
          className="min-w-0 flex-1 truncate bg-transparent text-md text-foreground outline-none placeholder:text-placeholder"
        />
        {searching && <Spinner />}
      </div>
      <div ref={listRef} id={listId} role="listbox" className="max-h-[min(60vh,480px)] overflow-y-auto p-1.5">
        {GROUP_ORDER.map((group) => {
          const inGroup = items.filter((item) => item.group === group);
          if (inGroup.length === 0) return null;
          return (
            <div key={group} role="group" aria-label={group} className="pb-1">
              <div className="px-2 pb-1 pt-2 text-xs font-medium text-muted-foreground">{group}</div>
              {inGroup.map((item) => {
                const index = items.indexOf(item);
                const isActive = index === active;
                const keys = item.shortcut ? shortcutKeys(item.shortcut) : [];
                return (
                  <div
                    key={item.id}
                    id={`${listId}-${item.id}`}
                    role="option"
                    aria-selected={isActive}
                    data-active={isActive}
                    className={cn(
                      'flex min-h-9 cursor-pointer items-center gap-2.5 rounded-md px-2 text-sm',
                      isActive && 'bg-hover',
                    )}
                    onMouseMove={() => {
                      if (!isActive) setActive(index);
                    }}
                    onClick={() => runItem(item)}
                  >
                    <item.icon aria-hidden="true" className="size-[18px] shrink-0 text-muted-foreground" />
                    <span className={cn('min-w-0 flex-1 truncate', item.muted && 'text-muted-foreground')}>
                      {item.label}
                    </span>
                    {item.hint && (
                      <span className="max-w-[45%] shrink-0 truncate text-xs text-muted-foreground">
                        {item.hint}
                      </span>
                    )}
                    {keys.length > 0 && !compact && (
                      <span aria-hidden="true" className="flex shrink-0 gap-0.5">
                        {keys.map((key) => (
                          <Kbd key={key}>{key}</Kbd>
                        ))}
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
          );
        })}
        {items.length === 0 && !searching && (
          <p className="px-3 py-8 text-center text-sm text-muted-foreground">No results for “{query}”</p>
        )}
      </div>
      <div
        aria-hidden="true"
        className="flex items-center gap-4 border-t border-border px-4 py-2 text-xs text-muted-foreground max-sm:hidden"
      >
        <span className="flex items-center gap-1">
          <Kbd>↑</Kbd>
          <Kbd>↓</Kbd>
          Select
        </span>
        <span className="flex items-center gap-1">
          <Kbd>↵</Kbd>
          Open
        </span>
        <span className="flex items-center gap-1">
          <Kbd>esc</Kbd>
          Close
        </span>
      </div>
    </>
  );
}
