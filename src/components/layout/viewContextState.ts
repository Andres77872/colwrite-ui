import { createContext, useContext } from 'react';

/**
 * Which top-level surface the signed-in app is showing.
 *
 * The app has no router — it has always been a single editor screen. This is
 * the smallest thing that lets a second full-page surface exist without
 * pulling in routing: the providers stay mounted across a switch, so editor
 * state survives and the profile view can still open a document.
 */
export type AppView = 'workspace' | 'profile';

export type ViewContextValue = {
  view: AppView;
  setView: (view: AppView) => void;
};

export const ViewContext = createContext<ViewContextValue | null>(null);

export function useView(): ViewContextValue {
  const context = useContext(ViewContext);
  if (!context) throw new Error('useView must be used within ViewProvider');
  return context;
}
