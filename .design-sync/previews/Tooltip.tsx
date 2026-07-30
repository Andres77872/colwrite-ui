import {
  Button,
  ExtractionBadge,
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from 'colwrite-ui';
import { FileText, PanelLeftClose, Upload } from 'lucide-react';

// Two things are forced in every cell: `open` (a closed Tooltip renders
// nothing) and a TooltipProvider ancestor — Radix throws without one, and the
// app mounts a single provider in main.tsx. `delayDuration={0}` is passed so
// nothing about the open delay gates a static render. TooltipContent is NOT
// portalled in this DS, so it renders inside the card root; the component is
// still cardMode "single" in .design-sync/config.json because three open
// tooltips in a grid overlap each other's cells.

export function SidebarCollapse() {
  return (
    <TooltipProvider delayDuration={0}>
      <div className="w-64 rounded-lg border border-border bg-card">
        <div className="flex h-11 items-center justify-between gap-2 border-b border-border/50 px-3">
          <h2 className="truncate text-sm font-medium text-foreground/90">Documents</h2>
          <Tooltip open>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label="Collapse sidebar"
                className="text-muted-foreground"
              >
                <PanelLeftClose />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="right">Collapse sidebar</TooltipContent>
          </Tooltip>
        </div>
        <ul className="space-y-1 p-2 text-sm">
          {['Attention Is All You Need, Revisited', 'Sparse Retrieval for Long-Context QA'].map(
            (title) => (
              <li key={title} className="truncate rounded-md px-2 py-1.5 text-muted-foreground">
                {title}
              </li>
            ),
          )}
        </ul>
      </div>
    </TooltipProvider>
  );
}

export function TruncatedTitle() {
  return (
    <TooltipProvider delayDuration={0}>
      <div className="w-64 rounded-lg border border-border bg-card p-2">
        <Tooltip open>
          <TooltipTrigger className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left hover:bg-accent">
            <FileText aria-hidden="true" className="h-3.5 w-3.5 shrink-0 text-primary/70" />
            <span className="min-w-0 truncate text-sm text-foreground">
              Reviewer response — NeurIPS 2024 rebuttal, second round
            </span>
          </TooltipTrigger>
          <TooltipContent side="bottom" align="start">
            Reviewer response — NeurIPS 2024 rebuttal, second round
          </TooltipContent>
        </Tooltip>
        <p className="mt-1 px-2 text-2xs text-muted-foreground">Edited 3 days ago · 2 140 words</p>
      </div>
    </TooltipProvider>
  );
}

export function ExtractionFailure() {
  return (
    <TooltipProvider delayDuration={0}>
      <div className="w-72 rounded-lg border border-border bg-card">
        <div className="flex h-11 items-center justify-between gap-2 border-b border-border/50 px-3">
          <h2 className="truncate text-sm font-medium text-foreground/90">Library</h2>
          <Button variant="ghost" size="icon-sm" aria-label="Upload a PDF">
            <Upload />
          </Button>
        </div>
        <ul className="space-y-1 p-2">
          <li className="rounded-md border border-border/60 bg-background px-2 py-1.5">
            <span className="block truncate text-xs font-medium text-foreground">
              vaswani-2017-attention.pdf
            </span>
            <span className="mt-1 flex items-center gap-2">
              <ExtractionBadge status="ready" />
              <span className="text-2xs text-muted-foreground">1.2 MB</span>
            </span>
          </li>
          <li className="rounded-md border border-border/60 bg-background px-2 py-1.5">
            <span className="block truncate text-xs font-medium text-foreground">
              scanned-appendix.pdf
            </span>
            <span className="mt-1 flex items-center gap-2">
              <Tooltip open>
                <TooltipTrigger className="rounded-full">
                  <ExtractionBadge status="failed" />
                </TooltipTrigger>
                <TooltipContent side="bottom" align="start" className="max-w-xs">
                  Extraction failed — the file has no text layer, so the assistant cannot quote
                  it. Re-upload a searchable PDF.
                </TooltipContent>
              </Tooltip>
              <span className="text-2xs text-muted-foreground">4.4 MB</span>
            </span>
          </li>
        </ul>
      </div>
    </TooltipProvider>
  );
}
