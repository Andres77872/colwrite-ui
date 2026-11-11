import { createContext, useContext } from 'react';

export type ToastVariant = 'default' | 'success' | 'error' | 'warning';

/**
 * One follow-up a confirmation can offer — "Undo" after a restore. Toasts are
 * for passive confirmations: an action here must be optional, never the only
 * way to finish or recover from something, and errors still go inline.
 */
export interface ToastAction {
  label: string;
  onSelect: () => void;
}

export interface ToastOptions {
  title: string;
  description?: string;
  variant?: ToastVariant;
  /** Milliseconds; a toast with an action stays longer and pauses while hovered or focused. */
  duration?: number;
  action?: ToastAction;
}

export interface ToastContextValue {
  toast: (options: ToastOptions) => string;
  dismiss: (id: string) => void;
}

export const ToastContext = createContext<ToastContextValue | null>(null);

export function useToast(): ToastContextValue {
  const context = useContext(ToastContext);
  if (!context) throw new Error('useToast must be used within ToastProvider');
  return context;
}
