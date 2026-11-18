import { useState } from 'react';
import { DestinationTree } from '@/components/collections/MoveToDialog';
import type { WorkspaceTree } from '@/components/layout/Sidebar/PagesTree/useWorkspaceTree';
import { ActivityChart } from '@/components/profile/ActivityChart';
import { WorkspaceUsageTable } from '@/components/profile/WorkspaceUsageTable';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { ChatMarkdown } from '@/components/editor/ChatAssistant/ChatMarkdown';
import { AnswerSources } from '@/components/editor/ChatAssistant/AnswerSources';
import { useSourceMarkers } from '@/components/editor/ChatAssistant/answerSourceMarkers';
import { ReplyDetails } from '@/components/editor/ChatAssistant/ReplyDetails';
import { replyMetaOf } from '@/components/editor/ChatAssistant/replyMeta';
import { TaskList } from '@/components/editor/ChatAssistant/TaskList';
import { historyMessages } from '@/components/editor/ChatAssistant/chatUtils';
import {
  accountUsageOf,
  chatsOf,
  collectionSummary,
  orderedCollections,
  pagesHomedIn,
  workspaceCollection,
  TREE,
  FIXTURE_DOCUMENT_ID,
  PERSONAL_WORKSPACE_ID,
  usageOf,
} from '@/dev/msw/fixtures';

export function AssistantExample() {
  const [transcript] = useState(() => {
    const chat = chatsOf(FIXTURE_DOCUMENT_ID).find((entry) => entry.id === 'chat-related');
    if (!chat) throw new Error('Missing sample chat');
    const messages = historyMessages(chat.messages);
    const question = messages.find((item) => item.role === 'user');
    const reply = messages.find((item) => item.role === 'assistant');
    if (!question || !reply) throw new Error('Missing recorded exchange');
    return { question, reply };
  });
  const { question, reply } = transcript;
  const sources = reply.sources ?? [];
  const { markers } = useSourceMarkers(reply.id, reply.content, sources);
  return (
    <div className="space-y-4">
      <p className="ml-auto w-fit max-w-[90%] rounded-xl bg-subtle px-3 py-2 text-sm">{question.content}</p>
      <ChatMarkdown text={reply.content} sources={markers} />
      <AnswerSources messageId={reply.id} text={reply.content} sources={sources} known={sources} />
      {reply.todos && <TaskList items={reply.todos} />}
      <ReplyDetails meta={replyMetaOf(reply)} />
    </div>
  );
}

function CollectionExample() {
  const [selected, setSelected] = useState<number | null>(TREE.chapter2);
  const [expanded, setExpanded] = useState<ReadonlySet<number>>(() => new Set([TREE.thesis]));
  const [pageSizes, setPageSizes] = useState<Map<number | null, number>>(() => new Map());
  const tree: Pick<WorkspaceTree, 'branch' | 'findCollection' | 'isExpanded' | 'setExpanded' | 'loadMore'> = {
    branch: (parentId) => {
      const collections = orderedCollections(PERSONAL_WORKSPACE_ID, parentId);
      const limit = pageSizes.get(parentId) ?? 4;
      return {
        parentId,
        collections: collections.slice(0, limit).map((row) => collectionSummary(row)),
        pages: [],
        sortMode: null,
        loaded: true,
        loading: false,
        moreCollections: collections.length > limit,
        morePages: false,
        loadingMore: null,
        error: null,
      };
    },
    findCollection: (id) => {
      const row = workspaceCollection(PERSONAL_WORKSPACE_ID, id);
      return row && collectionSummary(row);
    },
    isExpanded: (id) => expanded.has(id),
    setExpanded: (id, open) =>
      setExpanded((current) => {
        const next = new Set(current);
        if (open) next.add(id);
        else next.delete(id);
        return next;
      }),
    loadMore: async (id) => {
      setPageSizes((current) => new Map(current).set(id, (current.get(id) ?? 4) + 4));
    },
  };
  const rows = pagesHomedIn(PERSONAL_WORKSPACE_ID, selected);
  return (
    <>
      <DestinationTree
        tree={tree}
        selected={selected}
        disabledIds={new Set()}
        home={null}
        ariaLabel="Sample collections"
        onSelect={(id) => setSelected(id)}
      />
      {selected !== null && (
        <div className="mt-3 border-t border-border pt-3">
          <h2 className="text-sm font-semibold">{tree.findCollection(selected)?.name}</h2>
          {rows.length ? (
            <ul className="mt-1 space-y-1 text-sm">
              {rows.map((page) => (
                <li key={page._id}>{page.name}</li>
              ))}
            </ul>
          ) : (
            <p className="mt-1 text-sm text-muted-foreground">No pages in this collection.</p>
          )}
        </div>
      )}
    </>
  );
}

export function WorkspaceExample() {
  const [usage] = useState(() => usageOf(PERSONAL_WORKSPACE_ID, 30));
  const [all] = useState(() => accountUsageOf(30));
  return (
    <Tabs defaultValue="collections">
      <TabsList aria-label="Workspace example">
        <TabsTrigger value="collections">Collections</TabsTrigger>
        <TabsTrigger value="personal">Activity</TabsTrigger>
        <TabsTrigger value="all">All workspaces</TabsTrigger>
      </TabsList>
      <TabsContent value="collections">
        <CollectionExample />
      </TabsContent>
      <TabsContent value="personal">
        <ActivityChart activity={usage.activity} days={30} throughDay={usage.activity.at(-1)?.day} />
      </TabsContent>
      <TabsContent value="all">
        <WorkspaceUsageTable workspaces={all.workspaces} />
      </TabsContent>
    </Tabs>
  );
}
