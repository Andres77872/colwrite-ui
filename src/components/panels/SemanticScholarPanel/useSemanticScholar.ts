import { useCallback, useMemo, useState } from 'react';
import { useInfiniteQuery, useMutation } from '@tanstack/react-query';
import {
  assessSemanticScholarClaim,
  getSemanticScholarGraph,
  getSemanticScholarRecommendations,
  searchSemanticScholar,
  type CitationGraphDirection,
  type ClaimAssessment,
  type ResearchGraphEntry,
  type ResearchPaper,
  type SemanticScholarSearchParams,
} from '@/data/semanticScholar';

export type ExplorationMode = CitationGraphDirection | 'recommendations';

export type ExplorationItem = {
  paper: ResearchPaper;
  contexts: string[];
  intents: string[];
  isInfluential: boolean;
};

export type Exploration = {
  source: ResearchPaper;
  mode: ExplorationMode;
  items: ExplorationItem[];
  nextOffset: number | null;
  loading: boolean;
  error: string | null;
};

export type Assessment = {
  claim: string;
  result: ClaimAssessment | null;
  loading: boolean;
  error: string | null;
};

/** The search filters, as typed; parsed into the service contract on submit. */
export type SemanticScholarFilters = {
  year: string;
  minCitationCount: string;
  fieldsOfStudy: string;
  openAccessOnly: boolean;
};

export const NO_FILTERS: SemanticScholarFilters = {
  year: '',
  minCitationCount: '',
  fieldsOfStudy: '',
  openAccessOnly: false,
};

export function activeFilterCount(filters: SemanticScholarFilters): number {
  return [
    Boolean(filters.year.trim()),
    filters.openAccessOnly,
    Boolean(filters.minCitationCount.trim()),
    Boolean(filters.fieldsOfStudy.trim()),
  ].filter(Boolean).length;
}

function graphItem(entry: ResearchGraphEntry): ExplorationItem {
  return {
    paper: entry.paper,
    contexts: entry.contexts,
    intents: entry.intents,
    isInfluential: entry.is_influential,
  };
}

function paperIdentity(paper: ResearchPaper): string {
  return `${paper.provider}:${paper.paper_id}`;
}

function deduplicatePapers(papers: ResearchPaper[]): ResearchPaper[] {
  const seen = new Set<string>();
  return papers.filter((paper) => {
    const identity = paperIdentity(paper);
    if (seen.has(identity)) return false;
    seen.add(identity);
    return true;
  });
}

function commaSeparatedValues(value: string): string[] {
  return value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function searchParams(
  query: string,
  limit: number,
  filters: SemanticScholarFilters,
): SemanticScholarSearchParams {
  const parsedMinimum = Number.parseInt(filters.minCitationCount, 10);
  const selectedFields = commaSeparatedValues(filters.fieldsOfStudy);
  return {
    query,
    limit,
    ...(filters.year.trim() ? { year: filters.year.trim() } : {}),
    ...(filters.openAccessOnly ? { openAccessOnly: true } : {}),
    ...(filters.minCitationCount.trim() && Number.isFinite(parsedMinimum)
      ? { minCitationCount: Math.max(0, parsedMinimum) }
      : {}),
    ...(selectedFields.length ? { fieldsOfStudy: selectedFields } : {}),
  };
}

function failure(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

const researchKeys = {
  search: (params: SemanticScholarSearchParams | null) => ['research', 'semantic-scholar', 'search', params] as const,
  exploration: (paperId: string | null, mode: ExplorationMode | null, limit: number) =>
    ['research', 'semantic-scholar', 'explore', { paperId, mode, limit }] as const,
};

/**
 * Semantic Scholar's search, citation-graph drill-in and claim check.
 *
 * Each is keyed by what it asks, so a slow page, graph or assessment never
 * lands over a newer one: an answer for a search the author has replaced
 * goes to that search's entry, which nothing shows.
 */
export function useSemanticScholar() {
  const [submitted, setSubmitted] = useState<SemanticScholarSearchParams | null>(null);
  const [explored, setExplored] = useState<{ source: ResearchPaper; mode: ExplorationMode } | null>(null);
  const limit = submitted?.limit ?? 20;

  const searchQuery = useInfiniteQuery({
    queryKey: researchKeys.search(submitted),
    queryFn: ({ pageParam }) =>
      submitted ? searchSemanticScholar(pageParam ? { ...submitted, offset: pageParam } : submitted) : Promise.reject(new Error('No search')),
    initialPageParam: 0,
    getNextPageParam: (last) => last.next_offset ?? undefined,
    enabled: submitted !== null,
  });

  const explorationQuery = useInfiniteQuery({
    queryKey: researchKeys.exploration(explored?.source.paper_id ?? null, explored?.mode ?? null, limit),
    queryFn: async ({ pageParam }): Promise<{ items: ExplorationItem[]; nextOffset: number | null }> => {
      if (!explored) throw new Error('Nothing to explore');
      if (explored.mode === 'recommendations') {
        const response = await getSemanticScholarRecommendations({ paperId: explored.source.paper_id, limit });
        return {
          items: response.data.map((paper) => ({ paper, contexts: [], intents: [], isInfluential: false })),
          nextOffset: null,
        };
      }
      const response = await getSemanticScholarGraph({
        paperId: explored.source.paper_id,
        direction: explored.mode,
        limit,
        offset: pageParam,
      });
      return { items: response.data.map(graphItem), nextOffset: response.next_offset };
    },
    initialPageParam: 0,
    getNextPageParam: (last) => last.nextOffset ?? undefined,
    enabled: explored !== null,
  });

  const assessment = useMutation({
    mutationFn: (request: { claim: string; limit: number; year?: string }) => assessSemanticScholarClaim(request),
  });

  const { refetch: refetchSearch, fetchNextPage: fetchMorePapers } = searchQuery;
  const search = useCallback(
    async (query: string, pageLimit: number, filters: SemanticScholarFilters) => {
      const trimmed = query.trim();
      if (!trimmed) return;
      const params = searchParams(trimmed, pageLimit, filters);
      setExplored(null);
      // The same search run again asks the server again.
      if (JSON.stringify(params) === JSON.stringify(submitted)) await refetchSearch();
      else setSubmitted(params);
    },
    [refetchSearch, submitted],
  );

  const pages = searchQuery.data?.pages;
  const results = useMemo(() => deduplicatePapers(pages?.flatMap((page) => page.data) ?? []), [pages]);
  const lastPage = pages?.at(-1);
  const nextOffset = lastPage?.next_offset ?? null;
  const loading = searchQuery.isFetching && !searchQuery.isFetchingNextPage;
  const loadingMore = searchQuery.isFetchingNextPage;

  const loadMore = useCallback(async () => {
    if (!submitted || nextOffset === null || loading || loadingMore) return;
    await fetchMorePapers();
  }, [fetchMorePapers, loading, loadingMore, nextOffset, submitted]);

  const { refetch: refetchExploration, fetchNextPage: fetchMoreExploration } = explorationQuery;
  const explore = useCallback(
    async (source: ResearchPaper, mode: ExplorationMode, append = false) => {
      const same = explored?.source.paper_id === source.paper_id && explored.mode === mode;
      if (append) {
        if (same) await fetchMoreExploration();
        return;
      }
      if (same) await refetchExploration();
      else setExplored({ source, mode });
    },
    [explored, fetchMoreExploration, refetchExploration],
  );

  const closeExploration = useCallback(() => setExplored(null), []);

  const { mutate: runAssessment } = assessment;
  const assess = useCallback(
    async (claimText: string, claimLimit: number, year: string) => {
      const claim = claimText.trim();
      if (!claim) return;
      runAssessment({ claim, limit: Math.min(claimLimit, 12), ...(year.trim() ? { year: year.trim() } : {}) });
    },
    [runAssessment],
  );

  const explorationPages = explorationQuery.data?.pages;
  const exploration: Exploration | null = explored
    ? {
        source: explored.source,
        mode: explored.mode,
        items: explorationPages?.flatMap((page) => page.items) ?? [],
        nextOffset: explorationPages?.at(-1)?.nextOffset ?? null,
        loading: explorationQuery.isFetching,
        error: explorationQuery.isError ? failure(explorationQuery.error, 'Could not load the paper graph') : null,
      }
    : null;

  return {
    results: searchQuery.isError && !searchQuery.isFetchNextPageError ? [] : results,
    submittedQuery: searchQuery.data && submitted ? submitted.query : '',
    total: searchQuery.isError && !searchQuery.isFetchNextPageError ? 0 : (lastPage?.total ?? 0),
    loading,
    loadingMore,
    nextOffset: searchQuery.isError ? null : nextOffset,
    error: searchQuery.isFetchNextPageError
      ? failure(searchQuery.error, 'Could not load more papers')
      : searchQuery.isError
        ? failure(searchQuery.error, 'Search failed')
        : null,
    exploration,
    assessment: assessment.isIdle
      ? null
      : {
          claim: assessment.variables?.claim ?? '',
          result: assessment.data ?? null,
          loading: assessment.isPending,
          error: assessment.isError ? failure(assessment.error, 'Claim assessment failed') : null,
        } satisfies Assessment,
    search,
    loadMore,
    explore,
    closeExploration,
    assess,
  };
}

export type SemanticScholarState = ReturnType<typeof useSemanticScholar>;
