import {
  Badge,
  Button,
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from 'colwrite-ui';
import { ChevronRight, Filter } from 'lucide-react';

// CollapsibleTrigger cannot mount alone, so every cell is a full Collapsible;
// the TRIGGER row is what varies — the plain panel-section header open and
// closed, a trigger carrying a count badge, a Button via asChild, and a
// disabled trigger.

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

export function OpenAndClosedRow() {
  return (
    <Panel>
      <div className="space-y-1">
        <Collapsible defaultOpen>
          <CollapsibleTrigger className={TRIGGER}>
            <Chevron open />
            <span className="min-w-0 flex-1">Extracted text</span>
          </CollapsibleTrigger>
          <CollapsibleContent>
            <p className="py-1 pl-4 text-xs leading-relaxed text-muted-foreground">
              We revisit the original transformer formulation under modern training budgets.
            </p>
          </CollapsibleContent>
        </Collapsible>
        <Collapsible>
          <CollapsibleTrigger className={TRIGGER}>
            <Chevron />
            <span className="min-w-0 flex-1">Raw metadata</span>
          </CollapsibleTrigger>
          <CollapsibleContent>
            <p className="py-1 pl-4 text-xs text-muted-foreground">application/pdf · 2.4 MB</p>
          </CollapsibleContent>
        </Collapsible>
      </div>
    </Panel>
  );
}

export function WithCountBadge() {
  return (
    <Panel>
      <Collapsible className="rounded-md border border-border/70 bg-muted/20 px-2.5 py-1.5">
        <CollapsibleTrigger className={TRIGGER}>
          <Chevron />
          <span className="min-w-0 flex-1">
            Search filters
            <Badge variant="secondary" className="ml-2 tabular-nums">
              2 active
            </Badge>
          </span>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <p className="mt-2 text-xs text-muted-foreground">Year 2020-2026 · open access only</p>
        </CollapsibleContent>
      </Collapsible>
    </Panel>
  );
}

export function AsChildButton() {
  return (
    <Panel>
      <Collapsible defaultOpen>
        <CollapsibleTrigger asChild>
          <Button variant="ghost" size="sm" className="w-full justify-start">
            <Filter />
            Search filters
          </Button>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <p className="mt-2 text-xs text-muted-foreground">
            asChild hands the trigger role, aria-expanded and aria-controls to the Button, so
            the DS focus ring and hover come from Button rather than a hand-rolled row.
          </p>
        </CollapsibleContent>
      </Collapsible>
    </Panel>
  );
}

export function DisabledTrigger() {
  return (
    <Panel>
      <div className="space-y-1">
        <Collapsible>
          <CollapsibleTrigger className={TRIGGER}>
            <Chevron />
            <span className="min-w-0 flex-1">Extracted text</span>
          </CollapsibleTrigger>
          <CollapsibleContent>
            <p className="py-1 pl-4 text-xs text-muted-foreground">18 pages</p>
          </CollapsibleContent>
        </Collapsible>
        <Collapsible disabled>
          <CollapsibleTrigger className={`${TRIGGER} cursor-not-allowed opacity-50`}>
            <Chevron />
            <span className="min-w-0 flex-1">Page thumbnails</span>
            <span className="text-2xs font-normal text-muted-foreground">extracting…</span>
          </CollapsibleTrigger>
          <CollapsibleContent>
            <p className="py-1 pl-4 text-xs text-muted-foreground">Not available yet.</p>
          </CollapsibleContent>
        </Collapsible>
      </div>
    </Panel>
  );
}
