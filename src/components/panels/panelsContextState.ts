import { createContext, useContext } from 'react';

export type ToolId = 'json' | 'arxiv' | 'semantic-scholar' | 'colpali' | 'library' | 'chats' | 'history';
type SetStateAction<T> = T | ((previous: T) => T);

export type PanelsContextValue = {
  activeTool: ToolId | null;
  setTool: (tool: ToolId | null) => void;
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
   * Whether the assistant window is showing.
   *
   * Lives here rather than inside ChatAssistant because it is shell state with
   * a second owner: the keyboard shortcut has to toggle it, and two
   * `usePersistentState` hooks on the same key are two independent useStates
   * that happen to write to the same place.
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
