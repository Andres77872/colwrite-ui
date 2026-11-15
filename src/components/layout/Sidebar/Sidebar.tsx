import { useQuery } from '@tanstack/react-query';
import { cn } from '@/lib/utils';
import { Kbd } from '@/components/ui/kbd';
import { Spinner } from '@/components/ui/spinner';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { PagesTree } from './PagesTree/PagesTree';
import { Recent } from './PagesTree/Recent';
import { usePanels } from '@/components/panels/panelsContextState';
import { bindingKeys, keycapLabel, modifierLabel } from '../Shortcuts/shortcuts';
import { useView } from '../viewContextState';
import { useNewPage } from '@/actions/useNewPage';
import { JobProgress } from '@/components/collections/JobProgress';
import { useWorkspaceId } from '@/components/workspace/workspaceContextState';
import { WorkspaceSwitcher } from '@/components/workspace/WorkspaceSwitcher';
import { workspaceQuery } from '@/data/workspaces';
import { useLeftSidebarAutoHidden, useSidebarDocked, useSidebarToggle } from '../useShellLayout';
import { sidebarHoverAction, sidebarRow } from './sidebarStyles';
import {
  BookOpen,
  ChevronsLeft,
  ChevronsRight,
  Search,
  Settings,
  Sparkles,
  SquarePen,
  Trash2,
  X,
} from 'lucide-react';

/**
 * Sidebar: who you are, how to get around, your pages.
 *
 * Top to bottom, as in Notion: the workspace switcher (which also holds the
 * account's menu), quick actions, Recent, the Pages tree,
 * and quiet links to the Library, the Trash and Settings. Page-level actions are not
 * here; they live on the page's own topbar. "New page" creates the page in
 * the open page's collection.
 */
export function Sidebar({
  onOpenPalette,
  onShowShortcuts,
  onOpenTrash,
}: {
  onOpenPalette: () => void;
  onShowShortcuts: () => void;
  onOpenTrash: () => void;
}) {
  const { toggleLeftCollapsed, leftCollapsed, setMobileNavOpen, setTool, setAssistantOpen } = usePanels();
  const { setView } = useView();
  const docked = useSidebarDocked();
  // Collapsed, or stepping aside for the right sidebar: this copy is the
  // edge peek, and its chevron pins the sidebar open again.
  const autoHidden = useLeftSidebarAutoHidden();
  const hiddenNow = leftCollapsed || autoHidden;
  const sidebarToggle = useSidebarToggle();
  const newPage = useNewPage();
  const modifier = modifierLabel();
  const workspaceId = useWorkspaceId();
  // The badge: how many things are in the Trash (its roots), from the workspace read.
  const trashCount = useQuery(workspaceQuery(workspaceId)).data?.counts.trash ?? 0;

  // Anything that moves the author somewhere else also closes the drawer.
  const closeDrawer = () => {
    if (!docked) setMobileNavOpen(false);
  };
  const run = (action: () => void) => () => {
    closeDrawer();
    action();
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="group/header flex h-11 shrink-0 items-center gap-1 px-2">
        <WorkspaceSwitcher onShowShortcuts={run(onShowShortcuts)} />
        {/* Collapsed to no width until wanted, so the workspace name gets
            the whole row at the default 240px. Still in the tab order: focus
            opens it like hover does. */}
        <div className="flex w-0 items-center gap-0.5 overflow-hidden opacity-0 transition-opacity focus-within:w-auto focus-within:overflow-visible focus-within:opacity-100 group-hover/header:w-auto group-hover/header:overflow-visible group-hover/header:opacity-100 pointer-coarse:w-auto pointer-coarse:overflow-visible pointer-coarse:opacity-100">
          {docked ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  className={cn(sidebarHoverAction, 'size-7')}
                  onClick={hiddenNow ? sidebarToggle.toggle : toggleLeftCollapsed}
                  aria-label={hiddenNow ? 'Keep sidebar open' : 'Close sidebar'}
                >
                  {hiddenNow ? <ChevronsRight aria-hidden="true" /> : <ChevronsLeft aria-hidden="true" />}
                </button>
              </TooltipTrigger>
              <TooltipContent side="bottom">
                {hiddenNow ? 'Keep sidebar open' : 'Close sidebar'}
                <span className="ml-2 text-tooltip-foreground/60">{modifier}+\</span>
              </TooltipContent>
            </Tooltip>
          ) : (
            <button
              type="button"
              className={cn(sidebarHoverAction, 'size-7')}
              onClick={() => setMobileNavOpen(false)}
              aria-label="Close sidebar"
            >
              <X aria-hidden="true" />
            </button>
          )}
        </div>
      </div>

      <div className="flex shrink-0 flex-col gap-px px-2 pb-2">
        <button type="button" className={cn(sidebarRow, 'group/row')} onClick={run(onOpenPalette)}>
          <Search aria-hidden="true" />
          <span className="flex-1 truncate">Search</span>
          <span
            aria-hidden="true"
            className="flex gap-0.5 opacity-0 transition-opacity group-hover/row:opacity-100 pointer-coarse:hidden"
          >
            <Kbd>{modifier}</Kbd>
            <Kbd>K</Kbd>
          </span>
        </button>
        <button
          type="button"
          className={cn(sidebarRow, '[&>svg]:text-ai')}
          onClick={run(() => setAssistantOpen(true))}
        >
          <Sparkles aria-hidden="true" />
          <span className="flex-1 truncate">Ask AI</span>
        </button>
        {newPage.allowed && (
        <button
          type="button"
          className={cn(sidebarRow, 'group/row')}
          onClick={run(() => void newPage.newPage())}
          disabled={newPage.disabled}
        >
          {newPage.creating ? <Spinner className="size-[18px]" /> : <SquarePen aria-hidden="true" />}
          <span className="flex-1 truncate">New page</span>
          <span
            aria-hidden="true"
            className="flex gap-0.5 opacity-0 transition-opacity group-hover/row:opacity-100 pointer-coarse:hidden"
          >
            {bindingKeys('new-page').map((part) => (
              <Kbd key={part}>{keycapLabel(part, modifier)}</Kbd>
            ))}
          </span>
        </button>
        )}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
        <Recent onPageOpened={closeDrawer} />
        <PagesTree onPageOpened={closeDrawer} />
      </div>

      {/* Settings lives here; the workspace menu offers only "Workspace
          settings", which opens Settings on the Workspace pane (14 §3.5). */}
      <div className="flex shrink-0 flex-col gap-px border-t border-border px-2 py-2">
        {/* Trash work the server is still finishing, with how far it is. */}
        <JobProgress workspaceId={workspaceId} className="space-y-1" />
        <button type="button" className={sidebarRow} onClick={run(() => setTool('library'))}>
          <BookOpen aria-hidden="true" />
          <span className="flex-1 truncate">Library</span>
        </button>
        <button
          type="button"
          className={sidebarRow}
          aria-label={trashCount > 0 ? `Trash, ${trashCount === 1 ? '1 item' : `${trashCount.toLocaleString()} items`}` : undefined}
          onClick={run(onOpenTrash)}
        >
          <Trash2 aria-hidden="true" />
          <span className="flex-1 truncate">Trash</span>
          {trashCount > 0 && (
            <span aria-hidden="true" className="shrink-0 rounded-sm bg-subtle px-1.5 text-2xs tabular-nums text-muted-foreground">
              {trashCount.toLocaleString()}
            </span>
          )}
        </button>
        <button type="button" className={sidebarRow} onClick={run(() => setView('settings'))}>
          <Settings aria-hidden="true" />
          <span className="flex-1 truncate">Settings</span>
        </button>
      </div>
    </div>
  );
}
