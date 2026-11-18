import { useState } from 'react';
import { toEditorDoc } from '@/api/content';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { ProposedBlockView, ProposedRewriteView } from '@/components/editor/Review/ProposedBlockView';
import { ChangeView, RevisionRow } from '@/components/panels/HistoryPanel/HistoryPanel';
import { VersionGraphRail } from '@/components/panels/HistoryPanel/VersionGraphRail';
import { buildVersionGraph } from '@/components/panels/HistoryPanel/versionGraph';
import { revisionChange, revisionSummary } from '@/data/documentHistory';
import { coerceBlock } from '@/editor/docOps';
import {
  changeSetsOf,
  contentOf,
  historyOf,
  liveDocument,
  seededChanges,
  FIXTURE_DOCUMENT_ID,
  REVIEW_DOCUMENT_ID,
} from '@/dev/msw/fixtures';
import { itemAt } from '@/lib/itemAt';

function samplePage(id: string) {
  const page = liveDocument(id);
  if (!page) throw new Error('Sample page unavailable');
  return page;
}

export function ReviewExample() {
  const [edit] = useState(() => {
    const page = toEditorDoc(contentOf(samplePage(REVIEW_DOCUMENT_ID)));
    const operation = itemAt(itemAt(changeSetsOf(REVIEW_DOCUMENT_ID), 0).operations, 0);
    const before = page.blocks.find((block) => block.id === operation.block_id);
    const after = coerceBlock(operation.block);
    if (!before || !after) throw new Error('Missing sample rewrite');
    return { before, after };
  });
  return (
    <Tabs defaultValue="changes">
      <TabsList aria-label="Abstract rewrite">
        <TabsTrigger value="changes">Changes</TabsTrigger>
        <TabsTrigger value="before">Original</TabsTrigger>
        <TabsTrigger value="after">Proposed</TabsTrigger>
      </TabsList>
      <TabsContent value="changes">
        <ProposedRewriteView before={edit.before} after={edit.after} block={edit.after} />
      </TabsContent>
      <TabsContent value="before">
        <ProposedBlockView block={edit.before} />
      </TabsContent>
      <TabsContent value="after">
        <ProposedBlockView block={edit.after} />
      </TabsContent>
    </Tabs>
  );
}

export function HistoryExample() {
  const [history] = useState(() => historyOf(samplePage(FIXTURE_DOCUMENT_ID)));
  const revisions = history.revisions.map(revisionSummary);
  const graph = buildVersionGraph(revisions);
  const [selected, setSelected] = useState<string | null>(history.pointer);
  return (
    <ol aria-label="Sample page revisions">
      {revisions.map((revision, index) => {
        const row = itemAt(graph.rows, index);
        const open = revision.revisionId === selected;
        const base = history.contents.get(revision.parentRevisionId ?? '');
        const target = history.contents.get(revision.revisionId);
        const changes = revision.parentRevisionId
          ? seededChanges(revision.parentRevisionId, revision.revisionId).map(revisionChange)
          : [];
        return (
          <li className="flex" key={revision.revisionId}>
            <VersionGraphRail
              row={row}
              laneCount={graph.laneCount}
              isCurrent={revision.revisionId === history.pointer}
            />
            <div className="min-w-0 flex-1">
              <RevisionRow
                revision={revision}
                node={row}
                isCurrent={revision.revisionId === history.pointer}
                isExpanded={open}
                onToggle={() => setSelected(open ? null : revision.revisionId)}
              />
              {open && (
                <div className="space-y-2 border-l border-border py-2 pl-3">
                  {changes.map((change) => (
                    <ChangeView
                      key={change.entityId}
                      change={change}
                      base={
                        base ? (toEditorDoc(base).blocks.find((b) => b.id === change.entityId) ?? null) : null
                      }
                      target={
                        target
                          ? (toEditorDoc(target).blocks.find((b) => b.id === change.entityId) ?? null)
                          : null
                      }
                    />
                  ))}
                  {!base && <p className="text-sm text-muted-foreground">First saved version.</p>}
                </div>
              )}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
