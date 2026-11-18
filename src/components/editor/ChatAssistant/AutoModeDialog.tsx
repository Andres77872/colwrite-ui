import { useRef } from 'react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { focusQuietly } from '@/components/ui/quietFocus';
import { lastInputWasPointer } from '@/lib/inputModality';

/**
 * The warning before Auto turns on (D18). Auto is on only once the author
 * presses Turn on Auto; Cancel, Escape and a click outside all leave it off.
 * Focus starts on Cancel, so a stray Enter does not turn it on.
 */
export function AutoModeDialog({
  open,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const cancelRef = useRef<HTMLButtonElement>(null);
  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next) onCancel(); }}>
      {open && (
        <DialogContent
          className="max-w-md"
          showCloseButton={false}
          role="alertdialog"
          onOpenAutoFocus={(event) => {
            event.preventDefault();
            if (lastInputWasPointer()) focusQuietly(cancelRef.current);
            else cancelRef.current?.focus();
          }}
        >
          <DialogHeader>
            <DialogTitle>Turn on Auto?</DialogTitle>
            <DialogDescription>
              Auto applies the assistant's edits to this page without asking you first. That includes
              new sections, citations and sources, and what it writes after reading web pages, papers
              or PDFs. You can undo each change, and every change is kept in the chat's review record.
              Auto turns off when you leave this page or chat.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="mt-5">
            <Button ref={cancelRef} variant="outline" onClick={onCancel}>
              Cancel
            </Button>
            <Button onClick={onConfirm}>Turn on Auto</Button>
          </DialogFooter>
        </DialogContent>
      )}
    </Dialog>
  );
}
