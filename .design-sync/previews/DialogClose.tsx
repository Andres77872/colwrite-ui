import {
  Button,
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
} from 'colwrite-ui';
import { Info } from 'lucide-react';

// `open` is forced on: the closed state renders nothing. The axis here is the
// dismissal path — the corner button DialogContent ships by default, a footer
// Cancel wired through `DialogClose asChild`, and an in-body dismiss for a
// panel that is only an acknowledgement.

export function CornerButton() {
  return (
    <Dialog open>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Attach a PDF</DialogTitle>
          <DialogDescription>
            Files you attach here are extracted once and reused by every chat in this document.
          </DialogDescription>
        </DialogHeader>
        <div className="mt-4 rounded-lg border border-dashed border-border bg-muted/30 p-6 text-center">
          <p className="text-sm">Drop a PDF here, or choose a file</p>
          <p className="mt-1 text-2xs text-muted-foreground">Up to 40 MB per file</p>
          <Button variant="outline" size="sm" className="mt-3">
            Choose file
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function FooterCancel() {
  return (
    <Dialog open>
      <DialogContent className="max-w-md" showCloseButton={false}>
        <DialogHeader>
          <DialogTitle>Edit folder</DialogTitle>
          <DialogDescription>Change the folder name or description.</DialogDescription>
        </DialogHeader>
        <div className="mt-4 space-y-3">
          <label className="block space-y-1 text-sm font-medium">
            <span>Name</span>
            <Input defaultValue="Retrieval methods" />
          </label>
          <label className="block space-y-1 text-sm font-medium">
            <span>Description</span>
            <Input defaultValue="Everything cited in section 2." />
          </label>
        </div>
        <DialogFooter className="mt-5">
          <DialogClose asChild>
            <Button variant="outline">Cancel</Button>
          </DialogClose>
          <Button>Save changes</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function InlineDismiss() {
  return (
    <Dialog open>
      <DialogContent className="max-w-md" showCloseButton={false}>
        <DialogHeader>
          <DialogTitle>Accounts are invite-only during alpha</DialogTitle>
          <DialogDescription>
            Self-service registration is not available yet. Ask for an invite, then sign in with
            the credentials you were given.
          </DialogDescription>
        </DialogHeader>
        <div className="mt-4 flex items-start gap-2 rounded-md border border-warning/40 bg-warning/10 p-3">
          <Info aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
          <div>
            <p className="text-sm font-medium text-warning">Alpha software</p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Accounts and documents may be reset without notice while ColWrite is in development.
            </p>
          </div>
        </div>
        <div className="mt-4">
          <DialogClose asChild>
            <Button variant="outline" size="sm">
              Back to sign in
            </Button>
          </DialogClose>
        </div>
      </DialogContent>
    </Dialog>
  );
}
