import {
  Button,
  Input,
  Kbd,
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from 'colwrite-ui';
import {
  BookOpen,
  FileCode,
  GripVertical,
  MessageSquare,
  Network,
  PanelRight,
  Paperclip,
  ScanSearch,
  Search,
  Send,
  Settings2,
  Trash2,
} from 'lucide-react';

// TooltipProvider is the ancestor every Tooltip needs — Radix throws without
// one, and the delay lives here rather than on each Tooltip so a whole toolbar
// shares one open delay and one skip-delay grace period. The app mounts exactly
// one, in main.tsx, at delayDuration={300}. Each cell below is one surface under
// one provider, with the provider's timing spelled out; `open` is forced because
// a closed tooltip renders nothing.

const TOOLS = [
  { icon: FileCode, label: 'Document JSON' },
  { icon: Search, label: 'arXiv Search' },
  { icon: Network, label: 'Semantic Scholar' },
  { icon: ScanSearch, label: 'ColPali Search' },
  { icon: BookOpen, label: 'Library' },
  { icon: MessageSquare, label: 'Chats' },
];

export function AppDelay() {
  return (
    <TooltipProvider delayDuration={300} skipDelayDuration={300}>
      <div className="flex w-full justify-end">
        <div
          className="flex flex-col items-center gap-1 rounded-xl border border-border bg-card p-1.5"
          role="toolbar"
          aria-label="Tools"
          aria-orientation="vertical"
        >
          <Button variant="ghost" size="icon-sm" aria-label="Hide tools panel" className="h-9 w-9">
            <PanelRight />
          </Button>
          <span aria-hidden="true" className="my-1 h-px w-6 bg-border/50" />
          {TOOLS.map((tool, index) => {
            const Icon = tool.icon;
            if (index !== 1) {
              return (
                <Button
                  key={tool.label}
                  variant="ghost"
                  size="icon-sm"
                  aria-label={tool.label}
                  className="h-9 w-9 text-muted-foreground"
                >
                  <Icon />
                </Button>
              );
            }
            return (
              <Tooltip key={tool.label} open>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label={tool.label}
                    className="h-9 w-9 text-muted-foreground"
                  >
                    <Icon />
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="left">{tool.label}</TooltipContent>
              </Tooltip>
            );
          })}
        </div>
      </div>
    </TooltipProvider>
  );
}

export function InstantHints() {
  return (
    // Block controls only surface on hover, so their hints must not wait a
    // further 300 ms: this subtree overrides the app delay to zero.
    <TooltipProvider delayDuration={0}>
      <div className="w-64 overflow-hidden rounded-lg border border-border bg-card">
        <div className="flex items-center gap-1 border-b border-border/60 bg-muted/40 px-2 py-1">
          <GripVertical aria-hidden="true" className="h-3.5 w-3.5 text-muted-foreground/60" />
          <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Figure 2
          </span>
          <span className="ml-auto flex items-center gap-0.5">
            <Button
              variant="ghost"
              size="icon-xs"
              aria-label="Figure settings"
              className="text-muted-foreground"
            >
              <Settings2 />
            </Button>
            <Tooltip open>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon-xs"
                  aria-label="Remove figure"
                  className="text-muted-foreground"
                >
                  <Trash2 />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="bottom" align="end">
                Remove figure
              </TooltipContent>
            </Tooltip>
          </span>
        </div>
        <div className="flex h-24 items-center justify-center bg-muted/50 text-2xs text-muted-foreground">
          retrieval-latency.pdf
        </div>
      </div>
    </TooltipProvider>
  );
}

export function NonHoverableContent() {
  return (
    // The composer's hints are pure labels — nothing in them is worth hovering,
    // so the content is made non-hoverable and closes as the pointer leaves.
    <TooltipProvider delayDuration={0} disableHoverableContent>
      <div className="w-72 rounded-lg border border-border bg-card p-2">
        <Input className="h-8 text-xs" defaultValue="Summarise the reviewer’s objection" />
        <div className="mt-2 flex items-center gap-1">
          <Tooltip open>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label="Attach a PDF"
                className="text-muted-foreground"
              >
                <Paperclip />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom" align="start">
              Attach a PDF from your library
            </TooltipContent>
          </Tooltip>
          <span className="flex items-center gap-1 text-2xs text-muted-foreground">
            <Kbd>Ctrl</Kbd>
            <Kbd>Enter</Kbd>
            to send
          </span>
          <Button size="xs" className="ml-auto" aria-label="Send">
            <Send />
          </Button>
        </div>
      </div>
    </TooltipProvider>
  );
}
