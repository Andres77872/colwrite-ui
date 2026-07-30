import {
  Button,
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  ExtractionBadge,
} from 'colwrite-ui';
import { FileText, FolderClosed, FolderInput, Plus, Trash2 } from 'lucide-react';

// The trigger is the one part of this compound that is only visible while the
// dialog is CLOSED: an open DialogContent portals to the body and covers the
// page with its overlay. So these cards render the closed state — the trigger on
// the surfaces it actually ships on (document header, library rows, folder
// header), with the dialog it opens composed underneath it.

export function AsButton() {
  return (
    <div className="max-w-2xl">
      <div className="flex items-center justify-between gap-4 border-b border-border pb-3">
        <div className="min-w-0">
          <p className="truncate text-md font-semibold">
            Sparse Retrieval for Long-Context Summarisation
          </p>
          <p className="mt-0.5 text-xs text-muted-foreground">Saved 2 minutes ago · 14 sections</p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Dialog>
            <DialogTrigger asChild>
              <Button variant="outline" size="sm">
                Rename
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-md">
              <DialogHeader>
                <DialogTitle>Rename document</DialogTitle>
                <DialogDescription>
                  Shown in the documents menu and used for the export filename.
                </DialogDescription>
              </DialogHeader>
              <DialogFooter className="mt-6">
                <DialogClose asChild>
                  <Button variant="outline">Cancel</Button>
                </DialogClose>
                <Button>Save title</Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
          <Button size="sm">Export</Button>
        </div>
      </div>
      <p className="mt-5 text-2xs uppercase tracking-wide text-muted-foreground">
        Section 3 · Method
      </p>
      <h2 className="mt-1 text-xl font-semibold tracking-tight">Sparse index construction</h2>
      <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
        We compare three retrieval budgets against the 2024 arXiv abstract set and report ROUGE-L
        alongside a citation-faithfulness score. The sparse variant recovers 96% of the dense
        baseline at a fifth of the index size.
      </p>
      <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
        Section 3.2 describes the ablation over chunk overlap; the extracted PDFs listed in the
        library were the only sources given to the assistant.
      </p>
    </div>
  );
}

export function AsIconButton() {
  const files = [
    { name: 'vaswani-2017-attention.pdf', meta: '2.1 MB · 15 pages', status: 'ready' as const },
    { name: 'lewis-2020-rag.pdf', meta: '3.4 MB · 19 pages', status: 'ready' as const },
    { name: 'izacard-2022-atlas.pdf', meta: '5.8 MB · 24 pages', status: 'running' as const },
    { name: 'khattab-2020-colbert.pdf', meta: '1.7 MB · 11 pages', status: 'pending' as const },
  ];
  return (
    <div className="w-full max-w-md overflow-hidden rounded-lg border border-border bg-card">
      <div className="flex items-center justify-between gap-2 border-b border-border px-3 py-2">
        <p className="text-sm font-semibold">Unfiled</p>
        <p className="text-2xs tabular-nums text-muted-foreground">4 PDFs</p>
      </div>
      <ul className="divide-y divide-border/50">
        {files.map((file) => (
          <li key={file.name} className="flex items-center gap-3 px-3 py-2.5">
            <FileText aria-hidden="true" className="h-4 w-4 shrink-0 text-muted-foreground" />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm">{file.name}</p>
              <p className="mt-0.5 flex items-center gap-2 text-2xs tabular-nums text-muted-foreground">
                {file.meta}
                <ExtractionBadge status={file.status} />
              </p>
            </div>
            <Dialog>
              <DialogTrigger asChild>
                <Button variant="icon" size="icon-sm" aria-label={`Move ${file.name} to a folder`}>
                  <FolderInput />
                </Button>
              </DialogTrigger>
              <DialogContent className="max-w-md">
                <DialogHeader>
                  <DialogTitle className="break-words">Move {file.name}</DialogTitle>
                  <DialogDescription>
                    Choose a folder, Unfiled, or the current document.
                  </DialogDescription>
                </DialogHeader>
              </DialogContent>
            </Dialog>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function InAFolderHeader() {
  return (
    <div className="w-full max-w-md overflow-hidden rounded-lg border border-border bg-card">
      <div className="flex items-start justify-between gap-2 border-b border-border p-3">
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold">Retrieval methods</p>
          <p className="mt-0.5 text-2xs text-muted-foreground">12 PDFs · 3 subfolders</p>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <Dialog>
            <DialogTrigger asChild>
              <Button variant="ghost" size="xs">
                <Plus />
                New subfolder
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-md">
              <DialogHeader>
                <DialogTitle>Create folder</DialogTitle>
                <DialogDescription>Add a folder inside Retrieval methods.</DialogDescription>
              </DialogHeader>
            </DialogContent>
          </Dialog>
          <Dialog>
            <DialogTrigger asChild>
              <Button variant="ghost" size="icon-sm" aria-label="Delete Retrieval methods">
                <Trash2 />
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-md" showCloseButton={false}>
              <DialogHeader>
                <DialogTitle>Delete Retrieval methods permanently?</DialogTitle>
                <DialogDescription>
                  This deletes the folder and everything filed anywhere inside it.
                </DialogDescription>
              </DialogHeader>
            </DialogContent>
          </Dialog>
        </div>
      </div>
      <div className="p-1.5">
        {['Long-context ablations', 'Sparse attention', 'Reproduction notes'].map((folder) => (
          <p key={folder} className="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm">
            <FolderClosed aria-hidden="true" className="h-4 w-4 text-muted-foreground" />
            {folder}
          </p>
        ))}
        {['vaswani-2017-attention.pdf', 'khattab-2020-colbert.pdf'].map((file) => (
          <p key={file} className="flex items-center gap-2 rounded-md px-2 py-1.5 pl-6 text-sm">
            <FileText aria-hidden="true" className="h-4 w-4 text-muted-foreground" />
            <span className="min-w-0 truncate">{file}</span>
          </p>
        ))}
      </div>
    </div>
  );
}
