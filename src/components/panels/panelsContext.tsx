import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { isBoolean, isNumber, usePersistentState } from '@/hooks/usePersistentState';
import { useIsDesktop } from '@/hooks/useMediaQuery';
import { PANEL_CONFIG } from './panelConfig';
import { isResearchSource, isToolId, tabForTool } from './toolsConfig';
import {
  PanelsContext,
  type ResearchSourceId,
  type SidebarIntent,
  type SidebarTab,
  type ToolId,
} from './panelsContextState';
export type { ToolId } from './panelsContextState';

/**
 * The persisted tool, as a tab.
 *
 * The old rail stored one id per research provider, `chats` and `json`, and
 * `null` for "nothing chosen". Those all still load: a provider opens
 * Research, `chats` opens the assistant, and the developer JSON view is not
 * restored on its own, so it falls back to the assistant as well.
 */
function persistedTab(tool: ToolId): Exclude<SidebarTab, 'json'> {
  const tab = tabForTool(tool);
  return tab === 'json' ? 'assistant' : tab;
}

/** A research source saved by the old rail, read once as the new default. */
function legacyResearchSource(): ResearchSourceId {
  try {
    const stored = JSON.parse(window.localStorage.getItem('panels.activeTool') ?? 'null') as unknown;
    return isResearchSource(stored) ? stored : 'arxiv';
  } catch {
    return 'arxiv';
  }
}

/* ============================================
   PANEL DIMENSIONS
   ============================================ */

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

/* ----------------------------------------
   Context
   ---------------------------------------- */

type SetStateAction<T> = T | ((prev: T) => T);

export function PanelsProvider({ children }: { children: React.ReactNode }) {
  const isDesktop = useIsDesktop();

  // Layout choices survive a reload — re-dragging panels every session was
  // the single most repeated interaction in the app.
  const [storedTool, setStoredTool] = usePersistentState<ToolId>(
    'panels.activeTool',
    // A fresh workspace opens the sidebar on the assistant; from then on the
    // sidebar reopens on whichever tab the author used last.
    'assistant',
    isToolId,
  );
  const [legacySource] = useState(legacyResearchSource);
  const [researchSource, setResearchSource] = usePersistentState<ResearchSourceId>(
    'panels.researchSource',
    legacySource,
    isResearchSource,
  );
  // Transient, never persisted: the JSON view is a developer detour.
  const [jsonOpen, setJsonOpen] = useState(false);
  const activeTool: SidebarTab = jsonOpen ? 'json' : persistedTab(storedTool);
  const [intent, setIntent] = useState<(SidebarIntent & { id: number }) | null>(null);
  const intentId = useRef(0);

  // Two separate notions of "the sidebar is showing":
  //   • desktop — a docked column, so the preference is worth remembering;
  //   • mobile  — a full-height overlay, which must never be restored open on
  //     load or the document is covered before the user has asked for anything.
  const [desktopToolsOpen, setDesktopToolsOpen] = usePersistentState<boolean>(
    'panels.rightOpen',
    // The sidebar is opt-in on a new account so the document owns the
    // initial visual hierarchy. Existing preferences still restore normally.
    false,
    isBoolean,
  );
  const [mobileToolsOpen, setMobileToolsOpen] = useState(false);

  const isOpen = isDesktop ? desktopToolsOpen : mobileToolsOpen;
  const setIsOpen = isDesktop ? setDesktopToolsOpen : setMobileToolsOpen;
  const [leftWidth, setLeftWidthState] = usePersistentState<number>(
    'panels.leftWidth',
    PANEL_CONFIG.left.default,
    isNumber,
  );
  const [rightWidth, setRightWidthState] = usePersistentState<number>(
    'panels.rightWidth',
    PANEL_CONFIG.right.default,
    isNumber,
  );
  const [leftCollapsed, setLeftCollapsed] = usePersistentState<boolean>(
    'panels.leftCollapsed',
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
        setStoredTool(tabForTool(tool));
        if (isResearchSource(tool)) setResearchSource(tool);
      }
      setIsOpen(true);
    },
    [setIsOpen, setResearchSource, setStoredTool],
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
      mobileNavOpen,
    ],
  );

  return <PanelsContext.Provider value={value}>{children}</PanelsContext.Provider>;
}
