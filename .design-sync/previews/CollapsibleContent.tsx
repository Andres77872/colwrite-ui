import {
  Checkbox,
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
  Input,
} from 'colwrite-ui';
import { ChevronRight } from 'lucide-react';

// CollapsibleContent cannot mount alone, so every cell is a full Collapsible;
// the CONTENT is what varies — one section open beside one closed, a filter
// form, and a reference list. Closed content is removed from the DOM, so the
// open/closed pair is the only honest static picture of this part.

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

const TRIGGER = 'flex w-full items-center gap-1 rounded-sm py-1 text-left text-xs font-medium';

export function OpenBesideClosed() {
  return (
    <Panel>
      <div className="space-y-1">
        <Collapsible defaultOpen>
          <CollapsibleTrigger className={TRIGGER}>
            <Chevron open />
            <span className="min-w-0 flex-1">Abstract</span>
          </CollapsibleTrigger>
          <CollapsibleContent>
            <p className="py-1 pl-4 text-xs leading-relaxed text-muted-foreground">
              We revisit the original transformer formulation under modern training budgets and
              show that the reported scaling behaviour holds only once the learning-rate
              schedule is decoupled from the batch size.
            </p>
          </CollapsibleContent>
        </Collapsible>
        <Collapsible>
          <CollapsibleTrigger className={TRIGGER}>
            <Chevron />
            <span className="min-w-0 flex-1">Author notes</span>
          </CollapsibleTrigger>
          <CollapsibleContent>
            <p className="py-1 pl-4 text-xs text-muted-foreground">
              This body is not in the DOM while the section is closed.
            </p>
          </CollapsibleContent>
        </Collapsible>
      </div>
    </Panel>
  );
}

export function FormContent() {
  return (
    <Panel>
      <Collapsible
        defaultOpen
        className="rounded-md border border-border/70 bg-muted/20 px-2.5 py-1.5"
      >
        <CollapsibleTrigger className={TRIGGER}>
          <Chevron open />
          <span className="min-w-0 flex-1">Search filters</span>
        </CollapsibleTrigger>
        <CollapsibleContent>
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
                placeholder="0"
              />
            </label>
            <label className="col-span-2 flex cursor-pointer items-center gap-2 text-xs text-foreground">
              <Checkbox defaultChecked aria-label="Open-access papers only" />
              Open-access papers only
            </label>
          </div>
        </CollapsibleContent>
      </Collapsible>
    </Panel>
  );
}

export function ListContent() {
  return (
    <Panel>
      <Collapsible defaultOpen>
        <CollapsibleTrigger className={TRIGGER}>
          <Chevron open />
          <span className="min-w-0 flex-1">References</span>
          <span className="tabular-nums text-muted-foreground">3</span>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <ul className="mt-1 space-y-1 pl-4 text-xs">
            <li className="flex items-baseline justify-between gap-2">
              <span className="min-w-0 truncate">Vaswani et al., 2017</span>
              <span className="shrink-0 font-mono text-2xs text-muted-foreground">
                vaswani2017attention
              </span>
            </li>
            <li className="flex items-baseline justify-between gap-2">
              <span className="min-w-0 truncate">Hoffmann et al., 2022</span>
              <span className="shrink-0 font-mono text-2xs text-muted-foreground">
                hoffmann2022chinchilla
              </span>
            </li>
            <li className="flex items-baseline justify-between gap-2">
              <span className="min-w-0 truncate">Dao et al., 2022</span>
              <span className="shrink-0 font-mono text-2xs text-muted-foreground">
                dao2022flashattention
              </span>
            </li>
          </ul>
        </CollapsibleContent>
      </Collapsible>
    </Panel>
  );
}
