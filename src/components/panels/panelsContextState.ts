import { createContext, useContext } from 'react';

export type ToolId = 'json' | 'arxiv' | 'semantic-scholar' | 'colpali' | 'library' | 'chats';
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
};

export const PanelsContext = createContext<PanelsContextValue | undefined>(undefined);

export function usePanels(): PanelsContextValue {
  const context = useContext(PanelsContext);
  if (!context) throw new Error('usePanels must be used within PanelsProvider');
  return context;
}
