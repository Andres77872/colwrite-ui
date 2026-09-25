import { useCallback, useLayoutEffect, useMemo, useRef, useState, type ElementType, type ReactNode } from 'react';
import { BookMarked, Braces, History, Sparkles, Telescope, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { ErrorBoundary } from '@/components/common/ErrorBoundary';
import { ChatAssistant } from '@/components/editor/ChatAssistant';
import { modifierLabel } from '@/components/layout/Shortcuts';
import { canonicalCitationKey, useBibliography, useEditorState } from '@/editor';
import { cn } from '@/lib/utils';
import { usePanels, type SidebarTab } from '../panelsContextState';
import { isSidebarTab, SIDEBAR_TABS, toolMeta } from '../toolsConfig';
import { ResearchPanel } from '../ResearchPanel';
import { SourcesPanel } from '../SourcesPanel';
import { HistoryPanel } from '../HistoryPanel';
import { JsonPanel } from '../JsonPanel';

/** The tab names, as the spec and every entry point ("Ask AI") use them. */
const TAB_LABELS: Record<SidebarTab, string> = {
  assistant: 'AI',
  research: 'Research',
  sources: 'Sources',
  history: 'History',
  json: 'JSON',
};

const TAB_ICONS: Record<SidebarTab, ElementType> = {
  assistant: Sparkles,
  research: Telescope,
  sources: BookMarked,
  history: History,
  json: Braces,
};

const PANELS: Record<SidebarTab, () => ReactNode> = {
  assistant: () => <ChatAssistant />,
  research: () => <ResearchPanel />,
  sources: () => <SourcesPanel />,
  history: () => (
    <div className="h-full overflow-y-auto px-2 py-3">
      <HistoryPanel />
    </div>
  ),
  json: () => (
    <div className="flex h-full flex-col p-3">
      <JsonPanel />
    </div>
  ),
};

/**
 * How many sources the document has: cited, plus kept for later.
 *
 * A hook in its own component so the count, which changes as the author
 * types, does not re-render every mounted tab along with the strip.
 */
function useSourcesCount(): number {
  const { doc } = useEditorState();
  const { entries } = useBibliography();
  return useMemo(() => {
    const keys = new Set(entries.map((entry) => entry.key));
    for (const source of doc.sources ?? []) keys.add(canonicalCitationKey(source.key));
    return keys.size;
  }, [doc.sources, entries]);
}

/**
 * Whether the strip must go compact: the full, labelled strip (measured off
 * screen) is wider than the room the header leaves it. Measuring rather than
 * guessing a breakpoint keeps it right for any label, count or font.
 */
function useCompactStrip(deps: readonly unknown[]) {
  const room = useRef<HTMLDivElement>(null);
  const full = useRef<HTMLDivElement>(null);
  const [compact, setCompact] = useState(false);

  const measure = useCallback(() => {
    const available = room.current?.clientWidth ?? 0;
    const needed = full.current?.scrollWidth ?? 0;
    // jsdom lays nothing out: zero means "unknown", so stay labelled.
    if (available === 0 || needed === 0) return;
    setCompact(needed > available);
  }, []);

  useLayoutEffect(() => {
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    if (room.current) observer.observe(room.current);
    if (full.current) observer.observe(full.current);
    return () => observer.disconnect();
    // `deps` changes what the full strip holds (JSON tab, source count).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [measure, ...deps]);

  return { room, full, compact };
}

/**
 * Where focus goes when the sidebar closes: the topbar button that opens the
 * tab that was showing ("Ask AI", or the Research / Sources / History icon,
 * which the topbar only shows while the sidebar is closed), else the page
 * menu the JSON view is opened from, else the page itself.
 */
function returnFocusTarget(tab: SidebarTab): HTMLElement | null {
  const main = document.querySelector('main');
  if (!main) return null;
  const buttons = [...main.querySelectorAll<HTMLElement>('button')];
  const opener =
    tab === 'assistant'
      ? buttons.find((button) => button.textContent?.trim() === 'Ask AI')
      : tab === 'json'
        ? undefined
        : buttons.find((button) => button.getAttribute('aria-label') === toolMeta(tab).label);
  return (
    (opener && opener.offsetParent !== null ? opener : null) ??
    main.querySelector<HTMLElement>('button[aria-label="Page options"]') ??
    main.querySelector<HTMLElement>('[contenteditable="true"]')
  );
}

/**
 * ToolsAside — the right sidebar: AI, Research, Sources and History behind
 * one tab strip.
 *
 * There is always a tab, so opening the sidebar always shows something. A tab
 * stays mounted once visited, so a running reply, search results or an
 * expanded revision survive a look at another tab. The JSON inspector is a
 * developer detour: it gets a tab only while open.
 *
 * The strip never scrolls or clips. When the labels do not fit the width the
 * sidebar has been given, the inactive tabs fold to icons (named, with a
 * tooltip) and only the active tab keeps its label.
 */
export function ToolsAside() {
  const { activeTool, setTool } = usePanels();
  const [visited, setVisited] = useState<ReadonlySet<SidebarTab>>(() => new Set([activeTool]));
  if (!visited.has(activeTool)) setVisited(new Set(visited).add(activeTool));

  // Where closing the JSON tab goes back to.
  const [lastTab, setLastTab] = useState<SidebarTab>(activeTool === 'json' ? 'assistant' : activeTool);
  if (activeTool !== 'json' && activeTool !== lastTab) setLastTab(activeTool);

  const tabs: SidebarTab[] = activeTool === 'json' ? [...SIDEBAR_TABS, 'json'] : [...SIDEBAR_TABS];

  return (
    <Tabs
      value={activeTool}
      onValueChange={(value) => isSidebarTab(value) && setTool(value)}
      className="flex h-full min-h-0 flex-col"
    >
      <SidebarHeader tabs={tabs} lastTab={lastTab} />

      {tabs.map((tab) =>
        visited.has(tab) || tab === activeTool ? (
          <TabsContent
            key={tab}
            value={tab}
            forceMount
            className="mt-0 min-h-0 flex-1 overflow-hidden focus-visible:ring-inset"
          >
            <ErrorBoundary label={`the ${TAB_LABELS[tab]} tab`}>{PANELS[tab]()}</ErrorBoundary>
          </TabsContent>
        ) : null,
      )}
    </Tabs>
  );
}

/**
 * The strip and the close buttons. Its own component so the source count,
 * which reads the live document, re-renders the header and not every mounted
 * tab along with it.
 */
function SidebarHeader({ tabs, lastTab }: { tabs: SidebarTab[]; lastTab: SidebarTab }) {
  const { activeTool, setTool, close, isDesktop } = usePanels();
  const sourcesCount = useSourcesCount();
  const { room, full, compact } = useCompactStrip([tabs.length, sourcesCount]);


  const tabName = (tab: SidebarTab) =>
    tab === 'sources' && sourcesCount > 0 ? `Sources, ${sourcesCount}` : TAB_LABELS[tab];

  const closeSidebar = () => {
    const tab = activeTool;
    close();
    // The sheet on narrow screens restores focus itself. The docked column
    // unmounts with its close button, which would drop focus to <body>; the
    // topbar's buttons render again once it is gone, so look after a frame.
    if (!isDesktop) return;
    requestAnimationFrame(() =>
      requestAnimationFrame(() => returnFocusTarget(tab)?.focus({ preventScroll: true })),
    );
  };

  const count = (
    <span aria-hidden="true" className="text-xs font-normal tabular-nums text-muted-foreground">
      {sourcesCount}
    </span>
  );

  return (
    <div className="relative flex h-11 shrink-0 items-center gap-1 border-b border-border pl-2 pr-1.5">
      {/* Off-screen twin of the labelled strip, measured to decide `compact`. */}
      <div
        ref={full}
        aria-hidden="true"
        className="pointer-events-none invisible absolute left-0 top-0 flex w-max items-center gap-1 text-sm font-medium"
      >
        <span className="flex gap-0.5">
          {tabs.map((tab) => {
            const Icon = TAB_ICONS[tab];
            return (
              <span key={tab} className="inline-flex h-7 items-center gap-1.5 whitespace-nowrap px-2 [&_svg]:size-4">
                <Icon />
                {TAB_LABELS[tab]}
                {tab === 'sources' && sourcesCount > 0 && count}
              </span>
            );
          })}
        </span>
        {activeTool === 'json' && <span className="h-6 w-6 shrink-0" />}
        {activeTool === 'json' && <span className="mx-0.5 h-4 w-px shrink-0" />}
      </div>

      <div ref={room} className="flex min-w-0 flex-1 items-center gap-1">
        <TabsList aria-label="Sidebar" className="max-w-full justify-start overflow-hidden">
          {tabs.map((tab) => {
            const Icon = TAB_ICONS[tab];
            const active = tab === activeTool;
            const iconOnly = compact && !active;
            const trigger = (
              <TabsTrigger
                key={tab}
                value={tab}
                aria-label={tabName(tab)}
                className={cn(
                  'shrink-0 [&_svg]:text-muted-foreground data-[state=active]:[&_svg]:text-foreground',
                  tab === 'assistant' && '[&_svg]:!text-ai',
                  iconOnly ? 'w-7 px-0' : 'px-2',
                )}
              >
                <Icon aria-hidden="true" />
                {!iconOnly && TAB_LABELS[tab]}
                {!iconOnly && tab === 'sources' && sourcesCount > 0 && count}
              </TabsTrigger>
            );
            if (!iconOnly) return trigger;
            return (
              <Tooltip key={tab}>
                <TooltipTrigger asChild>{trigger}</TooltipTrigger>
                <TooltipContent side="bottom">{tabName(tab).replace(', ', ' · ')}</TooltipContent>
              </Tooltip>
            );
          })}
        </TabsList>
        {activeTool === 'json' && (
          <>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="icon"
                  size="icon-xs"
                  className="-ml-0.5 shrink-0"
                  onClick={() => setTool(lastTab)}
                  aria-label="Close the JSON view"
                >
                  <X aria-hidden="true" />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="bottom">Close JSON</TooltipContent>
            </Tooltip>
            <span aria-hidden="true" className="mx-0.5 h-4 w-px shrink-0 bg-border" />
          </>
        )}
      </div>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="icon"
            size="icon-sm"
            className="shrink-0"
            onClick={closeSidebar}
            aria-label="Close right sidebar"
          >
            <X aria-hidden="true" />
          </Button>
        </TooltipTrigger>
        <TooltipContent side="bottom" align="end">
          Close
          <span className="ml-2 text-tooltip-foreground/60">{modifierLabel()}+Shift+\</span>
        </TooltipContent>
      </Tooltip>
    </div>
  );
}
