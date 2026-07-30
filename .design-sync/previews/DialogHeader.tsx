import {
  BrandMark,
  Button,
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  ExtractionBadge,
  Input,
} from 'colwrite-ui';

// `open` is forced on: the closed state renders nothing. The axis here is the
// header block at the top of the panel — title alone, title + description, and
// the app's auth-dialog variant where a brand mark sits beside the stacked pair.

export function TitleAndDescription() {
  return (
    <Dialog open>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Rename document</DialogTitle>
          <DialogDescription>
            Shown in the documents menu and used for the export filename.
          </DialogDescription>
        </DialogHeader>
        <div className="mt-4">
          <Input defaultValue="Sparse Retrieval for Long-Context Summarisation" />
        </div>
        <DialogFooter className="mt-5">
          <DialogClose asChild>
            <Button variant="outline">Cancel</Button>
          </DialogClose>
          <Button>Save title</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function TitleOnly() {
  return (
    <Dialog open>
      <DialogContent className="max-w-md" showCloseButton={false}>
        <DialogHeader>
          <DialogTitle>Start a new document?</DialogTitle>
        </DialogHeader>
        <DialogFooter className="mt-5">
          <Button variant="outline">Keep editing</Button>
          <Button>Start new</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function WithBrandRow() {
  return (
    <Dialog open>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <div className="mb-1 flex items-center gap-3">
            <BrandMark size="lg" />
            <div>
              <DialogTitle>Welcome to ColWrite</DialogTitle>
              <DialogDescription>Sign in to open your documents.</DialogDescription>
            </div>
          </div>
        </DialogHeader>
        <div className="mt-2 flex flex-col gap-3">
          <label className="flex flex-col gap-1.5">
            <span className="text-sm text-muted-foreground">Username or email</span>
            <Input placeholder="you@university.edu" />
          </label>
          <Button>Continue</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function WithStatus() {
  return (
    <Dialog open>
      <DialogContent className="max-w-md">
        <DialogHeader>
          {/* pr-8 keeps the badge clear of DialogContent's corner close button. */}
          <div className="flex items-start justify-between gap-3 pr-8">
            <DialogTitle className="min-w-0 break-words">
              vaswani-2017-attention.pdf
            </DialogTitle>
            <ExtractionBadge status="ready" className="mt-0.5 shrink-0" />
          </div>
          <DialogDescription>
            Attached to this document. Its extracted text is what the assistant quotes from.
          </DialogDescription>
        </DialogHeader>
        <dl className="mt-4 grid grid-cols-[1fr_auto] gap-x-4 gap-y-1 rounded-lg border border-border bg-muted/30 p-3 text-sm">
          <dt className="text-muted-foreground">Pages</dt>
          <dd className="tabular-nums">15</dd>
          <dt className="text-muted-foreground">Size</dt>
          <dd className="tabular-nums">2.1 MB</dd>
          <dt className="text-muted-foreground">Uploaded</dt>
          <dd className="tabular-nums">12 Mar 2025</dd>
        </dl>
      </DialogContent>
    </Dialog>
  );
}
