import {
  Badge,
  Checkbox,
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
  Input,
} from 'colwrite-ui';
import { ChevronRight } from 'lucide-react';

// Ported from panels/shared/Disclosure — the one expand/collapse treatment in
// the tool panels: a chevron, a summary, and the section body. `defaultOpen`
// is what makes an open section visible in a static capture; the chevron is
// rotated by the same state the app rotates it with.

function Panel({ children }: { children: React.ReactNode }) {
  return (
    <div className="w-full max-w-sm rounded-lg border border-border bg-card p-3">{children}</div>
  );
}

function Chevron({ open }: { open?: boolean }) {
  return (
    <ChevronRight
      aria-hidden="true"
      className={`h-3 w-3 shrink-0 ${open ? 'rotate-90' : ''}`}
    />
  );
}

function FilterGrid() {
  return (
    <div className="mt-2 grid grid-cols-2 gap-2">
      <label className="space-y-1 text-2xs font-medium text-muted-foreground">
        <span>Year or range</span>
        <Input
          className="h-8 text-xs"
          aria-label="Publication year filter"
          defaultValue="2020-2026"
        />
      </label>
      <label className="space-y-1 text-2xs font-medium text-muted-foreground">
        <span>Minimum citations</span>
        <Input
          type="number"
          className="h-8 text-xs"
          aria-label="Minimum citation count"
          defaultValue="250"
        />
      </label>
      <label className="col-span-2 flex cursor-pointer items-center gap-2 text-xs text-foreground">
        <Checkbox defaultChecked aria-label="Open-access papers only" />
        Open-access papers only
      </label>
    </div>
  );
}

export function OpenSection() {
  return (
    <Panel>
      <Collapsible
        defaultOpen
        className="rounded-md border border-border/70 bg-muted/20 px-2.5 py-1.5"
      >
        <CollapsibleTrigger className="flex w-full items-center gap-1 rounded-sm text-left text-xs font-medium">
          <Chevron open />
          <span className="min-w-0 flex-1">Search filters</span>
          <Badge variant="secondary" className="ml-2 tabular-nums">
            2 active
          </Badge>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <FilterGrid />
        </CollapsibleContent>
      </Collapsible>
    </Panel>
  );
}

export function ClosedSection() {
  return (
    <Panel>
      <Collapsible className="rounded-md border border-border/70 bg-muted/20 px-2.5 py-1.5">
        <CollapsibleTrigger className="flex w-full items-center gap-1 rounded-sm text-left text-xs font-medium">
          <Chevron />
          <span className="min-w-0 flex-1">Search filters</span>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <FilterGrid />
        </CollapsibleContent>
      </Collapsible>
    </Panel>
  );
}

export function SectionStack() {
  return (
    <Panel>
      <div className="space-y-1 text-xs">
        <Collapsible defaultOpen>
          <CollapsibleTrigger className="flex w-full items-center gap-1 rounded-sm py-1 text-left font-medium">
            <Chevron open />
            <span className="min-w-0 flex-1">Extracted text</span>
            <span className="tabular-nums text-muted-foreground">18 pages</span>
          </CollapsibleTrigger>
          <CollapsibleContent>
            <p className="py-1 pl-4 leading-relaxed text-muted-foreground">
              The dominant sequence transduction models are based on complex recurrent or
              convolutional neural networks that include an encoder and a decoder.
            </p>
          </CollapsibleContent>
        </Collapsible>

        <Collapsible>
          <CollapsibleTrigger className="flex w-full items-center gap-1 rounded-sm py-1 text-left font-medium">
            <Chevron />
            <span className="min-w-0 flex-1">Attached to documents</span>
            <span className="tabular-nums text-muted-foreground">3</span>
          </CollapsibleTrigger>
          <CollapsibleContent>
            <p className="py-1 pl-4 text-muted-foreground">Transformers, revisited</p>
          </CollapsibleContent>
        </Collapsible>

        <Collapsible>
          <CollapsibleTrigger className="flex w-full items-center gap-1 rounded-sm py-1 text-left font-medium">
            <Chevron />
            <span className="min-w-0 flex-1">Raw metadata</span>
          </CollapsibleTrigger>
          <CollapsibleContent>
            <pre className="py-1 pl-4 font-mono text-2xs text-muted-foreground">
              application/pdf · 2.4 MB
            </pre>
          </CollapsibleContent>
        </Collapsible>
      </div>
    </Panel>
  );
}
