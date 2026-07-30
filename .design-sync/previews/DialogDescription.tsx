import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from 'colwrite-ui';

// `open` is forced on: the closed state renders nothing. The axis here is the
// supporting line under the title — muted 13px, and the element Radix wires to
// the dialog's `aria-describedby`: one clause, the two-sentence consequence copy
// a destructive action needs, and a sentence naming a file in `<strong>`.

export function OneLine() {
  return (
    <Dialog open>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Rename document</DialogTitle>
          <DialogDescription>
            Shown in the documents menu and used for the export filename.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter className="mt-6">
          <Button variant="outline">Cancel</Button>
          <Button>Save title</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function Consequences() {
  return (
    <Dialog open>
      <DialogContent className="max-w-md" showCloseButton={false}>
        <DialogHeader>
          <DialogTitle>Reject all 12 suggestions?</DialogTitle>
          <DialogDescription>
            Every pending suggestion will be discarded, including the ones you have already
            reviewed. This cannot be undone.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter className="mt-6">
          <Button variant="outline">Cancel</Button>
          <Button variant="destructive">Reject all</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function WithEmphasis() {
  return (
    <Dialog open>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Detach this PDF from the document?</DialogTitle>
          <DialogDescription>
            The extracted text for <strong className="font-semibold text-foreground">
              vaswani-2017-attention.pdf
            </strong>{' '}
            stops being available to the assistant in this document. The file stays in your
            library.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter className="mt-6">
          <Button variant="outline">Keep attached</Button>
          <Button>Detach</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
