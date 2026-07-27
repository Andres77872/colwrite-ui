import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';
import { AlertTriangle, CheckCircle2, Info, X, XCircle } from 'lucide-react';
import { cn } from '@/lib/utils';
import { uid } from '@/lib/uid';
import {
  ToastContext,
  type ToastOptions,
  type ToastVariant,
} from './toastContext';
export type { ToastOptions, ToastVariant } from './toastContext';

interface ToastRecord extends Required<Pick<ToastOptions, 'title' | 'variant'>> {
  id: string;
  description?: string;
  duration: number;
}

const VARIANT_META: Record<ToastVariant, { icon: typeof Info; accent: string; iconColor: string }> = {
  default: { icon: Info, accent: 'border-border', iconColor: 'text-muted-foreground' },
  success: { icon: CheckCircle2, accent: 'border-success/40', iconColor: 'text-success' },
  error: { icon: XCircle, accent: 'border-destructive/40', iconColor: 'text-destructive' },
  warning: { icon: AlertTriangle, accent: 'border-warning/40', iconColor: 'text-warning' },
};

/**
 * ToastProvider — non-blocking feedback for background operations.
 *
 * Replaces `window.alert`, which froze the whole app for routine outcomes
 * like "document saved" and gave no way to keep working while a request
 * was in flight.
 */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastRecord[]>([]);
  const timers = useRef<Map<string, number>>(new Map());

  const dismiss = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
    const timer = timers.current.get(id);
    if (timer !== undefined) {
      window.clearTimeout(timer);
      timers.current.delete(id);
    }
  }, []);

  const toast = useCallback(
    ({ title, description, variant = 'default', duration }: ToastOptions) => {
      const ttl = duration ?? (variant === 'error' ? 8000 : 4000);
      let id = uid();

      setToasts((prev) => {
        // A retrying request, or an effect that React runs twice in
        // StrictMode, would otherwise stack identical copies of the same
        // message. Reuse the existing toast and just restart its timer.
        const existing = prev.find((t) => t.title === title && t.variant === variant);
        if (existing) {
          id = existing.id;
          const previousTimer = timers.current.get(existing.id);
          if (previousTimer !== undefined) window.clearTimeout(previousTimer);
          return prev.map((t) => (t.id === existing.id ? { ...t, description, duration: ttl } : t));
        }
        return [...prev.slice(-2), { id, title, description, variant, duration: ttl }];
      });

      timers.current.set(id, window.setTimeout(() => dismiss(id), ttl));
      return id;
    },
    [dismiss],
  );

  // Clear pending timers if the provider unmounts mid-flight.
  useEffect(() => {
    const pending = timers.current;
    return () => {
      pending.forEach((timer) => window.clearTimeout(timer));
      pending.clear();
    };
  }, []);

  const value = useMemo(() => ({ toast, dismiss }), [toast, dismiss]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      {typeof document !== 'undefined' &&
        createPortal(
          <div
            className="pointer-events-none fixed bottom-4 left-1/2 flex w-[min(28rem,calc(100vw-2rem))] -translate-x-1/2 flex-col gap-2 z-[var(--z-toast)]"
            role="region"
            aria-label="Notifications"
          >
            {toasts.map((t) => (
              <ToastCard key={t.id} toast={t} onDismiss={() => dismiss(t.id)} />
            ))}
          </div>,
          document.body,
        )}
    </ToastContext.Provider>
  );
}

function ToastCard({ toast, onDismiss }: { toast: ToastRecord; onDismiss: () => void }) {
  const { icon: Icon, accent, iconColor } = VARIANT_META[toast.variant];
  return (
    <div
      // Errors interrupt; everything else waits for a pause in speech.
      role={toast.variant === 'error' ? 'alert' : 'status'}
      aria-live={toast.variant === 'error' ? 'assertive' : 'polite'}
      className={cn(
        'pointer-events-auto flex items-start gap-3 rounded-lg border bg-popover px-3 py-2.5 shadow-lg',
        'animate-in fade-in-0 slide-in-from-bottom-2',
        accent,
      )}
    >
      <Icon aria-hidden="true" className={cn('mt-0.5 h-4 w-4 shrink-0', iconColor)} />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-foreground">{toast.title}</p>
        {toast.description && (
          <p className="mt-0.5 text-xs break-words text-muted-foreground">{toast.description}</p>
        )}
      </div>
      <button
        type="button"
        onClick={onDismiss}
        aria-label="Dismiss notification"
        className="-mr-1 shrink-0 rounded-sm p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
      >
        <X aria-hidden="true" className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}
