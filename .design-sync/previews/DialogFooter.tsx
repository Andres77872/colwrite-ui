import {
  Alert,
  Button,
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from 'colwrite-ui';

// `open` is forced on: the closed state renders nothing. The axis here is the
// action row at the bottom of the panel — how many actions it carries, and
// which variant the committing action takes. The primary action is always LAST
// in source order: the footer is `flex-col-reverse` below `sm` and a
// right-aligned row from `sm` up, so last-in-source reads first on narrow
// widths and rightmost on wide ones.

export function SingleAction() {
  return (
    <Dialog open>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Your session expired</DialogTitle>
          <DialogDescription>
            Sign in again to keep editing. Unsaved changes stay in this tab until you do.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter className="mt-6">
          <Button>Sign in again</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function CancelAndConfirm() {
  return (
    <Dialog open>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Accept all 12 suggestions?</DialogTitle>
          <DialogDescription>
            Every pending suggestion will be applied to the document.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter className="mt-6">
          <DialogClose asChild>
            <Button variant="outline">Cancel</Button>
          </DialogClose>
          <Button>Accept all</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function DestructiveConfirm() {
  return (
    <Dialog open>
      <DialogContent className="max-w-md" showCloseButton={false}>
        <DialogHeader>
          <DialogTitle className="break-words">Delete Retrieval methods permanently?</DialogTitle>
          <DialogDescription>
            This deletes the folder and everything filed anywhere inside it.
          </DialogDescription>
        </DialogHeader>
        <Alert variant="destructive" className="mt-4">
          The PDFs and their extracted text are permanently deleted. This cannot be undone.
        </Alert>
        <DialogFooter className="mt-5">
          <Button variant="outline">Cancel</Button>
          <Button variant="destructive">Delete folder and contents</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function ThreeActions() {
  return (
    <Dialog open>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Import from references.bib</DialogTitle>
          <DialogDescription>
            17 entries parsed. Four of them already exist in this document's reference list.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter className="mt-6">
          <Button variant="ghost">Cancel</Button>
          <Button variant="outline">Skip the 4 duplicates</Button>
          <Button>Merge 17 entries</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
