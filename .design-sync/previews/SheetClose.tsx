import {
  Button,
  PanelHeader,
  Sheet,
  SheetClose,
  SheetContent,
  SheetTrigger,
} from 'colwrite-ui';
import { BookOpen, ChevronRight, FileText, Menu, PanelRight, Upload, X } from 'lucide-react';

// The axis is what dismisses the drawer: a corner icon, a footer action, or —
// the pattern that matters most on a phone — the navigation row itself, so that
// picking a document both navigates and closes. `open` is forced on the root.

export function HeaderCloseButton() {
  return (
    <div className="mr-auto flex w-full max-w-md items-center gap-2 rounded-lg border border-border bg-card px-3 py-2">
      <span className="mr-auto truncate text-sm text-foreground">Library · 31 files</span>
      <Sheet open>
        <SheetTrigger asChild>
          <Button variant="ghost" size="icon-sm" aria-label="Show tools panel">
            <PanelRight />
          </Button>
        </SheetTrigger>
        <SheetContent side="right" title="Tools">
          <PanelHeader
            title="Library"
            icon={<BookOpen className="h-4 w-4" />}
            actions={
              <>
                <Button variant="ghost" size="icon-sm" aria-label="Upload a PDF">
                  <Upload />
                </Button>
                <SheetClose asChild>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label="Close tools"
                    className="text-muted-foreground"
                  >
                    <X />
                  </Button>
                </SheetClose>
              </>
            }
          />
          <ul className="min-h-0 flex-1 space-y-1 overflow-y-auto p-2">
            {['vaswani-2017-attention.pdf', 'izacard-2021-fid.pdf', 'lewis-2020-rag.pdf'].map(
              (name) => (
                <li
                  key={name}
                  className="truncate rounded-md border border-border/60 bg-background px-2 py-1.5 text-xs text-foreground"
                >
                  {name}
                </li>
              ),
            )}
          </ul>
        </SheetContent>
      </Sheet>
    </div>
  );
}

export function FooterActions() {
  return (
    <div className="mr-auto flex w-full max-w-md items-center gap-2 rounded-lg border border-border bg-card px-3 py-2">
      <span className="mr-auto truncate text-sm text-foreground">2 files attached</span>
      <Sheet open>
        <SheetTrigger asChild>
          <Button variant="outline" size="sm">
            Attach files
          </Button>
        </SheetTrigger>
        <SheetContent side="right" title="Attach files to this document">
          <PanelHeader title="Attach files" icon={<BookOpen className="h-4 w-4" />} />
          <ul className="min-h-0 flex-1 space-y-1 overflow-y-auto p-2">
            {[
              { name: 'vaswani-2017-attention.pdf', picked: true },
              { name: 'izacard-2021-fid.pdf', picked: true },
              { name: 'lewis-2020-rag.pdf', picked: false },
              { name: 'devlin-2019-bert.pdf', picked: false },
            ].map((file) => (
              <li
                key={file.name}
                className={
                  file.picked
                    ? 'flex items-center gap-2 rounded-md bg-primary/10 px-2 py-1.5'
                    : 'flex items-center gap-2 rounded-md px-2 py-1.5'
                }
              >
                <span
                  className={
                    file.picked
                      ? 'min-w-0 flex-1 truncate text-xs font-medium text-primary'
                      : 'min-w-0 flex-1 truncate text-xs text-foreground'
                  }
                >
                  {file.name}
                </span>
                {file.picked && <span className="shrink-0 text-2xs text-primary">attached</span>}
              </li>
            ))}
          </ul>
          <div className="flex gap-2 border-t border-border/50 p-2">
            <SheetClose asChild>
              <Button variant="ghost" size="sm" className="flex-1">
                Cancel
              </Button>
            </SheetClose>
            <SheetClose asChild>
              <Button size="sm" className="flex-1">
                Attach 2 files
              </Button>
            </SheetClose>
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}

export function ClosingNavigationRow() {
  const documents = [
    { title: 'Attention Is All You Need, Revisited', meta: 'Edited 4 minutes ago', active: true },
    { title: 'Sparse Retrieval for Long-Context QA', meta: 'Edited yesterday', active: false },
    { title: 'Notes on positional encodings', meta: 'Edited 3 days ago', active: false },
  ];
  return (
    // Held to the canvas side of the drawer so the trigger stays visible under
    // the scrim; in the app the bar spans the full width and the sheet covers it.
    <div className="ml-auto flex w-full max-w-md items-center gap-2 rounded-lg border border-border bg-card px-3 py-2">
      <Sheet open>
        <SheetTrigger asChild>
          <Button variant="ghost" size="icon-sm" aria-label="Open navigation">
            <Menu />
          </Button>
        </SheetTrigger>
        <SheetContent side="left" title="Workspace navigation">
          <PanelHeader title="Documents" icon={<FileText className="h-4 w-4" />} />
          <ul className="min-h-0 flex-1 space-y-1 overflow-y-auto p-2">
            {documents.map((doc) => (
              <li key={doc.title}>
                <SheetClose asChild>
                  <button
                    type="button"
                    className={
                      doc.active
                        ? 'flex w-full items-center gap-2 rounded-md bg-primary/10 px-2 py-1.5 text-left'
                        : 'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left hover:bg-accent'
                    }
                  >
                    <span className="min-w-0 flex-1">
                      <span
                        className={
                          doc.active
                            ? 'block truncate text-sm font-medium text-primary'
                            : 'block truncate text-sm text-foreground'
                        }
                      >
                        {doc.title}
                      </span>
                      <span className="mt-1 block text-2xs text-muted-foreground">{doc.meta}</span>
                    </span>
                    <ChevronRight
                      aria-hidden="true"
                      className="h-3.5 w-3.5 shrink-0 text-muted-foreground/60"
                    />
                  </button>
                </SheetClose>
              </li>
            ))}
          </ul>
          <p className="border-t border-border/50 px-3 py-2 text-2xs text-muted-foreground">
            Opening a document closes the drawer.
          </p>
        </SheetContent>
      </Sheet>
      <span className="truncate text-sm text-foreground">Attention Is All You Need</span>
    </div>
  );
}
