import { useCallback, useEffect, useMemo, useState } from 'react';
import { isBoolean, isNumber, usePersistentState } from '@/hooks/usePersistentState';
import { useIsDesktop } from '@/hooks/useMediaQuery';
import { PANEL_CONFIG } from './panelConfig';
import { TOOLS } from './toolsConfig';
import {
  PanelsContext,
  type ToolId,
} from './panelsContextState';
export type { ToolId } from './panelsContextState';

// Derived, not restated: this list drifted from the tool registry and lost
// `history`, so a persisted `activeTool: 'history'` failed the guard below and
// silently reverted to `json` on every reload.
const TOOL_IDS: readonly ToolId[] = TOOLS.map((tool) => tool.id);

const isToolId = (value: unknown): value is ToolId | null =>
  value === null || (typeof value === 'string' && (TOOL_IDS as readonly string[]).includes(value));

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
  const [activeTool, setActiveTool] = usePersistentState<ToolId | null>(
    'panels.activeTool',
    'json',
    isToolId,
  );
  // Two separate notions of "the tools panel is showing":
  //   • desktop — a docked column, so the preference is worth remembering;
  //   • mobile  — a full-height overlay, which must never be restored open on
  //     load or the document is covered before the user has asked for anything.
  const [desktopToolsOpen, setDesktopToolsOpen] = usePersistentState<boolean>(
    'panels.rightOpen',
    true,
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
  // Same storage key the assistant used when it owned this itself, so an
  // existing open/closed preference carries over.
  const [assistantOpen, setAssistantOpen] = usePersistentState<boolean>(
    'chat.expanded',
    false,
    isBoolean,
  );

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
      setActiveTool(tool);
      if (tool) setIsOpen(true);
    },
    [setActiveTool, setIsOpen],
  );

  const open = useCallback(() => setIsOpen(true), [setIsOpen]);
  const close = useCallback(() => setIsOpen(false), [setIsOpen]);
  const toggle = useCallback(() => setIsOpen((v) => !v), [setIsOpen]);
  const toggleLeftCollapsed = useCallback(
    () => setLeftCollapsed((v) => !v),
    [setLeftCollapsed],
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
