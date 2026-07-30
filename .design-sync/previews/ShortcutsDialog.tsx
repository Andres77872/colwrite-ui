import { BrandLockup, Button, ShortcutsDialog } from 'colwrite-ui';
import { PanelLeft, Sparkles } from 'lucide-react';

// `open` is forced on and `onOpenChange` is a no-op: this is the whole dialog,
// not a part of one, and closed it renders nothing. The rows come from the app's
// own SHORTCUTS table, so the card is the real reference — Mod resolves to
// `Ctrl` off an Apple platform and `⌘` on one.

export function Open() {
  return <ShortcutsDialog open onOpenChange={() => {}} />;
}

export function OverTheEditor() {
  return (
    <div>
      <div className="flex items-center justify-between gap-4 border-b border-border pb-3">
        <BrandLockup />
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="icon-sm" aria-label="Toggle sidebar">
            <PanelLeft />
          </Button>
          <Button variant="ghost" size="xs">
            <Sparkles />
            Assistant
          </Button>
        </div>
      </div>
      <p className="mt-4 text-2xs uppercase tracking-wide text-muted-foreground">
        Draft · Section 3
      </p>
      <h1 className="mt-1 text-2xl font-semibold tracking-tight">
        Sparse Retrieval for Long-Context Summarisation
      </h1>
      <p className="mt-4 max-w-2xl text-sm leading-relaxed text-muted-foreground">
        Pressing Ctrl+/ anywhere in the editor opens the reference below — the bindings all carry
        the platform modifier, because the document surface is contenteditable from edge to edge.
      </p>
      <ShortcutsDialog open onOpenChange={() => {}} />
    </div>
  );
}
