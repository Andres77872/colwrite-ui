import {
  Button,
  Checkbox,
  ExtractionBadge,
  Input,
  PanelHeader,
  Sheet,
  SheetClose,
  SheetContent,
  SheetTrigger,
} from 'colwrite-ui';
import { BookOpen, FileText, Menu, PanelRight, Search, SlidersHorizontal, Upload, X } from 'lucide-react';

// The axis is `side` — the only two values SheetContent accepts — plus the
// internal composition, since the component ships no SheetHeader/SheetFooter:
// the panel is a flex column and you supply the rows. `open` is forced and the
// content portals to document.body with its own scrim.

export function LeftNavigation() {
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
          <PanelHeader
            title="Documents"
            icon={<FileText className="h-4 w-4" />}
            actions={
              <SheetClose asChild>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label="Close navigation"
                  className="text-muted-foreground"
                >
                  <X />
                </Button>
              </SheetClose>
            }
          />
          <ul className="min-h-0 flex-1 space-y-1 overflow-y-auto p-2">
            {documents.map((doc) => (
              <li
                key={doc.title}
                className={
                  doc.active
                    ? 'rounded-md bg-primary/10 px-2 py-1.5'
                    : 'rounded-md px-2 py-1.5'
                }
              >
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
              </li>
            ))}
          </ul>
          <div className="border-t border-border/50 p-2">
            <Button variant="outline" size="sm" className="w-full">
              New document
            </Button>
          </div>
        </SheetContent>
      </Sheet>
      <span className="truncate text-sm text-foreground">Attention Is All You Need</span>
    </div>
  );
}

export function RightTools() {
  const resources = [
    { name: 'vaswani-2017-attention.pdf', size: '1.2 MB', status: 'ready' as const },
    { name: 'izacard-2021-fid.pdf', size: '860 KB', status: 'running' as const },
    { name: 'lewis-2020-rag.pdf', size: '2.1 MB', status: 'ready' as const },
    { name: 'scanned-appendix.pdf', size: '4.4 MB', status: 'failed' as const },
    { name: 'devlin-2019-bert.pdf', size: '1.8 MB', status: 'pending' as const },
  ];
  return (
    <div className="mr-auto flex w-full max-w-md items-center gap-2 rounded-lg border border-border bg-card px-3 py-2">
      <span className="mr-auto truncate text-sm text-foreground">4 · Experiments</span>
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
              <Button variant="ghost" size="icon-sm" aria-label="Upload a PDF">
                <Upload />
              </Button>
            }
          />
          <div className="border-b border-border/50 p-2">
            <div className="relative">
              <Search
                aria-hidden="true"
                className="absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground"
              />
              <Input className="h-8 pl-8 text-xs" defaultValue="fusion-in-decoder" />
            </div>
          </div>
          <ul className="min-h-0 flex-1 space-y-1 overflow-y-auto p-2">
            {resources.map((resource) => (
              <li
                key={resource.name}
                className="rounded-md border border-border/60 bg-background px-2 py-1.5"
              >
                <span className="block truncate text-xs font-medium text-foreground">
                  {resource.name}
                </span>
                <span className="mt-1 flex items-center gap-2">
                  <ExtractionBadge status={resource.status} />
                  <span className="text-2xs text-muted-foreground">{resource.size}</span>
                </span>
              </li>
            ))}
          </ul>
        </SheetContent>
      </Sheet>
    </div>
  );
}

export function WithFooterActions() {
  const filters = [
    { id: 'ds-sc-1', label: 'Only files the assistant can read', checked: true },
    { id: 'ds-sc-2', label: 'Attached to this document', checked: true },
    { id: 'ds-sc-3', label: 'Uploaded by me', checked: false },
    { id: 'ds-sc-4', label: 'Failed extraction', checked: false },
  ];
  return (
    <div className="mr-auto flex w-full max-w-md items-center gap-2 rounded-lg border border-border bg-card px-3 py-2">
      <span className="mr-auto truncate text-sm text-foreground">Library · 12 of 31 files</span>
      <Sheet open>
        <SheetTrigger asChild>
          <Button variant="outline" size="sm">
            <SlidersHorizontal />
            Filters
          </Button>
        </SheetTrigger>
        <SheetContent side="right" title="Library filters">
          <PanelHeader
            title="Filters"
            icon={<SlidersHorizontal className="h-4 w-4" />}
            actions={
              <SheetClose asChild>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label="Close filters"
                  className="text-muted-foreground"
                >
                  <X />
                </Button>
              </SheetClose>
            }
          />
          <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-3">
            <div>
              <span className="mb-2 block text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Show
              </span>
              <div className="space-y-2">
                {filters.map((filter) => (
                  <label
                    key={filter.id}
                    htmlFor={filter.id}
                    className="flex items-start gap-2 text-sm text-foreground"
                  >
                    <Checkbox id={filter.id} defaultChecked={filter.checked} className="mt-1" />
                    {filter.label}
                  </label>
                ))}
              </div>
            </div>
            <div>
              <label
                htmlFor="ds-sc-collection"
                className="mb-2 block text-xs font-medium uppercase tracking-wide text-muted-foreground"
              >
                Collection
              </label>
              <Input id="ds-sc-collection" className="h-8 text-xs" defaultValue="Long-context QA" />
            </div>
          </div>
          <div className="flex gap-2 border-t border-border/50 p-2">
            <SheetClose asChild>
              <Button variant="ghost" size="sm" className="flex-1">
                Reset
              </Button>
            </SheetClose>
            <SheetClose asChild>
              <Button size="sm" className="flex-1">
                Show 12 files
              </Button>
            </SheetClose>
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}
