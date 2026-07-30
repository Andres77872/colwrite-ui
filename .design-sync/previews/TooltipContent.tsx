import {
  Button,
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from 'colwrite-ui';
import { BookOpen, FileCode, FileText, PanelLeft, PanelRight, Sparkles } from 'lucide-react';

// The axis is `side`, `sideOffset` and hint length — the content is a single
// bar of `bg-primary` at 11px, so anything longer than a few words needs a
// width cap from `className` or it renders as one very long line. `open` is
// forced and each cell supplies the required TooltipProvider.

export function SideRight() {
  return (
    <TooltipProvider delayDuration={0}>
      {/* The collapsed sidebar: icons only, so every control needs its name on
          the right, away from the canvas edge. */}
      <div className="flex w-12 flex-col items-center gap-1 rounded-xl border border-border bg-card p-1.5">
        <Button variant="ghost" size="icon-sm" aria-label="Expand sidebar" className="h-9 w-9">
          <PanelLeft />
        </Button>
        <span aria-hidden="true" className="my-1 h-px w-6 bg-border/50" />
        <Tooltip open>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="Show documents"
              className="h-9 w-9 text-muted-foreground"
            >
              <FileText />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="right">Documents</TooltipContent>
        </Tooltip>
      </div>
    </TooltipProvider>
  );
}

export function SideLeft() {
  return (
    <TooltipProvider delayDuration={0}>
      {/* The tools panel is docked to the right edge, so its own controls hint
          leftwards — side="right" would open off-screen and Radix would flip it. */}
      <div className="ml-auto w-72 rounded-xl border border-border bg-card">
        <div className="flex h-11 items-center justify-between gap-2 border-b border-border/50 px-3">
          <span className="flex min-w-0 items-center gap-2">
            <BookOpen aria-hidden="true" className="h-4 w-4 shrink-0 text-primary/70" />
            <h2 className="truncate text-sm font-medium text-foreground/90">Library</h2>
          </span>
          <Tooltip open>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label="Hide tools panel"
                className="text-muted-foreground"
              >
                <PanelRight />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="left">Hide tools panel</TooltipContent>
          </Tooltip>
        </div>
        <ul className="space-y-1 p-2">
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
      </div>
    </TooltipProvider>
  );
}

export function SideBottomCapped() {
  return (
    <TooltipProvider delayDuration={0}>
      <div className="flex w-full items-center gap-2 rounded-lg border border-border bg-card px-3 py-2">
        <span className="mr-auto truncate text-sm text-muted-foreground">
          4.2 Retrieval ablation
        </span>
        <Tooltip open>
          <TooltipTrigger asChild>
            <Button variant="outline" size="sm">
              <Sparkles />
              Rewrite section
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom" align="end" className="max-w-xs">
            Sends this section, its citations and the attached PDFs to the assistant. The current
            text is kept in the block history, so the rewrite can be reverted per block.
          </TooltipContent>
        </Tooltip>
      </div>
    </TooltipProvider>
  );
}

export function SideTopOffset() {
  return (
    <TooltipProvider delayDuration={0}>
      <div className="flex h-56 w-full flex-col justify-end">
        <p className="mb-auto max-w-md text-base leading-relaxed text-muted-foreground">
          Table 1 reports exact match on NaturalQuestions at a fixed 100-passage budget; the
          reader is held constant across every row.
        </p>
        <div className="flex items-center gap-2 rounded-lg border border-border bg-card px-3 py-2">
          <Tooltip open>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="sm" className="text-muted-foreground">
                <FileCode />
                Document JSON
              </Button>
            </TooltipTrigger>
            <TooltipContent side="top" sideOffset={8} align="start">
              Inspect and replace the raw block tree
            </TooltipContent>
          </Tooltip>
          <span className="ml-auto text-2xs text-muted-foreground">1 842 words</span>
        </div>
      </div>
    </TooltipProvider>
  );
}
