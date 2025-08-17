import { createContext, useCallback, useContext, useMemo, useState } from 'react';

export type ToolId = 'json' | 'arxiv' | 'colpali' | 'library';

type PanelsContextValue = {
  activeTool: ToolId | null;
  setTool: (tool: ToolId | null) => void;
  isOpen: boolean;
  open: () => void;
  close: () => void;
  toggle: () => void;
};

const PanelsContext = createContext<PanelsContextValue | undefined>(undefined);

export function usePanels() {
  const ctx = useContext(PanelsContext);
  if (!ctx) throw new Error('usePanels must be used within PanelsProvider');
  return ctx;
}

export function PanelsProvider({ children }: { children: React.ReactNode }) {
  const [activeTool, setActiveTool] = useState<ToolId | null>('json');
  const [isOpen, setIsOpen] = useState<boolean>(true);

  const setTool = useCallback((tool: ToolId | null) => {
    setActiveTool(tool);
    if (tool) setIsOpen(true);
  }, []);

  const open = useCallback(() => setIsOpen(true), []);
  const close = useCallback(() => setIsOpen(false), []);
  const toggle = useCallback(() => setIsOpen(v => !v), []);

  const value = useMemo(() => ({ activeTool, setTool, isOpen, open, close, toggle }), [activeTool, setTool, isOpen, open, close, toggle]);

  return (
    <PanelsContext.Provider value={value}>{children}</PanelsContext.Provider>
  );
}


