import { Tabs, TabsContent, TabsList, TabsTrigger } from 'colwrite-ui';

// TabsList cannot mount alone, so every cell is a full Tabs composition; the
// LIST is what varies — the default pill bar, the stretched grid bar, the
// underline bar AuthDialog writes, and a bar carrying all six tool names.

function Panel({ children }: { children: React.ReactNode }) {
  return (
    <div className="w-full max-w-sm rounded-lg border border-border bg-card p-3">{children}</div>
  );
}

function Body({ children }: { children: React.ReactNode }) {
  return <p className="px-2 py-1.5 text-xs text-muted-foreground">{children}</p>;
}

export function PillBar() {
  return (
    <Panel>
      <Tabs defaultValue="library">
        <TabsList aria-label="Tools">
          <TabsTrigger value="library">Library</TabsTrigger>
          <TabsTrigger value="chats">Chats</TabsTrigger>
          <TabsTrigger value="json">JSON</TabsTrigger>
        </TabsList>
        <TabsContent value="library">
          <Body>Default bar: inline-flex, 36px tall, muted trough with 4px inset.</Body>
        </TabsContent>
      </Tabs>
    </Panel>
  );
}

export function FullWidthBar() {
  return (
    <Panel>
      <Tabs defaultValue="sections">
        <TabsList aria-label="Document outline" className="grid w-full grid-cols-3">
          <TabsTrigger value="sections">Sections</TabsTrigger>
          <TabsTrigger value="references">References</TabsTrigger>
          <TabsTrigger value="figures">Figures</TabsTrigger>
        </TabsList>
        <TabsContent value="sections">
          <Body>grid w-full grid-cols-3 — equal tracks, bar spans the panel.</Body>
        </TabsContent>
      </Tabs>
    </Panel>
  );
}

export function UnderlineBar() {
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
          <Body>Trough and shadow dropped; the active tab is marked by a rule.</Body>
        </TabsContent>
      </Tabs>
    </Panel>
  );
}

export function SixToolBar() {
  return (
    <Panel>
      <Tabs defaultValue="semantic-scholar">
        <TabsList aria-label="All tools" className="grid h-auto w-full grid-cols-3 gap-1">
          <TabsTrigger value="json" className="min-w-0 truncate">
            JSON
          </TabsTrigger>
          <TabsTrigger value="arxiv" className="min-w-0 truncate">
            arXiv
          </TabsTrigger>
          <TabsTrigger value="semantic-scholar" className="min-w-0 truncate">
            Scholar
          </TabsTrigger>
          <TabsTrigger value="colpali" className="min-w-0 truncate">
            ColPali
          </TabsTrigger>
          <TabsTrigger value="library" className="min-w-0 truncate">
            Library
          </TabsTrigger>
          <TabsTrigger value="chats" className="min-w-0 truncate">
            Chats
          </TabsTrigger>
        </TabsList>
        <TabsContent value="semantic-scholar">
          <Body>Six tools wrap onto two rows with h-auto and a grid template.</Body>
        </TabsContent>
      </Tabs>
    </Panel>
  );
}
