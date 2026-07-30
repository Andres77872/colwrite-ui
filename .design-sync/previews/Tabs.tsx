import { Badge, EmptyState, Tabs, TabsContent, TabsList, TabsTrigger } from 'colwrite-ui';
import { BookOpen, FileCode, MessageSquare } from 'lucide-react';

// Ported from the tools aside (Library / Chats / Document JSON) and from the
// underline treatment AuthDialog writes with per-part className overrides.
// `defaultValue` on the root is what makes a static capture show real content.

function Panel({ children }: { children: React.ReactNode }) {
  return (
    <div className="w-full max-w-sm rounded-lg border border-border bg-card p-3">{children}</div>
  );
}

function PdfList() {
  return (
    <ul className="space-y-1 text-xs">
      <li className="truncate rounded-md px-2 py-1.5 text-foreground">vaswani-attention-2017.pdf</li>
      <li className="truncate rounded-md px-2 py-1.5 text-muted-foreground">
        chinchilla-scaling-2022.pdf
      </li>
      <li className="truncate rounded-md px-2 py-1.5 text-muted-foreground">
        flash-attention-2022.pdf
      </li>
    </ul>
  );
}

export function ToolPanelTabs() {
  return (
    <Panel>
      <Tabs defaultValue="library">
        <TabsList aria-label="Tools">
          <TabsTrigger value="library">Library</TabsTrigger>
          <TabsTrigger value="chats">Chats</TabsTrigger>
          <TabsTrigger value="json">JSON</TabsTrigger>
        </TabsList>
        <TabsContent value="library">
          <PdfList />
        </TabsContent>
        <TabsContent value="chats">
          <p className="px-2 py-1.5 text-xs text-muted-foreground">3 conversations</p>
        </TabsContent>
      </Tabs>
    </Panel>
  );
}

export function UnderlineTabs() {
  return (
    <Panel>
      <Tabs defaultValue="signin">
        <TabsList
          aria-label="Authentication"
          className="flex h-auto w-full justify-start rounded-none border-b border-border bg-transparent p-0"
        >
          <TabsTrigger
            value="signin"
            className="-mb-px rounded-none border-b-2 border-transparent px-4 py-2 text-sm font-medium text-muted-foreground shadow-none data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:text-primary data-[state=active]:shadow-none"
          >
            Sign in
          </TabsTrigger>
          <TabsTrigger
            value="register"
            className="-mb-px rounded-none border-b-2 border-transparent px-4 py-2 text-sm font-medium text-muted-foreground shadow-none data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:text-primary data-[state=active]:shadow-none"
          >
            Create account
          </TabsTrigger>
        </TabsList>
        <TabsContent value="signin">
          <p className="mt-2 text-sm text-muted-foreground">
            Sign in to open your documents.
          </p>
        </TabsContent>
      </Tabs>
    </Panel>
  );
}

export function FullWidthTabs() {
  return (
    <Panel>
      <Tabs defaultValue="references">
        <TabsList className="grid w-full grid-cols-3">
          <TabsTrigger value="sections">Sections</TabsTrigger>
          <TabsTrigger value="references">References</TabsTrigger>
          <TabsTrigger value="figures">Figures</TabsTrigger>
        </TabsList>
        <TabsContent value="references">
          <ul className="space-y-1 text-xs">
            <li className="flex items-baseline justify-between gap-2 px-2 py-1.5">
              <span className="truncate font-mono text-2xs">vaswani2017attention</span>
              <Badge variant="secondary">cited 4×</Badge>
            </li>
            <li className="flex items-baseline justify-between gap-2 px-2 py-1.5">
              <span className="truncate font-mono text-2xs">hoffmann2022chinchilla</span>
              <Badge variant="secondary">cited 1×</Badge>
            </li>
          </ul>
        </TabsContent>
      </Tabs>
    </Panel>
  );
}

export function VerticalOrientation() {
  return (
    <Panel>
      <Tabs defaultValue="chats" orientation="vertical" className="flex items-start gap-3">
        <TabsList className="h-auto flex-col items-stretch">
          <TabsTrigger value="library" className="justify-start gap-1.5">
            <BookOpen className="h-3.5 w-3.5" />
            Library
          </TabsTrigger>
          <TabsTrigger value="chats" className="justify-start gap-1.5">
            <MessageSquare className="h-3.5 w-3.5" />
            Chats
          </TabsTrigger>
          <TabsTrigger value="json" className="justify-start gap-1.5">
            <FileCode className="h-3.5 w-3.5" />
            JSON
          </TabsTrigger>
        </TabsList>
        <TabsContent value="chats" className="mt-0 min-w-0 flex-1">
          <EmptyState
            icon={MessageSquare}
            title="No chats yet"
            description="Start a conversation to keep a history of your assistant sessions."
          />
        </TabsContent>
      </Tabs>
    </Panel>
  );
}
