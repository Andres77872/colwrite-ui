import { useCallback, useRef, useState } from 'react';
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
} from '@/services/semanticScholar';

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

/**
 * Semantic Scholar's search, citation-graph drill-in and claim check.
 *
 * Every request carries a sequence number and only the newest of each kind
 * may land, so a slow page, graph or assessment never overwrites a newer one.
 */
export function useSemanticScholar() {
  const [results, setResults] = useState<ResearchPaper[]>([]);
  const [submittedQuery, setSubmittedQuery] = useState('');
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [nextOffset, setNextOffset] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [exploration, setExploration] = useState<Exploration | null>(null);
  const [assessment, setAssessment] = useState<Assessment | null>(null);
  const requestSequence = useRef(0);
  const activeSearch = useRef<SemanticScholarSearchParams | null>(null);
  const explorationSequence = useRef(0);
  const assessmentSequence = useRef(0);
  const limitRef = useRef(20);

  const search = useCallback(
    async (query: string, limit: number, filters: SemanticScholarFilters) => {
      const trimmed = query.trim();
      if (!trimmed) return;
      const params = searchParams(trimmed, limit, filters);
      const sequence = ++requestSequence.current;
      activeSearch.current = params;
      limitRef.current = limit;
      setLoading(true);
      setLoadingMore(false);
      setNextOffset(null);
      setError(null);
      explorationSequence.current += 1;
      setExploration(null);
      try {
        const response = await searchSemanticScholar(params);
        if (requestSequence.current !== sequence) return;
        setResults(deduplicatePapers(response.data));
        setTotal(response.total);
        setNextOffset(response.next_offset);
        setSubmittedQuery(trimmed);
      } catch (err) {
        if (requestSequence.current !== sequence) return;
        activeSearch.current = null;
        setError(err instanceof Error ? err.message : 'Search failed');
        setResults([]);
        setTotal(0);
        setNextOffset(null);
      } finally {
        if (requestSequence.current === sequence) setLoading(false);
      }
    },
    [],
  );

  const loadMore = useCallback(async () => {
    const params = activeSearch.current;
    const offset = nextOffset;
    if (!params || offset === null || loading || loadingMore) return;
    const sequence = ++requestSequence.current;
    setLoadingMore(true);
    setError(null);
    try {
      const response = await searchSemanticScholar({ ...params, offset });
      if (requestSequence.current !== sequence) return;
      setResults((current) => deduplicatePapers([...current, ...response.data]));
      setTotal(response.total);
      setNextOffset(response.next_offset);
    } catch (err) {
      if (requestSequence.current !== sequence) return;
      setError(err instanceof Error ? err.message : 'Could not load more papers');
    } finally {
      if (requestSequence.current === sequence) setLoadingMore(false);
    }
  }, [loading, loadingMore, nextOffset]);

  const explore = useCallback(
    async (source: ResearchPaper, mode: ExplorationMode, append = false) => {
      const sequence = ++explorationSequence.current;
      const current =
        exploration?.source.paper_id === source.paper_id && exploration.mode === mode
          ? exploration
          : null;
      const offset = append ? current?.nextOffset : 0;
      if (append && offset === null) return;
      const limit = limitRef.current;

      setExploration({
        source,
        mode,
        items: append ? current?.items ?? [] : [],
        nextOffset: append ? current?.nextOffset ?? null : null,
        loading: true,
        error: null,
      });

      try {
        if (mode === 'recommendations') {
          const response = await getSemanticScholarRecommendations({
            paperId: source.paper_id,
            limit,
          });
          if (explorationSequence.current !== sequence) return;
          setExploration({
            source,
            mode,
            items: response.data.map((paper) => ({
              paper,
              contexts: [],
              intents: [],
              isInfluential: false,
            })),
            nextOffset: null,
            loading: false,
            error: null,
          });
          return;
        }

        const response = await getSemanticScholarGraph({
          paperId: source.paper_id,
          direction: mode,
          limit,
          offset: offset ?? 0,
        });
        if (explorationSequence.current !== sequence) return;
        setExploration({
          source,
          mode,
          items: [...(append ? current?.items ?? [] : []), ...response.data.map(graphItem)],
          nextOffset: response.next_offset,
          loading: false,
          error: null,
        });
      } catch (err) {
        if (explorationSequence.current !== sequence) return;
        setExploration({
          source,
          mode,
          items: append ? current?.items ?? [] : [],
          nextOffset: append ? current?.nextOffset ?? null : null,
          loading: false,
          error: err instanceof Error ? err.message : 'Could not load the paper graph',
        });
      }
    },
    [exploration],
  );

  const closeExploration = useCallback(() => {
    explorationSequence.current += 1;
    setExploration(null);
  }, []);

  const assess = useCallback(async (claimText: string, limit: number, year: string) => {
    const claim = claimText.trim();
    if (!claim) return;
    const sequence = ++assessmentSequence.current;
    setAssessment({ claim, result: null, loading: true, error: null });
    try {
      const result = await assessSemanticScholarClaim({
        claim,
        limit: Math.min(limit, 12),
        ...(year.trim() ? { year: year.trim() } : {}),
      });
      if (assessmentSequence.current !== sequence) return;
      setAssessment({ claim, result, loading: false, error: null });
    } catch (err) {
      if (assessmentSequence.current !== sequence) return;
      setAssessment({
        claim,
        result: null,
        loading: false,
        error: err instanceof Error ? err.message : 'Claim assessment failed',
      });
    }
  }, []);

  return {
    results,
    submittedQuery,
    total,
    loading,
    loadingMore,
    nextOffset,
    error,
    exploration,
    assessment,
    search,
    loadMore,
    explore,
    closeExploration,
    assess,
  };
}

export type SemanticScholarState = ReturnType<typeof useSemanticScholar>;
