import { useId, useRef, useState, type ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Spinner } from '@/components/ui/spinner';
import { Alert } from '@/components/ui/alert';

/**
 * A destructive confirmation that asks for a name typed exactly (a
 * workspace's, the account's username), as the API checks it: the same
 * capitals and accents. Focus starts on Cancel. `onConfirm` resolves once it
 * is done; a throw is said here, with `describe`, and the dialog stays.
 */
export function TypedConfirmDialog({
  title,
  description,
  expected,
  confirmLabel,
  onConfirm,
  onClose,
  describe,
  extra,
}: {
  title: string;
  description: ReactNode;
  /** What must be typed. */
  expected: string;
  confirmLabel: string;
  onConfirm: () => Promise<unknown>;
  onClose: () => void;
  describe: (error: unknown) => ReactNode;
  /** Shown under the field, before any error (the workspaces a refusal named). */
  extra?: ReactNode;
}) {
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ReactNode | null>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const fieldId = useId();
  const matches = typed.trim() === expected;

  const submit = async () => {
    if (!matches || busy) return;
    setBusy(true);
    setError(null);
    try {
      await onConfirm();
    } catch (caught) {
      setError(describe(caught));
      setBusy(false);
    }
  };

  return (
    <Dialog open onOpenChange={(next) => !busy && !next && onClose()}>
      <DialogContent
        className="max-w-md"
        showCloseButton={false}
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          cancelRef.current?.focus();
        }}
      >
        <DialogHeader>
          <DialogTitle className="break-words">{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <div className="mt-4 space-y-3">
          <div className="space-y-1">
            <label htmlFor={fieldId} className="block text-sm font-medium">
              Type <strong className="break-words">{expected}</strong> to confirm
            </label>
            <Input
              id={fieldId}
              value={typed}
              autoComplete="off"
              spellCheck={false}
              disabled={busy}
              onChange={(event) => setTyped(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') void submit();
              }}
            />
          </div>
          {extra}
          {error && <Alert variant="destructive">{error}</Alert>}
        </div>
        <DialogFooter className="mt-5">
          <Button ref={cancelRef} variant="outline" disabled={busy} onClick={onClose}>
            Cancel
          </Button>
          <Button variant="destructive" disabled={!matches || busy} onClick={() => void submit()}>
            {busy && <Spinner />}
            {confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
