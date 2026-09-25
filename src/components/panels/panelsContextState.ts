import { createContext, useContext } from 'react';

/**
 * The right sidebar's tabs. `json` is transient: it only shows while it is
 * the active tab, and choosing any other tab dismisses it.
 */
export type SidebarTab = 'assistant' | 'research' | 'sources' | 'history' | 'json';

/** Where the Research tab searches. `library` is the account's own PDFs. */
export type ResearchSourceId = 'arxiv' | 'semantic-scholar' | 'colpali' | 'library';

/**
 * Everything `setTool` accepts: a tab, or a research source (which opens the
 * Research tab on that source). `chats` is the assistant's chat list, which
 * lives inside the Assistant tab. The source ids are also the ids the old
 * tool rail persisted, so saved preferences keep meaning something.
 */
export type ToolId = SidebarTab | ResearchSourceId | 'chats';

/** Context for opening the sidebar on a specific thing, not just a tab. */
export type SidebarIntent =
  | { tab: 'research'; query: string }
  | { tab: 'sources'; sourceKey: string };

type SetStateAction<T> = T | ((previous: T) => T);

export type PanelsContextValue = {
  /** The sidebar's current tab. There is always one, open or not. */
  activeTool: SidebarTab;
  /** Open the sidebar on a tab or research source; `null` closes it. */
  setTool: (tool: ToolId | null) => void;
  researchSource: ResearchSourceId;
  setResearchSource: (source: ResearchSourceId) => void;
  /**
   * Open a tab and hand it something to act on: a query for Research (run on
   * the current source), a source key for Sources (scrolled to and marked).
   */
  openSidebar: (tab: SidebarTab, intent?: SidebarIntent) => void;
  /** The last intent, for the tab it names to consume. `id` changes per call. */
  intent: (SidebarIntent & { id: number }) | null;
  isOpen: boolean;
  open: () => void;
  close: () => void;
  toggle: () => void;
  leftWidth: number;
  setLeftWidth: (width: SetStateAction<number>) => void;
  rightWidth: number;
  setRightWidth: (width: SetStateAction<number>) => void;
  leftCollapsed: boolean;
  setLeftCollapsed: (collapsed: boolean) => void;
  toggleLeftCollapsed: () => void;
  isDesktop: boolean;
  mobileNavOpen: boolean;
  setMobileNavOpen: (open: boolean) => void;
  /**
   * Whether the sidebar is open on the Assistant tab.
   *
   * Kept as its own name because the shortcut, the topbar and the assistant
   * all speak in terms of "the assistant is showing"; setting it opens (or
   * closes) the sidebar on that tab.
   */
  assistantOpen: boolean;
  setAssistantOpen: (open: SetStateAction<boolean>) => void;
  toggleAssistant: () => void;
};

export const PanelsContext = createContext<PanelsContextValue | undefined>(undefined);

export function usePanels(): PanelsContextValue {
  const context = useContext(PanelsContext);
  if (!context) throw new Error('usePanels must be used within PanelsProvider');
  return context;
}
