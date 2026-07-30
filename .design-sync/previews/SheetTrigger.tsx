import {
  BrandLockup,
  Button,
  PanelHeader,
  Sheet,
  SheetClose,
  SheetContent,
  SheetTrigger,
} from 'colwrite-ui';
import { BookMarked, BookOpen, FileText, Menu, PanelRight, X } from 'lucide-react';

// The axis is the trigger. Every cell forces the sheet `open`, so the scrim
// dims the chrome the trigger sits in — that dimming is the real component
// behaviour, not a rendering fault. Grade the trigger shape and the drawer.

function NavigationDrawer() {
  return (
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
      <ul className="min-h-0 flex-1 space-y-1 overflow-y-auto p-2 text-sm">
        {[
          'Attention Is All You Need, Revisited',
          'Sparse Retrieval for Long-Context QA',
          'Notes on positional encodings',
        ].map((title) => (
          <li key={title} className="truncate rounded-md px-2 py-1.5 text-foreground">
            {title}
          </li>
        ))}
      </ul>
    </SheetContent>
  );
}

export function AsChildIconButton() {
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
        <NavigationDrawer />
      </Sheet>
      <BrandLockup />
      <span className="ml-auto truncate text-sm text-muted-foreground">Saved</span>
    </div>
  );
}

export function AsChildLabelledButton() {
  return (
    <div className="mr-auto flex w-full max-w-md items-center gap-2 rounded-lg border border-border bg-card px-3 py-2">
      <span className="mr-auto truncate text-sm text-muted-foreground">4 · Experiments</span>
      <Sheet open>
        <SheetTrigger asChild>
          <Button variant="outline" size="sm">
            <PanelRight />
            Tools
          </Button>
        </SheetTrigger>
        <SheetContent side="right" title="Tools">
          <PanelHeader title="Library" icon={<BookOpen className="h-4 w-4" />} />
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

export function StyledTriggerElement() {
  return (
    <div className="mr-auto flex w-full max-w-md items-center gap-2 rounded-lg border border-border bg-card px-3 py-2">
      <span className="mr-auto truncate text-sm text-muted-foreground">
        Attention Is All You Need, Revisited
      </span>
      <Sheet open>
        <SheetTrigger className="inline-flex items-center gap-1.5 rounded-full border border-border bg-secondary px-2.5 py-0.5 text-xs font-semibold text-secondary-foreground hover:bg-accent">
          <BookMarked aria-hidden="true" className="h-3 w-3" />
          18 references
        </SheetTrigger>
        <SheetContent side="right" title="References">
          <PanelHeader title="References" icon={<BookMarked className="h-4 w-4" />} />
          <ul className="min-h-0 flex-1 space-y-1 overflow-y-auto p-2">
            {[
              { title: 'Attention Is All You Need', meta: 'Vaswani et al. · 2017' },
              { title: 'BERT: Pre-training of Deep Bidirectional Transformers', meta: 'Devlin et al. · 2019' },
              { title: 'Retrieval-Augmented Generation', meta: 'Lewis et al. · 2020' },
              { title: 'Leveraging Passage Retrieval with Generative Models', meta: 'Izacard & Grave · 2021' },
            ].map((ref) => (
              <li key={ref.title} className="rounded-md px-2 py-1.5">
                <span className="block truncate text-xs font-medium text-foreground">
                  {ref.title}
                </span>
                <span className="mt-1 block text-2xs text-muted-foreground">{ref.meta}</span>
              </li>
            ))}
          </ul>
          <div className="border-t border-border/50 p-2">
            <Button variant="outline" size="sm" className="w-full">
              Import BibTeX
            </Button>
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}
