import { useEffect, useId, useMemo, useRef, useState, type ElementType } from 'react';
import {
  FileText,
  Hash,
  Keyboard,
  Moon,
  PanelLeft,
  PanelRight,
  Search,
  Settings,
  Sparkles,
  SquarePen,
  Sun,
} from 'lucide-react';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { Kbd } from '@/components/ui/kbd';
import { Spinner } from '@/components/ui/spinner';
import { cn } from '@/lib/utils';
import { useTheme } from '@/lib/theme';
import { htmlToText, useEditorActions, useEditorState } from '@/editor';
import { usePanels } from '@/components/panels/panelsContextState';
import { toolsForEnabledSources } from '@/components/panels/toolsConfig';
import { useAgentTools } from '@/components/preferences';
import { SHORTCUTS, modifierLabel, type ShortcutId } from '../Shortcuts/shortcuts';
import { useView } from '../viewContextState';
import { useNewDocument } from '../useNewDocument';
import { useSidebarToggle } from '../useShellLayout';
import { relativeTime } from '../relativeTime';
import { displayTitle, isUntitledName } from '../displayTitle';
import { rememberDocumentSummaries } from '../documentSummaryCache';
import { useReturnFocus } from '@/hooks/useReturnFocus';
import { useMediaQuery } from '@/hooks/useMediaQuery';
import { scrollBehavior } from '@/lib/motion';
import type { DocumentSummary } from '@/services';

type Group = 'Recent' | 'In this document' | 'Documents' | 'Commands' | 'Sidebar';

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

/** Recent documents shown before anything is typed. */
const RECENT_LIMIT = 5;
const SEARCH_LIMIT = 8;

const GROUP_ORDER: readonly Group[] = ['Recent', 'In this document', 'Documents', 'Commands', 'Sidebar'];

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
 * field near the top of the window, recent documents before anything is
 * typed, then commands with their shortcuts, and a key legend at the foot.
 *
 * Documents are searched on the server as the author types, debounced, with
 * the previous request aborted so a slow answer never overwrites a newer one.
 */
export function CommandPalette({
  open,
  onOpenChange,
  onShowShortcuts,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onShowShortcuts: () => void;
}) {
  const returnFocus = useReturnFocus();
  return (
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
          Search your documents and headings in this one, or run a command.
        </DialogDescription>
        {/* Mounted per opening (Radix unmounts closed content), so every
            opening starts from an empty query. */}
        <PaletteBody
          close={() => onOpenChange(false)}
          handOffFocus={returnFocus.handOff}
          onShowShortcuts={onShowShortcuts}
        />
      </DialogContent>
    </Dialog>
  );
}

function PaletteBody({
  close,
  handOffFocus,
  onShowShortcuts,
}: {
  close: () => void;
  handOffFocus: () => void;
  onShowShortcuts: () => void;
}) {
  const { blocks, documentId } = useEditorState();
  const { listRemote, switchTo, markRecentlyChanged } = useEditorActions();
  const { setTool, toggle, setAssistantOpen } = usePanels();
  const { setView } = useView();
  const { resolved, setPreference } = useTheme();
  const { isSourceEnabled } = useAgentTools();
  const { createDocument } = useNewDocument();
  const toggleSidebar = useSidebarToggle().toggle;
  // Touch screens have no keys to hint at, and less room for the prompt.
  const compact = useMediaQuery('(max-width: 639px), (pointer: coarse)');
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const [documents, setDocuments] = useState<DocumentSummary[]>([]);
  const [searching, setSearching] = useState(false);
  const listId = useId();
  const listRef = useRef<HTMLDivElement | null>(null);
  const searchingText = query.trim() !== '';

  useEffect(() => {
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      setSearching(true);
      try {
        const result = await listRemote(
          { limit: SEARCH_LIMIT, query: query.trim() || undefined, sortBy: 'updated_at', sortOrder: 'desc' },
          { signal: controller.signal },
        );
        if (!controller.signal.aborted) {
          setDocuments(result.documents);
          rememberDocumentSummaries(result.documents);
        }
      } catch {
        if (!controller.signal.aborted) setDocuments([]);
      } finally {
        if (!controller.signal.aborted) setSearching(false);
      }
    }, 180);
    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [query, listRemote]);

  const items = useMemo<Item[]>(() => {
    const commands: Item[] = [
      {
        id: 'new-doc',
        group: 'Commands',
        label: 'New page',
        icon: SquarePen,
        keywords: 'create blank document',
        run: () => void createDocument(),
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
        keywords: 'navigation documents',
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
        run: () => setView('profile'),
      },
    ];
    // Sources the account has switched off are not offered at all.
    const panels: Item[] = toolsForEnabledSources(isSourceEnabled).map((tool) => ({
      id: `tool-${tool.id}`,
      group: 'Sidebar',
      label: tool.label,
      hint: tool.description,
      icon: tool.icon,
      run: () => {
        setView('workspace');
        setTool(tool.id);
      },
    }));
    // Headings only answer a query; before one is typed they would bury the
    // recent documents under the outline of the page already on screen.
    const headings: Item[] = !searchingText
      ? []
      : blocks.flatMap((block) => {
          if (block.type !== 'heading') return [];
          const text = htmlToText(block.html).trim();
          return [
            {
              id: `heading-${block.id}`,
              group: 'In this document' as const,
              label: text || 'Untitled heading',
              hint: `H${block.level}`,
              icon: Hash,
              run: () => {
                setView('workspace');
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
        group: searchingText ? ('Documents' as const) : ('Recent' as const),
        label: displayTitle(doc.name),
        muted: isUntitledName(doc.name),
        hint: doc.id === documentId ? 'Current page' : relativeTime(doc.updatedAt) || undefined,
        icon: FileText,
        // The server already matched these against the query.
        keywords: query,
        run: () => {
          setView('workspace');
          void switchTo(doc.id, { source: 'selection' });
        },
      }));
    const all = [...docs, ...headings, ...commands, ...(searchingText ? panels : [])];
    // Keep the flat list in display order so arrow keys walk it top to bottom.
    return GROUP_ORDER.flatMap((group) =>
      all.filter((item) => item.group === group && matches(item, query)),
    );
  }, [
    blocks,
    documents,
    documentId,
    createDocument,
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
    toggle,
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
          aria-label="Search documents or run a command"
          placeholder={compact ? 'Search…' : 'Search documents or run a command…'}
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
