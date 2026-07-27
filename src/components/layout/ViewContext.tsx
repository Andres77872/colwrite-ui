import { useMemo, useState, type ReactNode } from 'react';
import { ViewContext, type AppView } from './viewContextState';

export function ViewProvider({ children }: { children: ReactNode }) {
  const [view, setView] = useState<AppView>('workspace');

  const value = useMemo(() => ({ view, setView }), [view]);

  return <ViewContext.Provider value={value}>{children}</ViewContext.Provider>;
}
