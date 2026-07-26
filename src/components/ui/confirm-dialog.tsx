import {
  useCallback,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import {
  ConfirmContext,
  type ConfirmFn,
  type ConfirmOptions,
} from './confirmContext';
export type { ConfirmOptions } from './confirmContext';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from './dialog';
import { Button } from './button';
import { Spinner } from './spinner';

interface PendingConfirm extends ConfirmOptions {
  resolve: (value: boolean) => void;
}

/**
 * ConfirmProvider — replaces `window.confirm`.
 *
 * The native dialog blocks the event loop, cannot be styled, gives no
 * context about what is being deleted beyond a raw id, and reads the page
 * URL aloud as its title. This keeps the same `await confirm(...)` ergonomics
 * while staying inside the app's own focus and theming rules.
 */
export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [pending, setPending] = useState<PendingConfirm | null>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);

  const confirm = useCallback<ConfirmFn>(
    (options) => new Promise<boolean>((resolve) => setPending({ ...options, resolve })),
    [],
  );

  const settle = useCallback(
    (result: boolean) => {
      setPending((current) => {
        current?.resolve(result);
        return null;
      });
    },
    [],
  );

  const value = useMemo(() => confirm, [confirm]);

  return (
    <ConfirmContext.Provider value={value}>
      {children}
      <Dialog open={pending !== null} onOpenChange={(open) => !open && settle(false)}>
        {pending && (
          <DialogContent
            className="max-w-md"
            showCloseButton={false}
            // Destructive actions should not be one stray Enter away.
            onOpenAutoFocus={(event) => {
              if (!pending.destructive) return;
              event.preventDefault();
              cancelRef.current?.focus();
            }}
          >
            <DialogHeader>
              <DialogTitle>{pending.title}</DialogTitle>
              {pending.description && (
                <DialogDescription>{pending.description}</DialogDescription>
              )}
            </DialogHeader>
            <DialogFooter className="mt-5">
              <Button ref={cancelRef} variant="outline" onClick={() => settle(false)}>
                {pending.cancelLabel ?? 'Cancel'}
              </Button>
              <Button
                variant={pending.destructive ? 'destructive' : 'default'}
                onClick={() => settle(true)}
              >
                {pending.confirmLabel ?? 'Confirm'}
              </Button>
            </DialogFooter>
          </DialogContent>
        )}
      </Dialog>
    </ConfirmContext.Provider>
  );
}

/** Re-exported so callers can show progress without importing two modules. */
export { Spinner };
