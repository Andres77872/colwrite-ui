import { useEffect, useRef } from 'react';
import { cn } from '@/lib/utils';
import { scrollBehavior } from '@/lib/motion';
import { lastInputWasPointer } from '@/lib/inputModality';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { useToast } from '@/components/ui/toastContext';
import { useDocumentTitle, useEditor } from '@/editor';
import { usePanels } from '@/components/panels/panelsContextState';
import { modifierLabel } from '@/components/layout/Shortcuts';
import { useSidebarToggle } from '@/components/layout/useShellLayout';
import { UNTITLED_LABEL } from '@/components/layout/displayTitle';
import { ReviewPill } from '../Review/ReviewPill';
import { PageMenu } from './PageMenu';
import { PAGE_TOOLS } from './pageTools';
import { ChevronsRight, FileText, Menu, Sparkles } from 'lucide-react';

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
  const { activeTool, isOpen, isDesktop, setTool, close, assistantOpen, toggleAssistant } = usePanels();
  // Docked, the right sidebar's own tab strip is the control for its tabs;
  // repeating them here only squeezed the breadcrumb.
  const showToolButtons = !(isOpen && isDesktop);
  const modifier = modifierLabel();

  const focusTitle = () => {
    if (focusPageTitle()) return;
    // No title mounted (the first-run page): at least bring the top into view.
    document.querySelector('.canvas')?.scrollTo({ top: 0, behavior: scrollBehavior() });
  };

  return (
    // A size container, so Ask AI can drop its label when the page column
    // gets narrow and the title keeps the room.
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

      <nav aria-label="Breadcrumb" className="flex min-w-0 items-center">
        <button
          type="button"
          onClick={focusTitle}
          className="flex h-6 min-w-0 items-center gap-1.5 rounded-md px-1.5 text-sm text-foreground transition-colors hover:bg-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          title="Rename page"
        >
          <FileText aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
          <span className={cn('truncate', isUntitled && 'text-muted-foreground')}>
            {isUntitled ? UNTITLED_LABEL : title}
          </span>
        </button>
      </nav>

      <SaveStatus />

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
                    if (isDesktop && !lastInputWasPointer()) focusOpenedTool();
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
 * The quiet save readout: "Saving…", "Saved", "Unsaved" — or a loud
 * "Not saved" with a retry, because a document that has silently stopped
 * saving must never look like one that is fine.
 */
function SaveStatus() {
  const { documentId, lastSavedAt, isAutoSaving, saveError, hasPendingEdits, save } = useEditor();
  const { toast } = useToast();

  // Announce each distinct autosave failure once; the readout stays as the
  // steady-state indicator.
  const announcedSaveError = useRef<string | null>(null);
  useEffect(() => {
    if (!saveError) {
      announcedSaveError.current = null;
      return;
    }
    if (announcedSaveError.current === saveError) return;
    announcedSaveError.current = saveError;
    toast({ title: 'Autosave failed', description: saveError, variant: 'error' });
  }, [saveError, toast]);

  if (saveError) {
    return (
      <span className="flex shrink-0 items-center gap-1 text-xs" aria-live="polite">
        <span className="text-destructive" title={saveError}>
          Not saved
        </span>
        <Button variant="link" size="xs" className="h-6 px-1" onClick={save}>
          Retry
        </Button>
      </span>
    );
  }

  // `hasPendingEdits` reads the editor's revision refs; the topbar re-renders
  // on every edit and every save, which is exactly when the answer changes.
  const pending = hasPendingEdits();
  const savedAt = lastSavedAt
    ? new Date(lastSavedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    : null;
  const [text, detail] = isAutoSaving
    ? ['Saving…', null]
    : !documentId
      ? ['Saved locally', 'Not on the server yet']
      : pending
        ? ['Unsaved', 'Saves automatically in a few seconds']
        : ['Saved', savedAt ? `Saved at ${savedAt}` : 'In sync with the server'];

  return (
    <span
      className="shrink-0 px-1.5 text-xs text-muted-foreground max-sm:hidden"
      aria-live="polite"
      title={detail ?? undefined}
    >
      {text}
    </span>
  );
}

