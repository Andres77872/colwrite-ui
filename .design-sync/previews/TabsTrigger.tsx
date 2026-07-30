import { Badge, Tabs, TabsContent, TabsList, TabsTrigger } from 'colwrite-ui';
import { BookOpen, FileCode, MessageSquare } from 'lucide-react';

// TabsTrigger cannot mount alone, so every cell is a full Tabs composition;
// the TRIGGER is what varies — selected vs unselected, disabled, triggers
// carrying an icon and a count, and labels too long for the track.

function Panel({ children }: { children: React.ReactNode }) {
  return (
    <div className="w-full max-w-sm rounded-lg border border-border bg-card p-3">{children}</div>
  );
}

function Body({ children }: { children: React.ReactNode }) {
  return <p className="px-2 py-1.5 text-xs text-muted-foreground">{children}</p>;
}

export function SelectedAndUnselected() {
  return (
    <Panel>
      <Tabs defaultValue="library">
        <TabsList aria-label="Tools">
          <TabsTrigger value="library">Library</TabsTrigger>
          <TabsTrigger value="chats">Chats</TabsTrigger>
          <TabsTrigger value="json">JSON</TabsTrigger>
        </TabsList>
        <TabsContent value="library">
          <Body>
            Selected lifts to the background surface with foreground text and a small shadow;
            the rest stay muted on the trough.
          </Body>
        </TabsContent>
      </Tabs>
    </Panel>
  );
}

export function DisabledTrigger() {
  return (
    <Panel>
      <Tabs defaultValue="chats">
        <TabsList aria-label="Tools">
          <TabsTrigger value="chats">Chats</TabsTrigger>
          <TabsTrigger value="library">Library</TabsTrigger>
          <TabsTrigger value="json" disabled>
            JSON
          </TabsTrigger>
        </TabsList>
        <TabsContent value="chats">
          <Body>
            Document JSON is disabled until the draft has been saved once — 50% opacity, no
            pointer events, and arrow keys skip it.
          </Body>
        </TabsContent>
      </Tabs>
    </Panel>
  );
}

export function WithIconAndCount() {
  return (
    <Panel>
      <Tabs defaultValue="chats">
        <TabsList aria-label="Tools" className="h-auto">
          <TabsTrigger value="library" className="gap-1.5">
            <BookOpen className="h-3.5 w-3.5" />
            Library
            <Badge variant="secondary" className="ml-1 px-1.5 py-0 text-2xs tabular-nums">
              12
            </Badge>
          </TabsTrigger>
          <TabsTrigger value="chats" className="gap-1.5">
            <MessageSquare className="h-3.5 w-3.5" />
            Chats
            <Badge variant="secondary" className="ml-1 px-1.5 py-0 text-2xs tabular-nums">
              3
            </Badge>
          </TabsTrigger>
          <TabsTrigger value="json" className="gap-1.5">
            <FileCode className="h-3.5 w-3.5" />
            JSON
          </TabsTrigger>
        </TabsList>
        <TabsContent value="chats">
          <Body>The base class sets no gap — icons and counts need one explicitly.</Body>
        </TabsContent>
      </Tabs>
    </Panel>
  );
}

export function LongLabels() {
  return (
    <Panel>
      <Tabs defaultValue="semantic-scholar">
        <TabsList aria-label="Search tools" className="grid w-full grid-cols-2">
          <TabsTrigger value="semantic-scholar" className="min-w-0 truncate">
            Semantic Scholar
          </TabsTrigger>
          <TabsTrigger value="colpali" className="min-w-0 truncate">
            ColPali page search
          </TabsTrigger>
        </TabsList>
        <TabsContent value="semantic-scholar">
          <Body>
            Labels never wrap (whitespace-nowrap). In a 320px panel add min-w-0 truncate, or
            shorten the label — the bar will otherwise push past the panel edge.
          </Body>
        </TabsContent>
      </Tabs>
    </Panel>
  );
}
