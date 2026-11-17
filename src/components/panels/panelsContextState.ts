import { createContext, useContext } from 'react';

/**
 * The right sidebar's tabs. `json` is transient: it only shows while it is
 * the active tab, and choosing any other tab dismisses it.
 */
export type SidebarTab = 'assistant' | 'research' | 'review' | 'library' | 'sources' | 'history' | 'json';

/**
 * Where the Research tab searches. `pdfs` is "Search inside my PDFs", which
 * hands the query to the Library tab and shows its matches there.
 */
export type ResearchSourceId = 'papers' | 'claims' | 'pdfs';

/**
 * Everything `setPanel` accepts: a tab, or a research source (which opens the
 * Research tab on that source).
 */
export type PanelId = SidebarTab | ResearchSourceId;

/** Context for opening the sidebar on a specific thing, not just a tab. */
export type SidebarIntent =
  | { tab: 'research'; query: string }
  /** Check a claim (the Research panel's claim check), with the works to judge it against. */
  | { tab: 'research'; claim: string; sources?: string[] }
  /** Search inside every PDF, in the Library. */
  | { tab: 'library'; query: string }
  /** Browse one collection in the Library: its pages, collections and PDFs. */
  | { tab: 'library'; collectionId: number }
  | { tab: 'sources'; sourceKey: string };

type SetStateAction<T> = T | ((previous: T) => T);

export type PanelsContextValue = {
  /** The sidebar's current tab. There is always one, open or not. */
  activePanel: SidebarTab;
  /** Open the sidebar on a tab or research source; `null` closes it. */
  setPanel: (panel: PanelId | null) => void;
  researchSource: ResearchSourceId;
  setResearchSource: (source: ResearchSourceId) => void;
  /**
   * Open a tab and hand it something to act on: a query for Research (run on
   * the current source) or for the Library (searched inside the PDFs), a
   * source key for Sources (scrolled to and marked).
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
  /**
   * Whether the right sidebar sits beside the page (a desktop, or a tablet
   * from 768px) rather than opening as a sheet over it. What depends on the
   * page staying in view next to the sidebar asks this, not `isDesktop`.
   */
  panelsDocked: boolean;
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
