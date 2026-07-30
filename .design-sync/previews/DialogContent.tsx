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
  Input,
} from 'colwrite-ui';
import { FileText, FolderClosed, FolderRoot, Inbox } from 'lucide-react';

// `open` is forced on: the closed state renders nothing. DialogContent brings
// its own portal and overlay (fixed inset-0), so each card is one full-viewport
// render — the axis here is the panel itself: its width, its close button and
// how a long body is contained.

export function Default() {
  return (
    <Dialog open>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Insert citation</DialogTitle>
          <DialogDescription>
            Matches are searched across this document's references and your library.
          </DialogDescription>
        </DialogHeader>
        <div className="mt-4">
          <Input defaultValue="attention transformer" placeholder="Author, title or arXiv id" />
          <ul className="mt-3 divide-y divide-border/50">
            {[
              { key: 'vaswani2017', title: 'Attention Is All You Need', meta: 'Vaswani et al. · NeurIPS 2017' },
              { key: 'devlin2019', title: 'BERT: Pre-training of Deep Bidirectional Transformers', meta: 'Devlin et al. · NAACL 2019' },
              { key: 'lewis2020', title: 'Retrieval-Augmented Generation for Knowledge-Intensive NLP', meta: 'Lewis et al. · NeurIPS 2020' },
            ].map((entry) => (
              <li key={entry.key} className="flex items-center justify-between gap-4 py-2">
                <span className="min-w-0">
                  <span className="block truncate text-sm">{entry.title}</span>
                  <span className="block text-2xs text-muted-foreground">{entry.meta}</span>
                </span>
                <code className="shrink-0 rounded-sm bg-secondary px-1.5 py-0.5 font-mono text-2xs text-secondary-foreground">
                  {entry.key}
                </code>
              </li>
            ))}
          </ul>
        </div>
        <DialogFooter className="mt-6">
          <DialogClose asChild>
            <Button variant="outline">Cancel</Button>
          </DialogClose>
          <Button>{'Insert \\cite{vaswani2017}'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function Narrow() {
  return (
    <Dialog open>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Create folder</DialogTitle>
          <DialogDescription>Add a folder inside Retrieval methods.</DialogDescription>
        </DialogHeader>
        <div className="mt-4 space-y-3">
          <label className="block space-y-1 text-sm font-medium">
            <span className="flex items-baseline justify-between gap-2">
              Name
              <span className="text-2xs font-normal tabular-nums text-muted-foreground">18 / 120</span>
            </span>
            <Input defaultValue="Long-context ablations" />
          </label>
          <label className="block space-y-1 text-sm font-medium">
            <span>Description</span>
            <Input placeholder="Optional" />
          </label>
        </div>
        <DialogFooter className="mt-5">
          <Button variant="outline">Cancel</Button>
          <Button>Create folder</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function WithoutCloseButton() {
  return (
    <Dialog open>
      <DialogContent className="max-w-md" showCloseButton={false}>
        <DialogHeader>
          <DialogTitle className="break-words">Delete Retrieval methods permanently?</DialogTitle>
          <DialogDescription>
            This deletes the folder and everything filed anywhere inside it.
          </DialogDescription>
        </DialogHeader>
        <div className="mt-4 space-y-3">
          <dl className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-1 rounded-lg border border-border bg-muted/30 p-3 text-sm">
            <dt>Folders</dt>
            <dd className="font-semibold tabular-nums">4</dd>
            <dt>PDFs</dt>
            <dd className="font-semibold tabular-nums">37</dd>
            <dt>Document memberships</dt>
            <dd className="font-semibold tabular-nums">12</dd>
            <dt>Stored size</dt>
            <dd className="font-semibold tabular-nums">184.6 MB</dd>
          </dl>
          <Alert variant="destructive">
            The PDFs and their extracted text are permanently deleted. This cannot be undone.
          </Alert>
        </div>
        <DialogFooter className="mt-5">
          <Button variant="outline">Cancel</Button>
          <Button variant="destructive">Delete folder and contents</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function ScrollingBody() {
  const folders = [
    'Retrieval methods',
    'Long-context ablations',
    'Benchmarks',
    'Sparse attention',
    'Evaluation harnesses',
    'To read',
    'Reproduction notes',
  ];
  return (
    <Dialog open>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Move vaswani-2017-attention.pdf</DialogTitle>
          <DialogDescription>
            Choose a folder, Unfiled, or the current document.
          </DialogDescription>
        </DialogHeader>
        <div className="mt-4 space-y-2">
          <div className="space-y-1">
            <button
              type="button"
              className="flex w-full items-center gap-2 rounded-md border border-primary bg-primary/10 px-2.5 py-2 text-left text-sm"
            >
              <Inbox aria-hidden="true" className="h-4 w-4" />
              Unfiled
            </button>
            <button
              type="button"
              className="flex w-full items-center gap-2 rounded-md border border-border px-2.5 py-2 text-left text-sm hover:bg-accent"
            >
              <FileText aria-hidden="true" className="h-4 w-4" />
              Current document
            </button>
          </div>
          <div className="max-h-48 overflow-y-auto rounded-lg border border-border p-1.5">
            <p className="px-2 pb-1 pt-0.5 text-2xs font-semibold uppercase tracking-wide text-muted-foreground">
              Folders
            </p>
            <ul>
              <li className="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm">
                <FolderRoot aria-hidden="true" className="h-4 w-4 text-muted-foreground" />
                Library
              </li>
              {folders.map((name) => (
                <li key={name} className="flex items-center gap-2 rounded-md px-2 py-1.5 pl-6 text-sm">
                  <FolderClosed aria-hidden="true" className="h-4 w-4 text-muted-foreground" />
                  {name}
                </li>
              ))}
            </ul>
          </div>
        </div>
        <DialogFooter className="mt-5">
          <Button variant="outline">Cancel</Button>
          <Button>Move here</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
