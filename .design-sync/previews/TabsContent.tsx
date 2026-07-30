import {
  Badge,
  Button,
  EmptyState,
  ExtractionBadge,
  Input,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  Textarea,
} from 'colwrite-ui';
import { MessageSquare, Plus, Search } from 'lucide-react';

// TabsContent cannot mount alone, so every cell is a full Tabs composition;
// the selected CONTENT is what varies — a resource list, the JSON editor, and
// an empty panel. Only the panel matching the root's value renders at all.

function Panel({ children }: { children: React.ReactNode }) {
  return (
    <div className="w-full max-w-sm rounded-lg border border-border bg-card p-3">{children}</div>
  );
}

function ToolBar() {
  return (
    <TabsList aria-label="Tools">
      <TabsTrigger value="library">Library</TabsTrigger>
      <TabsTrigger value="chats">Chats</TabsTrigger>
      <TabsTrigger value="json">JSON</TabsTrigger>
    </TabsList>
  );
}

export function ResourceListPanel() {
  return (
    <Panel>
      <Tabs defaultValue="library">
        <ToolBar />
        <TabsContent value="library" className="space-y-2">
          <div className="relative">
            <Search
              aria-hidden="true"
              className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground"
            />
            <Input
              type="search"
              className="h-8 pl-7 text-xs"
              aria-label="Search inside your PDFs"
              placeholder="Search inside your PDFs…"
            />
          </div>
          <ul className="divide-y divide-border text-xs">
            <li className="flex items-center justify-between gap-2 py-2">
              <span className="min-w-0 truncate">vaswani-attention-2017.pdf</span>
              <ExtractionBadge status="ready" />
            </li>
            <li className="flex items-center justify-between gap-2 py-2">
              <span className="min-w-0 truncate">chinchilla-scaling-2022.pdf</span>
              <ExtractionBadge status="running" />
            </li>
            <li className="flex items-center justify-between gap-2 py-2">
              <span className="min-w-0 truncate">flash-attention-2022.pdf</span>
              <ExtractionBadge status="failed" />
            </li>
          </ul>
        </TabsContent>
      </Tabs>
    </Panel>
  );
}

export function JsonEditorPanel() {
  return (
    <Panel>
      <Tabs defaultValue="json">
        <ToolBar />
        <TabsContent value="json" className="space-y-2">
          <dl className="grid grid-cols-2 gap-y-1 text-xs">
            <dt className="text-muted-foreground">Document</dt>
            <dd className="truncate font-medium">Transformers, revisited</dd>
            <dt className="text-muted-foreground">Blocks</dt>
            <dd className="tabular-nums">14</dd>
          </dl>
          <Textarea
            className="min-h-32 resize-none border-muted bg-muted/30 font-mono text-xs"
            aria-label="Document JSON"
            spellCheck={false}
            defaultValue={'{\n  "name": "Transformers, revisited",\n  "blocks": [\n    {\n      "id": "b1",\n      "type": "heading",\n      "level": 1\n    }\n  ]\n}'}
          />
        </TabsContent>
      </Tabs>
    </Panel>
  );
}

export function EmptyPanel() {
  return (
    <Panel>
      <Tabs defaultValue="chats">
        <ToolBar />
        <TabsContent value="chats">
          <EmptyState
            icon={MessageSquare}
            title="No chats yet"
            description="Start a conversation to keep a history of your assistant sessions."
            action={
              <Button size="sm">
                <Plus />
                New chat
              </Button>
            }
          />
        </TabsContent>
      </Tabs>
    </Panel>
  );
}

export function StackedContentPanels() {
  return (
    <Panel>
      <Tabs defaultValue="references">
        <TabsList aria-label="Document outline" className="grid w-full grid-cols-2">
          <TabsTrigger value="sections">Sections</TabsTrigger>
          <TabsTrigger value="references">References</TabsTrigger>
        </TabsList>
        <TabsContent value="sections">
          <p className="text-xs text-muted-foreground">4 sections, 14 blocks</p>
        </TabsContent>
        <TabsContent value="references" className="space-y-2">
          <p className="text-xs text-muted-foreground">
            Both panels are declared; only the selected one is in the DOM.
          </p>
          <ul className="space-y-1 text-xs">
            <li className="flex items-baseline justify-between gap-2">
              <span className="truncate font-mono text-2xs">vaswani2017attention</span>
              <Badge variant="secondary">cited 4×</Badge>
            </li>
            <li className="flex items-baseline justify-between gap-2">
              <span className="truncate font-mono text-2xs">hoffmann2022chinchilla</span>
              <Badge variant="secondary">cited 1×</Badge>
            </li>
          </ul>
        </TabsContent>
      </Tabs>
    </Panel>
  );
}
