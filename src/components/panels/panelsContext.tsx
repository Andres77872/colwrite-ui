import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { isBoolean, isNumber, usePersistentState } from '@/hooks/usePersistentState';
import { useIsDesktop, useMediaQuery } from '@/hooks/useMediaQuery';
import { PANEL_CONFIG } from './panelConfig';
import { isPersistedTab, isResearchSource, tabForTool } from './toolsConfig';
import { panelKey } from '@/lib/storageKeys';
import {
  PanelsContext,
  type ResearchSourceId,
  type SidebarIntent,
  type SidebarTab,
  type ToolId,
} from './panelsContextState';
export type { ToolId } from './panelsContextState';

/* ============================================
   PANEL DIMENSIONS
   ============================================ */

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

/* ----------------------------------------
   Context
   ---------------------------------------- */

type SetStateAction<T> = T | ((prev: T) => T);

/** From this width the right sidebar docks beside the page. */
const TOOLS_DOCK_QUERY = '(min-width: 768px)';

export function PanelsProvider({ children }: { children: React.ReactNode }) {
  const isDesktop = useIsDesktop();
  // From a tablet up, the right sidebar is a column beside the page (narrower
  // and fixed below the desktop width; see AppShell), not a sheet over it.
  const tabletUp = useMediaQuery(TOOLS_DOCK_QUERY);
  const toolsDocked = isDesktop || tabletUp;

  // Layout choices survive a reload — re-dragging panels every session was
  // the single most repeated interaction in the app.
  const [storedTab, setStoredTab] = usePersistentState<Exclude<SidebarTab, 'json'>>(
    panelKey('tab'),
    // A fresh browser opens the sidebar on the assistant; from then on the
    // sidebar reopens on whichever tab the author used last.
    'assistant',
    isPersistedTab,
  );
  const [researchSource, setResearchSource] = usePersistentState<ResearchSourceId>(
    panelKey('researchSource'),
    'arxiv',
    isResearchSource,
  );
  // Transient, never persisted: the JSON view is a developer detour.
  const [jsonOpen, setJsonOpen] = useState(false);
  const activeTool: SidebarTab = jsonOpen ? 'json' : storedTab;
  const [intent, setIntent] = useState<(SidebarIntent & { id: number }) | null>(null);
  const intentId = useRef(0);

  // Two separate notions of "the sidebar is showing":
  //   • desktop — a docked column, so the preference is worth remembering;
  //   • mobile  — a full-height overlay, which must never be restored open on
  //     load or the document is covered before the user has asked for anything.
  const [desktopToolsOpen, setDesktopToolsOpen] = usePersistentState<boolean>(
    panelKey('rightOpen'),
    // The sidebar is opt-in on a new account so the document owns the
    // initial visual hierarchy. Existing preferences still restore normally.
    false,
    isBoolean,
  );
  const [mobileToolsOpen, setMobileToolsOpen] = useState(false);

  const isOpen = isDesktop ? desktopToolsOpen : mobileToolsOpen;
  const setIsOpen = isDesktop ? setDesktopToolsOpen : setMobileToolsOpen;
  const [leftWidth, setLeftWidthState] = usePersistentState<number>(
    panelKey('leftWidth'),
    PANEL_CONFIG.left.default,
    isNumber,
  );
  const [rightWidth, setRightWidthState] = usePersistentState<number>(
    panelKey('rightWidth'),
    PANEL_CONFIG.right.default,
    isNumber,
  );
  const [leftCollapsed, setLeftCollapsed] = usePersistentState<boolean>(
    panelKey('leftCollapsed'),
    false,
    isBoolean,
  );
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  // Drawers left open while resizing up to desktop would strand a backdrop
  // over a layout that no longer has anything to dismiss.
  useEffect(() => {
    if (!isDesktop) return;
    let cancelled = false;
    queueMicrotask(() => {
      if (cancelled) return;
      setMobileNavOpen(false);
      setMobileToolsOpen(false);
    });
    return () => {
      cancelled = true;
    };
  }, [isDesktop]);

  const setTool = useCallback(
    (tool: ToolId | null) => {
      if (tool === null) {
        setIsOpen(false);
        return;
      }
      if (tool === 'json') {
        setJsonOpen(true);
      } else {
        setJsonOpen(false);
        // Research sources open Research; JSON (handled above) is never stored.
        setStoredTab(tabForTool(tool) as Exclude<SidebarTab, 'json'>);
        if (isResearchSource(tool)) setResearchSource(tool);
      }
      setIsOpen(true);
    },
    [setIsOpen, setResearchSource, setStoredTab],
  );

  const openSidebar = useCallback(
    (tab: SidebarTab, next?: SidebarIntent) => {
      setTool(tab);
      if (next) setIntent({ ...next, id: ++intentId.current });
    },
    [setTool],
  );

  const open = useCallback(() => setIsOpen(true), [setIsOpen]);
  const close = useCallback(() => setIsOpen(false), [setIsOpen]);
  const toggle = useCallback(() => setIsOpen((v) => !v), [setIsOpen]);
  const toggleLeftCollapsed = useCallback(
    () => setLeftCollapsed((v) => !v),
    [setLeftCollapsed],
  );

  const assistantOpen = isOpen && activeTool === 'assistant';
  const setAssistantOpen = useCallback(
    (next: SetStateAction<boolean>) => {
      const value = typeof next === 'function' ? next(assistantOpen) : next;
      if (value) setTool('assistant');
      // Closing "the assistant" only closes the sidebar if that is what it shows.
      else if (assistantOpen) setIsOpen(false);
    },
    [assistantOpen, setIsOpen, setTool],
  );
  const toggleAssistant = useCallback(
    () => setAssistantOpen((v) => !v),
    [setAssistantOpen],
  );

  // Clamping lives here rather than in AppShell so persisted values from an
  // older config, or a different viewport, can never restore an unusable width.
  const setLeftWidth = useCallback(
    (width: SetStateAction<number>) => {
      setLeftWidthState((prev) => {
        const next = typeof width === 'function' ? width(prev) : width;
        return clamp(next, PANEL_CONFIG.left.min, PANEL_CONFIG.left.max);
      });
    },
    [setLeftWidthState],
  );

  const setRightWidth = useCallback(
    (width: SetStateAction<number>) => {
      setRightWidthState((prev) => {
        const next = typeof width === 'function' ? width(prev) : width;
        return clamp(next, PANEL_CONFIG.right.min, PANEL_CONFIG.right.max);
      });
    },
    [setRightWidthState],
  );

  const value = useMemo(
    () => ({
      activeTool,
      setTool,
      researchSource,
      setResearchSource,
      openSidebar,
      intent,
      isOpen,
      open,
      close,
      toggle,
      leftWidth,
      setLeftWidth,
      rightWidth,
      setRightWidth,
      leftCollapsed,
      setLeftCollapsed,
      toggleLeftCollapsed,
      isDesktop,
      toolsDocked,
      mobileNavOpen,
      setMobileNavOpen,
      assistantOpen,
      setAssistantOpen,
      toggleAssistant,
    }),
    [
      assistantOpen,
      setAssistantOpen,
      toggleAssistant,
      activeTool,
      setTool,
      researchSource,
      setResearchSource,
      openSidebar,
      intent,
      isOpen,
      open,
      close,
      toggle,
      leftWidth,
      setLeftWidth,
      rightWidth,
      setRightWidth,
      leftCollapsed,
      setLeftCollapsed,
      toggleLeftCollapsed,
      isDesktop,
      toolsDocked,
      mobileNavOpen,
    ],
  );

  return <PanelsContext.Provider value={value}>{children}</PanelsContext.Provider>;
}
