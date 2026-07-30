import {
  Button,
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogOverlay,
  DialogPortal,
  DialogTitle,
} from 'colwrite-ui';
import { FolderClosed, Paperclip } from 'lucide-react';

// `open` is forced on: the closed state renders nothing. DialogPortal is the
// part you almost never write — DialogContent already wraps itself in one. What
// it buys is shown here: the panel escapes the clipped, scrolling side panel it
// was opened from, and lands full-viewport on the body.

export function IncludedInContent() {
  return (
    <Dialog open>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Detach vaswani-2017-attention.pdf?</DialogTitle>
          <DialogDescription>
            The file stays in your library — only this document loses access to its extracted text.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter className="mt-6">
          <DialogClose asChild>
            <Button variant="outline">Keep attached</Button>
          </DialogClose>
          <Button>Detach</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function EscapesAClippingPanel() {
  return (
    <div className="flex max-h-56 w-full max-w-xs flex-col overflow-hidden rounded-lg border border-border bg-card">
      <div className="flex items-center gap-2 border-b border-border px-3 py-2">
        <Paperclip aria-hidden="true" className="h-4 w-4 text-muted-foreground" />
        <p className="text-sm font-semibold">Library</p>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-1.5">
        {['Retrieval methods', 'Benchmarks', 'To read'].map((folder) => (
          <p key={folder} className="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm">
            <FolderClosed aria-hidden="true" className="h-4 w-4 text-muted-foreground" />
            {folder}
          </p>
        ))}
        <p className="px-2 py-1.5 text-2xs text-muted-foreground">
          This panel clips and scrolls its own content.
        </p>
      </div>
      <Dialog open>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Move Benchmarks</DialogTitle>
            <DialogDescription>
              Opened from inside the panel above, yet centred on the whole viewport — the portal
              lifts it out of that clipping, scrolling box.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="mt-6">
            <Button variant="outline">Cancel</Button>
            <Button>Move here</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export function ManualComposition() {
  return (
    <Dialog open>
      <DialogPortal>
        <DialogOverlay>
          <div className="relative w-full max-w-md rounded-xl border border-border bg-card p-6 shadow-xl">
            <p className="text-lg font-semibold leading-none tracking-tight">Extraction queued</p>
            <p className="mt-2 text-sm text-muted-foreground">
              Hand-composed: DialogPortal wrapping DialogOverlay wrapping a panel. Reach for this
              only when you need a different scrim or a different container — the panel below loses
              the focus trap, the Escape handling and the labelling that DialogContent brings.
            </p>
            <div className="mt-4 flex justify-end">
              <DialogClose asChild>
                <Button variant="outline" size="sm">
                  Dismiss
                </Button>
              </DialogClose>
            </div>
          </div>
        </DialogOverlay>
      </DialogPortal>
    </Dialog>
  );
}
