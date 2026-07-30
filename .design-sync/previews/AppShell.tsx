import {
  AppShell,
  Button,
  EmptyState,
  PanelHeader,
  PanelsContext,
  PanelsProvider,
} from 'colwrite-ui';
import { FileText, Library, MessageSquare, Plus, Sparkles, Wrench } from 'lucide-react';

// AppShell reads panel widths, the collapse flag and the breakpoint from
// usePanels(), so every cell wraps it in the real PanelsProvider — which derives
// its state from matchMedia and needs nothing else.
//
// Region semantics, which are easy to get wrong: `right` is the 52px tools RAIL
// (icon buttons only — prose put here is clipped), and `aside` is the wide tools
// panel, which renders only while the panel system reports something open. The
// FullFrame cell forces `isOpen` through the context because PanelsProvider
// exposes no prop for it.
//
// Rendered at h-dvh, so this is a full-viewport card: cardMode "single" at
// 1600x900 in .design-sync/config.json, wide enough for sidebar + 800px canvas +
// 380px tools panel + rail.

function Region({ label, children }: { label: string; children?: React.ReactNode }) {
  return (
    <div className="flex h-full flex-col">
      <PanelHeader title={label} />
      <div className="min-h-0 flex-1 p-3 text-sm text-muted-foreground">{children}</div>
    </div>
  );
}

function Chrome() {
  return (
    <div className="flex w-full items-center justify-between gap-3 rounded-xl border border-border/60 bg-card px-3 py-2">
      <div className="text-base font-semibold leading-tight">ColWrite</div>
      <Button variant="ghost" size="sm">
        Account
      </Button>
    </div>
  );
}

function Documents() {
  return (
    <Region label="Documents">
      <ul className="space-y-1">
        <li className="flex items-center gap-2 rounded-md bg-accent px-2 py-1.5 text-foreground">
          <FileText className="h-4 w-4" />
          Transformers, revisited
        </li>
        <li className="flex items-center gap-2 px-2 py-1.5">
          <FileText className="h-4 w-4" />
          Scaling notes
        </li>
        <li className="flex items-center gap-2 px-2 py-1.5">
          <FileText className="h-4 w-4" />
          Related work
        </li>
      </ul>
    </Region>
  );
}

function Canvas() {
  return (
    <div className="mx-auto w-full max-w-[var(--doc-measure)] px-10 py-8">
      <h1 className="text-2xl font-semibold">Attention Is All You Need, Revisited</h1>
      <p className="mt-4 text-sm leading-relaxed text-muted-foreground">
        We revisit the original transformer formulation under modern training budgets and
        show that the reported scaling behaviour holds only once the learning-rate
        schedule is decoupled from the batch size.
      </p>
      <h2 className="mt-8 text-lg font-semibold">1. Introduction</h2>
      <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
        Self-attention replaced recurrence as the dominant sequence-modelling primitive
        largely on throughput grounds rather than sample efficiency.
      </p>
    </div>
  );
}

// The rail is 52px wide — icon buttons only.
function Rail() {
  return (
    <div className="flex flex-col items-center gap-1">
      <Button variant="ghost" size="icon-sm" aria-label="Assistant">
        <Sparkles />
      </Button>
      <Button variant="ghost" size="icon-sm" aria-label="Library">
        <Library />
      </Button>
      <Button variant="ghost" size="icon-sm" aria-label="Chats">
        <MessageSquare />
      </Button>
      <Button variant="ghost" size="icon-sm" aria-label="Tools">
        <Wrench />
      </Button>
    </div>
  );
}

function Assistant() {
  return (
    <Region label="Assistant">
      <div className="flex items-start gap-2">
        <Sparkles className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
        <p>Ask for a tighter abstract, or a citation for the scaling claim.</p>
      </div>
    </Region>
  );
}

export function FullFrame() {
  return (
    <PanelsProvider>
      <PanelsContext.Consumer>
        {(panels) =>
          panels ? (
            // `aside` only renders while the panel system is open, and
            // PanelsProvider exposes no prop to force it.
            <PanelsContext.Provider value={{ ...panels, isDesktop: true, isOpen: true }}>
              <AppShell
                header={<Chrome />}
                left={<Documents />}
                main={<Canvas />}
                aside={<Assistant />}
                right={<Rail />}
              />
            </PanelsContext.Provider>
          ) : null
        }
      </PanelsContext.Consumer>
    </PanelsProvider>
  );
}

export function WithoutToolsPanel() {
  return (
    <PanelsProvider>
      <AppShell header={<Chrome />} left={<Documents />} main={<Canvas />} right={<Rail />} />
    </PanelsProvider>
  );
}

export function CanvasOnly() {
  return (
    <PanelsProvider>
      <AppShell header={<Chrome />} main={<Canvas />} />
    </PanelsProvider>
  );
}

export function EmptyCanvas() {
  return (
    <PanelsProvider>
      <AppShell
        header={<Chrome />}
        left={<Region label="Documents" />}
        main={
          <EmptyState
            size="page"
            icon={FileText}
            title="No document open"
            description="Pick one from the list, or start a new draft."
            action={
              <Button size="sm">
                <Plus />
                New document
              </Button>
            }
          />
        }
      />
    </PanelsProvider>
  );
}
