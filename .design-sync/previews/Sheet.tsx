import {
  Button,
  ExtractionBadge,
  Input,
  Kbd,
  PanelHeader,
  Sheet,
  SheetClose,
  SheetContent,
  SheetTrigger,
} from 'colwrite-ui';
import {
  BookOpen,
  FileText,
  Menu,
  MessageSquare,
  PanelLeftClose,
  PanelRight,
  Send,
  Upload,
  X,
} from 'lucide-react';

// `open` is forced: a closed Sheet renders nothing. SheetContent brings its own
// scrim and portals to document.body, so this component is cardMode "single" in
// .design-sync/config.json. `modal` is left at its Radix default (true) — the
// same setting the app ships and the same one Dialog's card captures cleanly.

const DOCUMENTS = [
  { title: 'Attention Is All You Need, Revisited', meta: 'Edited 4 minutes ago', active: true },
  { title: 'Sparse Retrieval for Long-Context QA', meta: 'Edited yesterday', active: false },
  { title: 'Notes on positional encodings', meta: 'Edited 3 days ago', active: false },
  { title: 'Reviewer response — NeurIPS', meta: 'Edited last week', active: false },
];

export function WorkspaceNavigation() {
  return (
    // The bar is held to the canvas side of the drawer so the trigger stays
    // visible; in the app it spans the full width and the drawer covers it.
    <div className="ml-auto flex w-full max-w-md items-center gap-2 rounded-lg border border-border bg-card px-3 py-2">
      <Sheet open>
        <SheetTrigger asChild>
          <Button variant="ghost" size="icon-sm" aria-label="Open navigation">
            <Menu />
          </Button>
        </SheetTrigger>
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
                  <PanelLeftClose />
                </Button>
              </SheetClose>
            }
          />
          <ul className="min-h-0 flex-1 space-y-1 overflow-y-auto p-2">
            {DOCUMENTS.map((doc) => (
              <li key={doc.title}>
                <button
                  type="button"
                  className={
                    doc.active
                      ? 'w-full rounded-md bg-primary/10 px-2 py-1.5 text-left'
                      : 'w-full rounded-md px-2 py-1.5 text-left hover:bg-accent'
                  }
                >
                  <span
                    className={
                      doc.active
                        ? 'block truncate text-sm font-medium text-primary'
                        : 'block truncate text-sm text-foreground'
                    }
                  >
                    {doc.title}
                  </span>
                  <span className="mt-1 block text-2xs text-muted-foreground">{doc.meta}</span>
                </button>
              </li>
            ))}
          </ul>
          <div className="border-t border-border/50 p-2">
            <Button variant="outline" size="sm" className="w-full">
              New document
            </Button>
          </div>
        </SheetContent>
      </Sheet>
      <span className="truncate text-sm text-foreground">
        Attention Is All You Need, Revisited
      </span>
    </div>
  );
}

export function ToolsDrawer() {
  const resources = [
    { name: 'vaswani-2017-attention.pdf', size: '1.2 MB', status: 'ready' as const },
    { name: 'izacard-2021-fid.pdf', size: '860 KB', status: 'running' as const },
    { name: 'lewis-2020-rag.pdf', size: '2.1 MB', status: 'ready' as const },
    { name: 'scanned-appendix.pdf', size: '4.4 MB', status: 'failed' as const },
  ];
  return (
    <div className="mr-auto flex w-full max-w-md items-center gap-2 rounded-lg border border-border bg-card px-3 py-2">
      <span className="mr-auto truncate text-sm text-muted-foreground">4 · Experiments</span>
      <Sheet open>
        <SheetTrigger asChild>
          <Button variant="ghost" size="icon-sm" aria-label="Show tools panel">
            <PanelRight />
          </Button>
        </SheetTrigger>
        <SheetContent side="right" title="Tools">
          <PanelHeader
            title="Library"
            icon={<BookOpen className="h-4 w-4" />}
            actions={
              <Button variant="ghost" size="icon-sm" aria-label="Upload a PDF">
                <Upload />
              </Button>
            }
          />
          <ul className="min-h-0 flex-1 space-y-1 overflow-y-auto p-2">
            {resources.map((resource) => (
              <li
                key={resource.name}
                className="rounded-md border border-border/60 bg-background px-2 py-1.5"
              >
                <span className="block truncate text-xs font-medium text-foreground">
                  {resource.name}
                </span>
                <span className="mt-1 flex items-center gap-2">
                  <ExtractionBadge status={resource.status} />
                  <span className="text-2xs text-muted-foreground">{resource.size}</span>
                </span>
              </li>
            ))}
          </ul>
          <p className="border-t border-border/50 px-3 py-2 text-2xs text-muted-foreground">
            The assistant can quote any file marked Ready.
          </p>
        </SheetContent>
      </Sheet>
    </div>
  );
}

export function AssistantChat() {
  return (
    <div className="mr-auto flex w-full max-w-md items-center gap-2 rounded-lg border border-border bg-card px-3 py-2">
      <span className="mr-auto truncate text-sm text-muted-foreground">
        Draft · 1 842 words
      </span>
      <Sheet open>
        <SheetTrigger asChild>
          <Button variant="ghost" size="sm">
            <MessageSquare />
            Assistant
          </Button>
        </SheetTrigger>
        <SheetContent side="right" title="Assistant">
          <PanelHeader
            title="Chats"
            icon={<MessageSquare className="h-4 w-4" />}
            actions={
              <SheetClose asChild>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label="Close assistant"
                  className="text-muted-foreground"
                >
                  <X />
                </Button>
              </SheetClose>
            }
          />
          <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-3">
            <p className="ml-auto max-w-xs rounded-lg bg-primary/10 px-3 py-2 text-xs text-foreground">
              Does §4.2 still claim a 3.1-point lift? Check it against the table.
            </p>
            <p className="max-w-xs rounded-lg border border-border/60 bg-background px-3 py-2 text-xs text-muted-foreground">
              Table 1 reports 48.2 → 51.4 EM, a 3.2-point lift. I updated the sentence and
              left the original in the block history.
            </p>
          </div>
          <div className="border-t border-border/50 p-2">
            <Input className="h-8 text-xs" defaultValue="Summarise the reviewer’s objection" />
            <span className="mt-2 flex items-center justify-between">
              <span className="flex items-center gap-1 text-2xs text-muted-foreground">
                <Kbd>Ctrl</Kbd>
                <Kbd>Enter</Kbd>
                to send
              </span>
              <Button size="xs" aria-label="Send">
                <Send />
              </Button>
            </span>
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}
