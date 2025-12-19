import { createContext, useCallback, useContext, useMemo, useState } from 'react';

export type ToolId = 'json' | 'arxiv' | 'colpali' | 'library' | 'chats';

/* ============================================
   PANEL DIMENSIONS CONFIG
   Default sizes for panels
   ============================================ */

export const PANEL_CONFIG = {
  left: {
    default: 260,
    min: 200,
    max: 400,
    collapsed: 56,
  },
  right: {
    default: 380,
    min: 280,
    max: 600,
    collapsed: 0,
  },
  rail: {
    width: 52,
  },
} as const;

/* ----------------------------------------
   Context Types
   ---------------------------------------- */

type SetStateAction<T> = T | ((prev: T) => T);

type PanelsContextValue = {
  // Tool selection
  activeTool: ToolId | null;
  setTool: (tool: ToolId | null) => void;
  
  // Right panel (aside) state
  isOpen: boolean;
  open: () => void;
  close: () => void;
  toggle: () => void;
  
  // Panel dimensions - support functional updates
  leftWidth: number;
  setLeftWidth: (width: SetStateAction<number>) => void;
  rightWidth: number;
  setRightWidth: (width: SetStateAction<number>) => void;
  
  // Left sidebar collapse
  leftCollapsed: boolean;
  setLeftCollapsed: (collapsed: boolean) => void;
  toggleLeftCollapsed: () => void;
};

const PanelsContext = createContext<PanelsContextValue | undefined>(undefined);

export function usePanels() {
  const ctx = useContext(PanelsContext);
  if (!ctx) throw new Error('usePanels must be used within PanelsProvider');
  return ctx;
}

export function PanelsProvider({ children }: { children: React.ReactNode }) {
  // Tool selection state
  const [activeTool, setActiveTool] = useState<ToolId | null>('json');
  const [isOpen, setIsOpen] = useState<boolean>(true);
  
  // Panel dimensions state
  const [leftWidth, setLeftWidthState] = useState<number>(PANEL_CONFIG.left.default);
  const [rightWidth, setRightWidthState] = useState<number>(PANEL_CONFIG.right.default);
  const [leftCollapsed, setLeftCollapsed] = useState<boolean>(false);

  // Tool selection handlers
  const setTool = useCallback((tool: ToolId | null) => {
    setActiveTool(tool);
    if (tool) setIsOpen(true);
  }, []);

  // Right panel handlers
  const open = useCallback(() => setIsOpen(true), []);
  const close = useCallback(() => setIsOpen(false), []);
  const toggle = useCallback(() => setIsOpen(v => !v), []);
  
  // Left sidebar handlers
  const toggleLeftCollapsed = useCallback(() => setLeftCollapsed(v => !v), []);
  
  // Panel width handlers - support both direct values and functional updates
  const setLeftWidth = useCallback((width: SetStateAction<number>) => {
    setLeftWidthState(width);
  }, []);
  
  const setRightWidth = useCallback((width: SetStateAction<number>) => {
    setRightWidthState(width);
  }, []);

  const value = useMemo(() => ({ 
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
  }), [
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
    toggleLeftCollapsed,
  ]);

  return (
    <PanelsContext.Provider value={value}>{children}</PanelsContext.Provider>
  );
}


