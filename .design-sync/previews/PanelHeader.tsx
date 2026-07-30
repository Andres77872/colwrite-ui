import { Button, ExtractionBadge, PanelHeader } from 'colwrite-ui';
import { FileText, Library, MessageSquare, Plus, RefreshCw, X } from 'lucide-react';

// PanelHeader is a 44px title bar with a bottom hairline and no surface of its
// own, so each cell sits it on top of the panel body it belongs to. Ported from
// ToolsAside (icon + close) and the sidebar.

const PANEL_SURFACE = 'flex flex-col overflow-hidden rounded-xl border border-border/60 bg-card';

export function WithIconAndActions() {
  const files = [
    { name: 'attention-2017.pdf', status: 'ready' as const },
    { name: 'scaling-laws-2020.pdf', status: 'running' as const },
    { name: 'workshop-scan-2019.pdf', status: 'failed' as const },
  ];
  return (
    <div className={`h-56 w-80 ${PANEL_SURFACE}`}>
      <PanelHeader
        title="Library"
        icon={<Library aria-hidden="true" className="h-4 w-4" />}
        actions={
          <>
            <Button variant="ghost" size="icon-sm" aria-label="Refresh library">
              <RefreshCw />
            </Button>
            <Button variant="ghost" size="icon-sm" aria-label="Close Library">
              <X />
            </Button>
          </>
        }
      />
      <ul className="min-h-0 flex-1 space-y-1 overflow-y-auto p-2">
        {files.map((file) => (
          <li
            key={file.name}
            className="flex min-w-0 items-start gap-2 rounded-md border border-border/50 p-2"
          >
            <FileText aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm">{file.name}</span>
              <span className="mt-1 flex items-center gap-1.5">
                <ExtractionBadge status={file.status} />
              </span>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function TitleOnly() {
  return (
    <div className={`h-56 w-64 ${PANEL_SURFACE}`}>
      <PanelHeader title="Documents" icon={<FileText aria-hidden="true" className="h-4 w-4" />} />
      <ul className="min-h-0 flex-1 space-y-1 overflow-y-auto p-2">
        {[
          'Attention Is All You Need, Revisited',
          'Scaling notes',
          'Related work',
          'Reviewer replies — NeurIPS',
        ].map((name, index) => (
          <li
            key={name}
            className={`flex items-center gap-2 rounded-md px-2 py-1.5 text-sm ${
              index === 0 ? 'bg-accent text-foreground' : 'text-muted-foreground'
            }`}
          >
            <FileText aria-hidden="true" className="h-4 w-4 shrink-0" />
            <span className="truncate">{name}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function WithPrimaryAction() {
  return (
    <div className={`h-56 w-80 ${PANEL_SURFACE}`}>
      <PanelHeader
        title="Chats"
        icon={<MessageSquare aria-hidden="true" className="h-4 w-4" />}
        actions={
          <>
            <Button size="xs">
              <Plus />
              New chat
            </Button>
            <Button variant="ghost" size="icon-sm" aria-label="Close Chats">
              <X />
            </Button>
          </>
        }
      />
      <ul className="min-h-0 flex-1 divide-y divide-border/50 overflow-y-auto px-3">
        {[
          { title: 'Tighten the abstract', when: '2 minutes ago · 14 messages' },
          { title: 'Find a citation for the scaling claim', when: 'Yesterday · 6 messages' },
          { title: 'Rewrite section 3 intro', when: '3 days ago · 22 messages' },
        ].map((chat) => (
          <li key={chat.title} className="py-2.5">
            <p className="truncate text-sm">{chat.title}</p>
            <p className="mt-0.5 text-2xs text-muted-foreground">{chat.when}</p>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function LongTitle() {
  return (
    <div className={`h-40 w-64 ${PANEL_SURFACE}`}>
      <PanelHeader
        title="Semantic Scholar — citation graph"
        icon={<Library aria-hidden="true" className="h-4 w-4" />}
        actions={
          <Button variant="ghost" size="icon-sm" aria-label="Close panel">
            <X />
          </Button>
        }
      />
      <p className="min-h-0 flex-1 p-3 text-xs text-muted-foreground">
        The title truncates rather than wrapping, so every docked panel keeps the same 44px
        header height however long its name is.
      </p>
    </div>
  );
}
