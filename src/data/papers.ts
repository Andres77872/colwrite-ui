import { infiniteQueryOptions } from '@tanstack/react-query';
import { api, unwrap } from '@/api/client';
import { toEditorRecord } from '@/api/content';
import { problemCode } from '@/api/errors';
import type {
  Paper as WirePaper,
  PaperGraphResponse,
  PaperPassagesResponse,
  PaperSearchResponse,
  operations,
} from '@/api/schema';
import type { ReferenceRecord } from '@/editor/types';

/* ----------------------------------------
   Paper search (`ColWrite-api/docs/providers.md#the-paper-tools-and-routes`)

   The Research panel and the citation picker search the same workspace
   routes the assistant's `paper_search`, `paper_get` and `paper_graph` run:
   every paper source the account and the workspace allow (OpenAlex, the
   arXiv index, Semantic Scholar), asked together and merged by identifier,
   so one work is one result with one reference record. That record is what
   a result cites and adds to the library, exactly as a reply's source does.
   ---------------------------------------- */

export type PaperSourceId = WirePaper['found_by'][number];

/** One work a paper route returned: its reference, and what the sources said about it. */
export type Paper = {
  record: ReferenceRecord;
  abstract: string | null;
  citationCount: number | null;
  referenceCount: number | null;
  /** An open-access copy: its landing page, PDF and licence. */
  openAccess: { url: string | null; pdfUrl: string | null; license: string | null } | null;
  /** The paper sources that returned it. */
  foundBy: PaperSourceId[];
};

/** A page of results, with the sources asked and any that failed. */
export type PaperPage = {
  items: Paper[];
  nextCursor: string | null;
  /** Credit a source requires where its data is shown (Semantic Scholar). */
  attribution: string[];
  /** The sources that could not answer; the others' results are still here. */
  failed: PaperSourceId[];
  /** Parts of the query a source could not apply. */
  ignored: string[];
};

/** A paper route's work, with its reference as the editor holds it. */
export function paperOf(paper: WirePaper): Paper {
  return {
    record: toEditorRecord(paper.record),
    abstract: paper.abstract,
    citationCount: paper.citation_count,
    referenceCount: paper.reference_count,
    openAccess: paper.open_access
      ? { url: paper.open_access.url, pdfUrl: paper.open_access.pdf_url, license: paper.open_access.license }
      : null,
    foundBy: paper.found_by,
  };
}

function pageOf(response: PaperSearchResponse | PaperGraphResponse, items: Paper[]): PaperPage {
  return {
    items,
    nextCursor: response.next_cursor,
    attribution: response.attribution,
    failed: response.failed.map((failure) => failure.provider),
    ignored: 'ignored' in response ? response.ignored : [],
  };
}

type SearchQuery = operations['papers-search_papers']['parameters']['query'];

export type PaperSearchParams = {
  query: string;
  yearFrom?: number | null;
  yearTo?: number | null;
  kind?: SearchQuery['kind'];
  openAccessOnly?: boolean;
  sort?: SearchQuery['sort'];
  limit?: number;
  cursor?: string | null;
};

/** `GET /workspaces/{w}/papers/search`: the search `paper_search` runs. */
export async function searchPapers(
  workspaceId: string,
  params: PaperSearchParams,
  init?: { signal?: AbortSignal },
): Promise<PaperPage> {
  const response = await unwrap(api.GET('/workspaces/{workspace_id}/papers/search', {
    params: {
      path: { workspace_id: workspaceId },
      query: {
        query: params.query.trim(),
        ...(params.yearFrom ? { year_from: params.yearFrom } : {}),
        ...(params.yearTo ? { year_to: params.yearTo } : {}),
        ...(params.kind && params.kind !== 'any' ? { kind: params.kind } : {}),
        ...(params.openAccessOnly ? { open_access_only: true } : {}),
        ...(params.sort && params.sort !== 'relevance' ? { sort: params.sort } : {}),
        ...(params.limit ? { limit: params.limit } : {}),
        ...(params.cursor ? { cursor: params.cursor } : {}),
      },
    },
    signal: init?.signal,
  }));
  return pageOf(response, response.items.map(paperOf));
}

export type PaperRelation = operations['papers-paper_graph']['parameters']['query']['relation'];

/** A graph result: the work, and how the seed cites it or is cited by it. */
export type PaperLink = Paper & { contexts: string[]; intents: string[]; influential: boolean | null };
export type PaperGraphPage = Omit<PaperPage, 'items'> & { items: PaperLink[]; relation: PaperRelation };

/** `GET /workspaces/{w}/papers/{key}/graph`: a work's references, citations or related works. */
export async function getPaperGraph(
  workspaceId: string,
  key: string,
  params: { relation: PaperRelation; limit?: number; cursor?: string | null },
  init?: { signal?: AbortSignal },
): Promise<PaperGraphPage> {
  const response = await unwrap(api.GET('/workspaces/{workspace_id}/papers/{key}/graph', {
    params: {
      path: { workspace_id: workspaceId, key },
      query: {
        relation: params.relation,
        ...(params.limit ? { limit: params.limit } : {}),
        ...(params.cursor ? { cursor: params.cursor } : {}),
      },
    },
    signal: init?.signal,
  }));
  const items = response.items.map((item) => ({
    ...paperOf(item.paper),
    contexts: item.contexts,
    intents: item.intents,
    influential: item.influential,
  }));
  return { ...pageOf(response, items), items, relation: response.relation };
}

/** `GET /workspaces/{w}/papers/{key}`: one work with its status, `key` with its scheme. */
export async function getPaper(workspaceId: string, key: string, init?: { signal?: AbortSignal }): Promise<Paper> {
  const response = await unwrap(api.GET('/workspaces/{workspace_id}/papers/{key}', {
    params: { path: { workspace_id: workspaceId, key } },
    signal: init?.signal,
  }));
  return paperOf(response.paper);
}

/** A passage of a paper's text that bears on a question, with how much of the work the source held behind it. */
export type PaperPassage = {
  paper: Paper;
  text: string;
  level: PaperPassagesResponse['items'][number]['level'];
  section: string | null;
  page: number | null;
};

/**
 * `GET /workspaces/{w}/papers/passages`: what `paper_passages` runs, the
 * passages of papers' text about `query` (at most 500 characters), from
 * `papers` (identifiers with their scheme) when given.
 */
export async function searchPassages(
  workspaceId: string,
  query: string,
  options: { papers?: readonly string[]; limit?: number } = {},
  init?: { signal?: AbortSignal },
): Promise<Omit<PaperPage, 'items' | 'nextCursor'> & { items: PaperPassage[] }> {
  const response = await unwrap(api.GET('/workspaces/{workspace_id}/papers/passages', {
    params: {
      path: { workspace_id: workspaceId },
      query: {
        query: query.trim().slice(0, 500),
        ...(options.papers?.length ? { papers: [...options.papers] } : {}),
        ...(options.limit ? { limit: options.limit } : {}),
      },
    },
    signal: init?.signal,
  }));
  return {
    items: response.items.map((item) => ({
      paper: paperOf(item.paper), text: item.text, level: item.level, section: item.section ?? null, page: item.page ?? null,
    })),
    attribution: response.attribution,
    failed: response.failed.map((failure) => failure.provider),
    ignored: response.ignored,
  };
}

export const paperKeys = {
  all: (workspaceId: string) => ['ws', workspaceId, 'research', 'papers'] as const,
  search: (workspaceId: string, params: Omit<PaperSearchParams, 'cursor'>) =>
    [...paperKeys.all(workspaceId), 'search', params] as const,
  graph: (workspaceId: string, key: string, relation: PaperRelation, limit: number) =>
    [...paperKeys.all(workspaceId), 'graph', key, relation, limit] as const,
};

/** A search, a page at a time. */
export function paperSearchQuery(workspaceId: string, params: Omit<PaperSearchParams, 'cursor'>) {
  return infiniteQueryOptions({
    queryKey: paperKeys.search(workspaceId, params),
    queryFn: ({ pageParam, signal }) => searchPapers(workspaceId, { ...params, cursor: pageParam }, { signal }),
    initialPageParam: null as string | null,
    getNextPageParam: (page) => page.nextCursor,
    staleTime: 5 * 60_000,
  });
}

/** A work's graph, a page at a time. */
export function paperGraphQuery(workspaceId: string, key: string, relation: PaperRelation, limit: number) {
  return infiniteQueryOptions({
    queryKey: paperKeys.graph(workspaceId, key, relation, limit),
    queryFn: ({ pageParam, signal }) => getPaperGraph(workspaceId, key, { relation, limit, cursor: pageParam }, { signal }),
    initialPageParam: null as string | null,
    getNextPageParam: (page) => page.nextCursor,
    staleTime: 5 * 60_000,
  });
}

/**
 * Why a paper route refused, in the author's words. The workspace's policy
 * decides first, then the account's Papers switch and its sources, then the
 * server; the sources' own failures are worth a retry.
 */
export function paperFailure(error: unknown, fallback = 'Paper search failed. Try again.'): string {
  switch (problemCode(error)) {
    case 'workspace_policy':
      return 'Outside research is switched off in this workspace, so papers are not searched here.';
    case 'paper_source_disabled':
      return 'Paper search is switched off in your settings. Turn on Papers and a paper source in Settings → AI & tools.';
    case 'paper_source_unavailable':
      return 'No paper source is available on this server.';
    case 'paper_not_found':
      return 'No paper source knows that work.';
    case 'unrecognized_identifier':
      return 'That is not an identifier a paper source reads.';
    case 'invalid_cursor':
      return 'These results are out of date. Search again.';
    case 'provider_rate_limited':
      return 'The paper sources are busy. Try again in a moment.';
    case 'provider_unavailable':
    case 'provider_failed':
      return 'The paper sources could not be reached. Try again in a moment.';
    default:
      return error instanceof Error && error.message ? error.message : fallback;
  }
}

/** The paper sources by name, for a result's "Found by" and the panel's credit. */
export const PAPER_SOURCE_NAMES: Record<PaperSourceId, string> = {
  openalex: 'OpenAlex',
  arxiv_index: 'the arXiv index',
  semantic_scholar: 'Semantic Scholar',
};
