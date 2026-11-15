import { useState, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { cn } from '@/lib/utils';
import { scrollBehavior } from '@/lib/motion';
import { lastInputWasPointer } from '@/lib/inputModality';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { useDocumentActions, useDocumentId, useDocumentStatus, useDocumentTitle, usePageReadOnly } from '@/editor';
import { usePanels } from '@/components/panels/panelsContextState';
import { modifierLabel } from '@/components/layout/Shortcuts';
import { useSidebarToggle } from '@/components/layout/useShellLayout';
import { UNTITLED_LABEL } from '@/components/layout/displayTitle';
import { CollectionBreadcrumbs } from '@/components/panels/Library/CollectionBreadcrumbs';
import { revealInTree } from '@/components/layout/Sidebar/PagesTree/treeReveal';
import { useWorkspaceId } from '@/components/workspace/workspaceContextState';
import { pagePlacementQuery } from '@/data/documents';
import { collectionDetailQuery } from '@/data/resources';
import { workspaceQuery } from '@/data/workspaces';
import { ReviewPill } from '../Review/ReviewPill';
import { PageMenu } from './PageMenu';
import { PAGE_TOOLS } from './pageTools';
import { SaveRecoveryBar } from './SaveRecoveryBar';
import { TrashedPageBar } from './TrashedPageBar';
import { ViewOnlyBadge, ViewOnlyBar } from './ViewOnlyBar';
import {
  ChevronsRight,
  CloudCheck,
  CloudOff,
  CloudUpload,
  FileText,
  HardDrive,
  Library,
  Menu,
  Sparkles,
  Trash2,
} from 'lucide-react';

/**
 * PageTopbar — the page's one 44px bar, on the page's own background.
 *
 * Left: the way back to a hidden sidebar, the breadcrumb (which moves the
 * caret into the in-page title) and the save state. Right: pending AI
 * suggestions, Ask AI, the Research / Sources / History tabs of the right
 * sidebar, and the page's "…" menu.
 *
 * It replaced both the global header row and the document toolbar, which
 * together spent 112px on brand, account and six buttons before any text.
 */
export function PageTopbar() {
  const toggle = useSidebarToggle();
  const { title, isUntitled, focusPageTitle } = useDocumentTitle();
  const { activeTool, isOpen, toolsDocked, setTool, close, assistantOpen, toggleAssistant } = usePanels();
  // Docked, the right sidebar's own tab strip is the control for its tabs;
  // repeating them here only squeezed the breadcrumb.
  const showToolButtons = !(isOpen && toolsDocked);
  const modifier = modifierLabel();
  const readOnly = usePageReadOnly();

  const focusTitle = () => {
    if (focusPageTitle()) return;
    // No title mounted (the first-run page): at least bring the top into view.
    document.querySelector('.canvas')?.scrollTo({ top: 0, behavior: scrollBehavior() });
  };

  return (
    <>
    {/* A size container, so Ask AI can drop its label when the page column
        gets narrow and the title keeps the room. */}
    <div className="@container/topbar flex h-11 shrink-0 items-center gap-1 bg-background px-3">
      {toggle.visible && (
        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="icon" size="icon-sm" onClick={toggle.open} aria-label="Open sidebar">
              {toggle.docked ? <ChevronsRight aria-hidden="true" /> : <Menu aria-hidden="true" />}
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom">
            Open sidebar
            {toggle.docked && <span className="ml-2 text-tooltip-foreground/60">{modifier}+\</span>}
          </TooltipContent>
        </Tooltip>
      )}

      <PageBreadcrumb
        current={
          <button
            type="button"
            onClick={focusTitle}
            aria-current="page"
            className="flex h-6 min-w-0 items-center gap-1.5 rounded-md px-1.5 text-sm text-foreground transition-colors hover:bg-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <FileText aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
            <span className={cn('max-w-[40ch] truncate', isUntitled && 'text-muted-foreground')}>
              {isUntitled ? UNTITLED_LABEL : title}
            </span>
          </button>
        }
      />

      {readOnly ? <ViewOnlyBadge /> : <SaveStatus />}

      <div className="ml-auto flex shrink-0 items-center gap-0.5">
        {/* Pending AI suggestions: the count, and the batch review menu. */}
        <ReviewPill />
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ai"
              size="sm"
              onClick={toggleAssistant}
              aria-pressed={assistantOpen}
              className={cn('max-sm:w-7 max-sm:px-0 @max-[560px]/topbar:w-7 @max-[560px]/topbar:px-0', assistantOpen && 'bg-ai/10')}
            >
              <Sparkles aria-hidden="true" />
              <span className="max-sm:sr-only @max-[560px]/topbar:sr-only">Ask AI</span>
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom">
            Ask AI about this page
            <span className="ml-2 text-tooltip-foreground/60">{modifier}+Shift+J</span>
          </TooltipContent>
        </Tooltip>
        {showToolButtons && PAGE_TOOLS.map(({ id, label, icon: Icon }) => {
          const active = isOpen && activeTool === id;
          return (
            <Tooltip key={id}>
              <TooltipTrigger asChild>
                <Button
                  variant="icon"
                  size="icon-sm"
                  // The same button closes what it opened, like Ask AI does.
                  onClick={() => {
                    if (active) {
                      close();
                      return;
                    }
                    setTool(id);
                    // Docked, the sidebar hides these buttons, so the one
                    // just pressed unmounts and focus would fall to <body>.
                    // A keyboard user is taken into the panel instead.
                    if (toolsDocked && !lastInputWasPointer()) focusOpenedTool();
                  }}
                  aria-label={label}
                  aria-pressed={active}
                  className={cn('max-sm:hidden', active && 'bg-active text-foreground')}
                >
                  <Icon aria-hidden="true" />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="bottom">{label}</TooltipContent>
            </Tooltip>
          );
        })}
        <PageMenu />
      </div>
    </div>
    <TrashedPageBar />
    <ViewOnlyBar />
    <SaveRecoveryBar />
    </>
  );
}

/**
 * Workspace › … › Chapter 2 › the page (08 §2.2). Where the page lives comes
 * from the editor's read and from every move, so the path follows a move
 * with no reload; a move made elsewhere arrives with the tree's refresh. A
 * collection crumb shows that collection in the sidebar tree.
 */
function PageBreadcrumb({ current }: { current: ReactNode }) {
  const workspaceId = useWorkspaceId();
  const documentId = useDocumentId();
  const toggle = useSidebarToggle();
  const workspace = useQuery(workspaceQuery(workspaceId));
  const placement = useQuery({ ...pagePlacementQuery(workspaceId, documentId ?? ''), enabled: documentId !== null });
  const homeId = documentId ? (placement.data?.collectionId ?? null) : null;
  const home = useQuery({ ...collectionDetailQuery(workspaceId, homeId ?? 0), enabled: homeId !== null });
  const path = homeId !== null ? (home.data?.path ?? []) : [];

  const reveal = (collectionId: number) => {
    if (toggle.visible) toggle.open();
    revealInTree({ kind: 'collection', id: collectionId, expand: true, focus: true });
  };

  return (
    <CollectionBreadcrumbs
      label="Breadcrumb"
      className="flex items-center pb-0"
      path={path}
      root={
        <>
          <Library aria-hidden="true" className="size-3.5 shrink-0" />
          <span className="max-w-32 truncate">{workspace.data?.name ?? 'Workspace'}</span>
        </>
      }
      current={current}
      onSelectCollection={reveal}
    />
  );
}

/** Text fields a panel opens on: the Research search, the Sources filter. */
const PANEL_FIELD = 'input:not([type=hidden]):not([disabled]), textarea:not([disabled])';

/**
 * Moves focus into the right sidebar's active tab once it has mounted: its
 * first text field, or else the tab itself (History). Tries for a few frames,
 * because a panel may render its field a moment after the sidebar appears.
 */
function focusOpenedTool(attempt = 0) {
  requestAnimationFrame(() => {
    const aside = document.querySelector<HTMLElement>('aside[aria-label="Tools"]');
    const active = document.activeElement;
    // Something already took focus on purpose (the panel itself, or the
    // user moved on): leave it.
    if (active && active !== document.body && active.isConnected) return;
    const panel = aside?.querySelector<HTMLElement>('[role="tabpanel"][data-state="active"]');
    const field = panel?.querySelector<HTMLElement>(PANEL_FIELD);
    if (!field && attempt < 6) {
      focusOpenedTool(attempt + 1);
      return;
    }
    const target = field ?? aside?.querySelector<HTMLElement>('[role="tab"][data-state="active"]');
    target?.focus({ preventScroll: true });
  });
}

/**
 * The save readout: "Saving…", "Saved", "Unsaved" — or a loud "Not saved",
 * because a document that has silently stopped saving must never look like
 * one that is fine.
 *
 * It is on every screen size. Phones used to show nothing at all until a save
 * failed, so there was no way to tell a saved page from one about to be lost;
 * they now get the same states as an icon.
 *
 * Only a failure and the recovery from it are announced. The readout was a
 * live region, which read "Unsaved", "Saving…", "Saved" to a screen reader
 * every few seconds of writing. A failure is not a toast either: a toast
 * leaves, and this has to stay until it is fixed.
 */
function SaveStatus() {
  const documentId = useDocumentId();
  const { lastSavedAt, isAutoSaving, saveError, saveConflict, inTrash } = useDocumentStatus();
  const { hasPendingEdits, save } = useDocumentActions();

  // Follows the failure state per document, to tell "saving works again" from
  // "another document opened".
  const failing = Boolean(saveError);
  const [seen, setSeen] = useState({ documentId, failing, recovered: false });
  if (seen.documentId !== documentId || seen.failing !== failing) {
    setSeen({
      documentId,
      failing,
      recovered: seen.documentId === documentId && seen.failing && !failing,
    });
  }
  const announcement = saveError
    ? `Not saved. ${saveError}`
    : seen.recovered
      ? 'Saving is working again.'
      : '';
  const announcer = (
    <span className="sr-only" role="status" aria-live="polite" aria-atomic="true">
      {announcement}
    </span>
  );

  // Nothing is saved while the page is in the Trash; the bar below says why.
  if (inTrash) {
    return (
      <span className="flex shrink-0 items-center gap-1 px-1.5 text-xs text-destructive" title="Restore the page to save it">
        {announcer}
        <Trash2 aria-hidden="true" className="size-3.5" />
        <span className="max-sm:sr-only">In the Trash</span>
      </span>
    );
  }

  if (saveError) {
    return (
      <span className="flex shrink-0 items-center gap-1 text-xs">
        {announcer}
        <span className="flex items-center gap-1 text-destructive" title={saveError}>
          <CloudOff aria-hidden="true" className="size-3.5" />
          Not saved
        </span>
        {/* A refused save cannot be retried into working; the bar below has the choices. */}
        {!saveConflict && (
          <Button variant="link" size="xs" className="h-6 px-1" onClick={save}>
            Retry
          </Button>
        )}
      </span>
    );
  }

  // `hasPendingEdits` reads the editor's revision refs; the topbar re-renders
  // on every edit and every save, which is exactly when the answer changes.
  const pending = hasPendingEdits();
  const savedAt = lastSavedAt
    ? new Date(lastSavedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    : null;
  const [text, detail, Icon] = isAutoSaving
    ? (['Saving…', null, CloudUpload] as const)
    : !documentId
      ? (['Saved locally', 'Not on the server yet', HardDrive] as const)
      : pending
        ? (['Unsaved', 'Saves automatically in a few seconds', CloudUpload] as const)
        : (['Saved', savedAt ? `Saved at ${savedAt}` : 'In sync with the server', CloudCheck] as const);

  return (
    <span
      className="flex shrink-0 items-center px-1.5 text-xs text-muted-foreground"
      title={detail ?? undefined}
    >
      {announcer}
      <Icon
        aria-hidden="true"
        className={cn('size-4 sm:hidden', (isAutoSaving || pending) && documentId && 'opacity-60')}
      />
      <span className="max-sm:sr-only">{text}</span>
    </span>
  );
}

