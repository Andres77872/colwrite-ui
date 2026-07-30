import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
} from 'colwrite-ui';

// `open` is forced on: the closed state renders nothing. The axis here is the
// title line itself — 16px semibold, `leading-none`, tracking tightened — at
// the lengths the app actually produces: a short question, a title over its
// description, and a user-supplied folder name long enough to wrap.

export function Short() {
  return (
    <Dialog open>
      <DialogContent className="max-w-md" showCloseButton={false}>
        <DialogHeader>
          <DialogTitle>Discard this draft?</DialogTitle>
        </DialogHeader>
        <DialogFooter className="mt-5">
          <Button variant="outline">Keep editing</Button>
          <Button variant="destructive">Discard draft</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function WithDescription() {
  return (
    <Dialog open>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Delete “Attention Is All You Need, Revisited”?</DialogTitle>
          <DialogDescription>
            This permanently removes the document and its chats. It cannot be undone.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter className="mt-6">
          <Button variant="outline">Cancel</Button>
          <Button variant="destructive">Delete</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function LongTitleWraps() {
  return (
    <Dialog open>
      <DialogContent className="max-w-md" showCloseButton={false}>
        <DialogHeader>
          <DialogTitle className="break-words">
            Delete Retrieval-augmented generation — long-context benchmarks, ablations and
            reproduction notes for the 2025 survey permanently?
          </DialogTitle>
          <DialogDescription>
            This deletes the folder and everything filed anywhere inside it.
          </DialogDescription>
        </DialogHeader>
        <label className="mt-4 block space-y-1 text-sm font-medium">
          <span>Type the folder name to confirm</span>
          <Input autoComplete="off" />
        </label>
        <DialogFooter className="mt-5">
          <Button variant="outline">Cancel</Button>
          <Button variant="destructive" disabled>
            Delete folder and contents
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
