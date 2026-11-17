import { useState } from 'react';
import { useInfiniteQuery } from '@tanstack/react-query';
import { ArrowLeft, GitFork, Network, Quote, SearchX, Sparkles } from 'lucide-react';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { DropdownMenuItem } from '@/components/ui/dropdown-menu';
import { EmptyState } from '@/components/ui/empty-state';
import { ListSkeleton } from '@/components/ui/list-skeleton';
import { Spinner } from '@/components/ui/spinner';
import { cn } from '@/lib/utils';
import { referenceTitle } from '@/editor';
import { useWorkspaceId } from '@/components/workspace/workspaceContextState';
import {
  PAPER_SOURCE_NAMES,
  paperFailure,
  paperGraphQuery,
  paperSearchQuery,
  type Paper,
  type PaperRelation,
  type PaperSearchParams,
} from '@/data/papers';
import { Disclosure, PaperRow } from '../shared';

/**
 * The list under the query row: a stale list fades while a new search runs
 * instead of reading as the answer to the new query.
 */
export function ResultList({
  loading,
  count,
  summary,
  children,
}: {
  loading: boolean;
  count: number;
  summary: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div aria-busy={loading} className="flex flex-col gap-1">
      {count > 0 && (
        <p className="px-2 text-xs text-muted-foreground" aria-live="polite">
          {summary}
        </p>
      )}
      {loading && count === 0 && <ListSkeleton rows={3} />}
      <div className={cn('flex flex-col', loading && count > 0 && 'pointer-events-none opacity-50 transition-opacity')}>
        {children}
      </div>
    </div>
  );
}

const RELATION_LABELS: Record<PaperRelation, string> = {
  citations: 'Papers that cite this work',
  references: 'References used by this work',
  related: 'Related papers',
};

/** What the sources asked require of a page of their results: credit, and which could not answer. */
function SourceNotes({ attribution, failed }: { attribution: readonly string[]; failed: readonly Paper['foundBy'][number][] }) {
  if (attribution.length === 0 && failed.length === 0) return null;
  return (
    <div className="space-y-0.5 px-2 text-2xs text-muted-foreground">
      {failed.length > 0 && (
        <p role="status">
          {failed.map((id) => PAPER_SOURCE_NAMES[id]).join(', ').replace(/^./, (c) => c.toUpperCase())} could not be reached, so
          {failed.length === 1 ? ' its' : ' their'} results are missing.
        </p>
      )}
      {attribution.map((line) => (
        <p key={line} aria-label="Provider attribution">{line}</p>
      ))}
    </div>
  );
}

function GraphMenu({ onExplore }: { onExplore: (relation: PaperRelation) => void }) {
  return (
    <>
      <DropdownMenuItem onSelect={() => onExplore('citations')}>
        <Quote aria-hidden="true" />
        Papers citing this
      </DropdownMenuItem>
      <DropdownMenuItem onSelect={() => onExplore('references')}>
        <GitFork aria-hidden="true" />
        Its references
      </DropdownMenuItem>
      <DropdownMenuItem onSelect={() => onExplore('related')}>
        <Sparkles aria-hidden="true" />
        Related papers
      </DropdownMenuItem>
    </>
  );
}

function CitationContexts({ contexts, paperTitle }: { contexts: string[]; paperTitle: string }) {
  if (contexts.length === 0) return null;
  return (
    <Disclosure
      className="text-xs"
      triggerClassName="text-muted-foreground"
      label={`Show ${contexts.length} citation context${contexts.length === 1 ? '' : 's'} for ${paperTitle}`}
      summary={`Citation contexts (${contexts.length})`}
    >
      <ol className="mt-1 max-h-32 list-decimal space-y-1 overflow-y-auto pl-5 pr-1 text-foreground/80">
        {contexts.map((context, index) => (
          <li key={`${index}:${context}`}>
            <blockquote className="leading-relaxed">“{context}”</blockquote>
          </li>
        ))}
      </ol>
    </Disclosure>
  );
}

/** One work's citation graph, as a drill-in with a way back. */
function GraphView({ seed, relation, limit, onClose }: { seed: Paper; relation: PaperRelation; limit: number; onClose: () => void }) {
  const workspaceId = useWorkspaceId();
  const graph = useInfiniteQuery(paperGraphQuery(workspaceId, seed.record.key, relation, limit));
  const label = RELATION_LABELS[relation];
  const pages = graph.data?.pages ?? [];
  const items = pages.flatMap((page) => page.items);
  const last = pages.at(-1);
  return (
    <section aria-label={label} className="flex flex-col gap-1">
      <div className="flex items-start gap-1 px-1">
        <Button variant="icon" size="icon-sm" onClick={onClose} aria-label={`Close ${label} for ${referenceTitle(seed.record)}`}>
          <ArrowLeft aria-hidden="true" />
        </Button>
        <div className="min-w-0 pt-1">
          <h3 className="text-sm font-medium">{label}</h3>
          <p className="truncate text-xs text-muted-foreground">{referenceTitle(seed.record)}</p>
        </div>
      </div>
      {graph.error && <Alert role="alert" className="mx-2">{paperFailure(graph.error)}</Alert>}
      {items.map((item, index) => (
        <PaperRow key={`${item.record.key}:${index}`} paper={item}>
          {item.influential && <p className="font-medium text-foreground">Influential citation</p>}
          {item.intents.length > 0 && <p>Citation intent: {item.intents.join(', ')}</p>}
          <CitationContexts contexts={item.contexts} paperTitle={referenceTitle(item.record)} />
        </PaperRow>
      ))}
      {graph.isPending && (
        <div className="flex items-center justify-center gap-2 py-6 text-xs text-muted-foreground">
          <Spinner />
          Loading papers…
        </div>
      )}
      {!graph.isPending && !graph.error && items.length === 0 && (
        <p className="py-4 text-center text-sm text-muted-foreground">No papers were returned.</p>
      )}
      {graph.hasNextPage && items.length > 0 && (
        <Button
          variant="ghost"
          size="sm"
          className="mx-2 text-muted-foreground"
          disabled={graph.isFetchingNextPage}
          aria-busy={graph.isFetchingNextPage || undefined}
          onClick={() => void graph.fetchNextPage()}
        >
          {graph.isFetchingNextPage && <Spinner />}
          {graph.isFetchingNextPage ? 'Loading more…' : 'Load more'}
        </Button>
      )}
      {last && <SourceNotes attribution={last.attribution} failed={last.failed} />}
    </section>
  );
}

/**
 * Paper search: the workspace's paper route, over every source the account
 * and the workspace allow, one row per work, and each work's graph behind
 * its "…".
 */
export function PaperResults({ params }: { params: Omit<PaperSearchParams, 'cursor'> | null }) {
  const workspaceId = useWorkspaceId();
  const [exploring, setExploring] = useState<{ seed: Paper; relation: PaperRelation } | null>(null);
  const search = useInfiniteQuery({
    ...paperSearchQuery(workspaceId, params ?? { query: '' }),
    enabled: params !== null,
  });
  const [explored, setExplored] = useState(params);
  if (explored !== params) {
    // A new search closes the graph it was opened from.
    setExplored(params);
    setExploring(null);
  }

  if (exploring) {
    return (
      <GraphView
        seed={exploring.seed}
        relation={exploring.relation}
        limit={params?.limit ?? 20}
        onClose={() => setExploring(null)}
      />
    );
  }

  const pages = search.data?.pages ?? [];
  const results = pages.flatMap((page) => page.items);
  const last = pages.at(-1);
  const loading = params !== null && search.isFetching && !search.isFetchingNextPage;
  return (
    <div className="flex flex-col gap-2">
      {search.error && <Alert className="mx-2">{paperFailure(search.error)}</Alert>}
      <ResultList
        loading={loading}
        count={results.length}
        summary={`${results.length} paper${results.length === 1 ? '' : 's'}${search.hasNextPage ? ', more available' : ''}`}
      >
        {results.map((paper) => (
          <PaperRow
            key={paper.record.key}
            paper={paper}
            menuItems={<GraphMenu onExplore={(relation) => setExploring({ seed: paper, relation })} />}
          />
        ))}
      </ResultList>

      {results.length > 0 && search.hasNextPage && (
        <Button
          variant="ghost"
          size="sm"
          className="mx-2 text-muted-foreground"
          onClick={() => void search.fetchNextPage()}
          disabled={search.isFetchingNextPage}
          aria-busy={search.isFetchingNextPage || undefined}
        >
          {search.isFetchingNextPage && <Spinner />}
          {search.isFetchingNextPage ? 'Loading more papers…' : 'Load more papers'}
        </Button>
      )}

      {params !== null && !loading && !search.error && results.length === 0 && (
        <EmptyState
          icon={SearchX}
          title="No papers found"
          description={`Nothing matched “${params.query}”. Try broader keywords or fewer filters.`}
        />
      )}
      {params === null && (
        <EmptyState
          icon={Network}
          title="Search papers"
          description="One search over OpenAlex, the arXiv index and Semantic Scholar, as your settings allow. Follow who cites a paper, and cite it."
        />
      )}
      {last && <SourceNotes attribution={last.attribution} failed={last.failed} />}
    </div>
  );
}
