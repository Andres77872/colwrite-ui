import {
  Button,
  Checkbox,
  Input,
  Popover,
  PopoverAnchor,
  PopoverContent,
  PopoverTrigger,
} from 'colwrite-ui';
import { GripVertical, Quote, Settings2, Sparkles, Trash2 } from 'lucide-react';

// PopoverAnchor moves the positioning reference off the trigger. In every cell
// below the trigger is a button in a toolbar, but the panel is measured against
// the anchored thing in the document — the citation, the highlighted sentence,
// the figure block. `open` is forced; the content portals to document.body.

export function AnchoredToInlineCitation() {
  return (
    <Popover open>
      <div className="max-w-md">
        <div className="mb-3 inline-flex items-center gap-1 rounded-lg border border-border bg-card p-1.5 shadow-sm">
          <PopoverTrigger asChild>
            <Button variant="ghost" size="sm" className="text-primary">
              <Quote />
              Edit citation
            </Button>
          </PopoverTrigger>
          <Button variant="ghost" size="sm" className="text-muted-foreground">
            Replace
          </Button>
        </div>
        <p className="text-base leading-relaxed text-foreground">
          The original formulation replaces recurrence with scaled dot-product attention{' '}
          <PopoverAnchor asChild>
            <span className="rounded-sm bg-primary/10 px-1 py-0.5 text-sm text-primary">
              [Vaswani et al., 2017]
            </span>
          </PopoverAnchor>{' '}
          and remains the baseline every long-context variant is measured against.
        </p>
      </div>
      <PopoverContent align="start" className="w-80 p-3">
        <span className="block text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Citation
        </span>
        <span className="mt-1 block text-sm font-medium text-foreground">
          Attention Is All You Need
        </span>
        <span className="mt-1 block text-xs text-muted-foreground">
          Vaswani et al. · NeurIPS 2017 · arXiv:1706.03762
        </span>
        <label
          htmlFor="ds-panchor-loc"
          className="mt-3 block text-xs font-medium uppercase tracking-wide text-muted-foreground"
        >
          Locator
        </label>
        <Input id="ds-panchor-loc" className="mt-1 h-8 text-xs" defaultValue="§3.2" />
        <div className="mt-3 flex justify-end gap-2 border-t border-border/60 pt-2.5">
          <Button variant="ghost" size="sm" className="text-destructive">
            Remove
          </Button>
          <Button variant="outline" size="sm">
            Done
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}

export function AnchoredToSelection() {
  return (
    <Popover open>
      <div className="max-w-md">
        <div className="mb-3 inline-flex items-center gap-1 rounded-lg border border-border bg-card p-1.5 shadow-sm">
          <PopoverTrigger asChild>
            <Button variant="ghost" size="sm" className="text-primary">
              <Sparkles />
              Ask the assistant
            </Button>
          </PopoverTrigger>
        </div>
        <p className="text-base leading-relaxed text-foreground">
          Retrieval quality dominates the error budget.{' '}
          <PopoverAnchor asChild>
            <span className="rounded-sm bg-primary/15 px-1 py-0.5">
              Replacing BM25 with a dense retriever lifts exact match by 3.1 points before any
              change to the reader.
            </span>
          </PopoverAnchor>{' '}
          We therefore hold the reader fixed for the rest of the section.
        </p>
      </div>
      <PopoverContent align="start" className="w-80 p-2">
        <span className="mb-1 block px-2 pt-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
          On the selected sentence
        </span>
        <ul className="space-y-1">
          {[
            'Tighten to one clause',
            'Find a citation for this claim',
            'Rewrite in the paper’s voice',
            'Explain the 3.1-point figure',
          ].map((action) => (
            <li key={action}>
              <button
                type="button"
                className="w-full rounded-sm px-2 py-1.5 text-left text-xs text-foreground hover:bg-accent"
              >
                {action}
              </button>
            </li>
          ))}
        </ul>
      </PopoverContent>
    </Popover>
  );
}

export function AnchoredToFigureBlock() {
  return (
    <Popover open>
      <PopoverAnchor asChild>
        <div className="w-64 overflow-hidden rounded-lg border border-border bg-card">
          <div className="flex items-center gap-1 border-b border-border/60 bg-muted/40 px-2 py-1">
            <GripVertical aria-hidden="true" className="h-3.5 w-3.5 text-muted-foreground/60" />
            <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Figure 2
            </span>
            <span className="ml-auto flex items-center gap-0.5">
              <PopoverTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon-xs"
                  aria-label="Figure settings"
                  className="text-muted-foreground"
                >
                  <Settings2 />
                </Button>
              </PopoverTrigger>
              <Button
                variant="ghost"
                size="icon-xs"
                aria-label="Remove figure"
                className="text-muted-foreground"
              >
                <Trash2 />
              </Button>
            </span>
          </div>
          <div className="flex h-24 items-center justify-center bg-muted/50 text-2xs text-muted-foreground">
            retrieval-latency.pdf
          </div>
          <p className="border-t border-border/50 px-2 py-1.5 text-2xs text-muted-foreground">
            End-to-end latency against passage count, 32k budget.
          </p>
        </div>
      </PopoverAnchor>
      <PopoverContent side="right" align="start" className="w-72 p-3">
        <span className="mb-2 block text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Figure settings
        </span>
        <div className="space-y-2">
          <label htmlFor="ds-panchor-wide" className="flex items-center gap-2 text-sm text-foreground">
            <Checkbox id="ds-panchor-wide" defaultChecked />
            Span both columns
          </label>
          <label htmlFor="ds-panchor-num" className="flex items-center gap-2 text-sm text-foreground">
            <Checkbox id="ds-panchor-num" defaultChecked />
            Auto-number as Figure N
          </label>
        </div>
        <label
          htmlFor="ds-panchor-label"
          className="mt-3 block text-xs font-medium uppercase tracking-wide text-muted-foreground"
        >
          LaTeX label
        </label>
        <Input id="ds-panchor-label" className="mt-1 h-8 font-mono text-xs" defaultValue="fig:latency" />
      </PopoverContent>
    </Popover>
  );
}
