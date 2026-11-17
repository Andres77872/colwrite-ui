import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { ArrowRight, FileSearch, Search, SlidersHorizontal, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { EmptyState } from '@/components/ui/empty-state';
import { Input } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { NativeSelect } from '@/components/ui/select';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { useAssistantCatalog } from '@/components/preferences';
import { useBibliography } from '@/editor';
import { MAX_CLAIM_SOURCES } from '@/data/claims';
import { cn } from '@/lib/utils';
import { usePanels, type ResearchSourceId } from '../panelsContextState';
import { RESEARCH_SOURCE_IDS, RESEARCH_SOURCES } from '../sidebarPanels';
import type { PaperSearchParams } from '@/data/papers';
import { PaperResults } from './PaperResults';
import { ClaimCheckResults, type ClaimRequest } from './ClaimCheckResults';

/** A key a claim check can name: an identifier with its scheme. */
const CHECKABLE = /^(doi|arxiv|pmid|pmcid|openalex|s2|corpusid):\S/i;

const RESULT_LIMITS = [10, 20, 30, 40, 50] as const;

/** The search's filters, as the paper route takes them. */
type PaperFilters = {
  yearFrom: string;
  yearTo: string;
  kind: NonNullable<PaperSearchParams['kind']>;
  sort: NonNullable<PaperSearchParams['sort']>;
  openAccessOnly: boolean;
};

const NO_FILTERS: PaperFilters = { yearFrom: '', yearTo: '', kind: 'any', sort: 'relevance', openAccessOnly: false };

function activeFilterCount(filters: PaperFilters): number {
  return [filters.yearFrom.trim(), filters.yearTo.trim(), filters.kind !== 'any', filters.sort !== 'relevance', filters.openAccessOnly]
    .filter(Boolean).length;
}

function yearOf(value: string): number | null {
  const year = Number(value.trim());
  return Number.isInteger(year) && year >= 1000 && year <= 2200 ? year : null;
}

/**
 * ResearchPanel — one search box over the paper sources.
 *
 * The query is typed once and the source is a switch under it. Paper search
 * is the workspace's paper route, which asks every paper source the account
 * and the workspace allow and merges what they return, so a paper reads the
 * same here as in the citation picker and the assistant's replies (P2.UI-2).
 *
 * "Inside my PDFs" is not searched here: it hands the query to the Library,
 * which owns the one PDF search and shows its matches where each PDF can be
 * read, moved and used.
 */
export function ResearchPanel() {
  const { researchSource, setResearchSource, intent, openSidebar, setPanel } = usePanels();
  const { papers } = useAssistantCatalog();
  const [query, setQuery] = useState('');
  const [limit, setLimit] = useState(20);
  const [filters, setFilters] = useState<PaperFilters>(NO_FILTERS);
  const [submitted, setSubmitted] = useState<Omit<PaperSearchParams, 'cursor'> | null>(null);
  const [claimRequest, setClaimRequest] = useState<ClaimRequest | null>(null);
  const claimId = useRef(0);
  // The page's cited works a claim can be judged against, by identifier.
  const { entries } = useBibliography();
  const citedKeys = entries.map((entry) => entry.key).filter((key) => CHECKABLE.test(key)).slice(0, MAX_CLAIM_SOURCES);
  const [againstPage, setAgainstPage] = useState(false);

  const enabled = (id: ResearchSourceId) => !RESEARCH_SOURCES[id].needsPapers || papers.on;
  // A persisted choice can outlive the setting that allowed it.
  const source = enabled(researchSource)
    ? researchSource
    : RESEARCH_SOURCE_IDS.find(enabled) ?? 'pdfs';

  const checkClaim = (claim: string, sources: string[]) => {
    claimId.current += 1;
    setClaimRequest({ id: claimId.current, claim, sources, at: Date.now() });
  };



  /** Run the box's text on the source shown, or on `claim` (a claim handed over, with its works). */
  const run = (text: string, claim?: { sources: string[] }) => {
    if (!text.trim()) return;
    if (claim) {
      setResearchSource('claims');
      checkClaim(text.trim(), claim.sources);
      return;
    }
    if (source === 'claims') {
      checkClaim(text.trim(), againstPage ? citedKeys : []);
      return;
    }
    if (source === 'pdfs') {
      openSidebar('library', { tab: 'library', query: text.trim() });
      return;
    }
    setSubmitted({
      query: text.trim(),
      limit,
      yearFrom: yearOf(filters.yearFrom),
      yearTo: yearOf(filters.yearTo),
      kind: filters.kind,
      sort: filters.sort,
      openAccessOnly: filters.openAccessOnly,
    });
  };

  // "Search papers for this" and "Check this claim" from elsewhere in the app: fill the box and run it.
  const handledIntent = useRef<number | null>(null);
  useEffect(() => {
    if (intent?.tab !== 'research' || handledIntent.current === intent.id) return;
    handledIntent.current = intent.id;
    const text = 'claim' in intent ? intent.claim : intent.query;
    setQuery(text);
    run(text, 'claim' in intent ? { sources: intent.sources ?? [] } : undefined);
    // Runs once per intent; `run` reads the current source and filters.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [intent]);

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    run(query);
  };

  const clearQuery = () => setQuery('');

  const meta = RESEARCH_SOURCES[source];
  const filterCount = source === 'papers' ? activeFilterCount(filters) : 0;
  const hasFilters = source === 'papers';

  return (
    <div className="@container/research flex h-full min-h-0 flex-col">
      <div className="shrink-0 space-y-2 px-3 pb-2 pt-3">
        <form role="search" onSubmit={onSubmit} className="flex items-start gap-1">
          <div className="relative min-w-0 flex-1">
            <Search
              aria-hidden="true"
              className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground"
            />
            {/* Not disabled while loading: disabling a focused field drops
                focus and stops the author refining a query already on screen. */}
            <Input
              type="search"
              className="h-9 pl-8 pr-8 text-sm [&::-webkit-search-cancel-button]:appearance-none"
              placeholder={meta.placeholder}
              aria-label={meta.placeholder}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
            {query && (
              <button
                type="button"
                onClick={clearQuery}
                aria-label="Clear the search"
                className="absolute right-2 top-2 grid h-5 w-5 place-items-center rounded-sm text-muted-foreground transition-colors hover:bg-hover hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <X aria-hidden="true" className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
          {/* A PDF search has nothing to filter, but the button's slot stays, so
              the field keeps its width when the source changes. */}
          {hasFilters ? (
            <FiltersPopover
              count={filterCount}
              limit={limit}
              onLimitChange={setLimit}
              filters={filters}
              onFiltersChange={setFilters}
            />
          ) : (
            <span aria-hidden="true" className="h-9 w-9 shrink-0" />
          )}
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                type="submit"
                variant="secondary"
                size="sm"
                className="h-9"
                disabled={!query.trim()}
                aria-label="Search"
              >
                <ArrowRight aria-hidden="true" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom">
              Search
              <span className="ml-2 text-tooltip-foreground/60">Enter</span>
            </TooltipContent>
          </Tooltip>
        </form>

        <SourceSwitch
          source={source}
          onChange={setResearchSource}
          enabled={enabled}
          // Why it is off here, in the catalog's words: the workspace's
          // policy, the account's switch or the server.
          reasonOff={(id) => (RESEARCH_SOURCES[id].needsPapers ? papers.reason : null)}
        />
        {source === 'claims' && citedKeys.length > 0 && (
          <label className="flex items-center gap-2 px-0.5 text-xs text-muted-foreground">
            <Checkbox checked={againstPage} onCheckedChange={(value) => setAgainstPage(value === true)} />
            Against the works this page cites ({citedKeys.length})
          </label>
        )}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-1.5 pb-4">
        {source === 'papers' && <PaperResults params={submitted} />}
        {source === 'claims' && <ClaimCheckResults request={claimRequest} />}
        {source === 'pdfs' && (
          <EmptyState
            icon={FileSearch}
            title="Search inside my PDFs"
            description="Every PDF you uploaded, searched word for word. The matches open in the Library, where you can read each one in context."
            action={
              <Button variant="outline" size="sm" onClick={() => setPanel('library')}>
                Open Library
              </Button>
            }
          />
        )}
      </div>
    </div>
  );
}

/** One pill style for every switch in the Research header. */
const PILL =
  'inline-flex h-7 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-md px-2 text-sm transition-colors duration-120 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring [&_svg]:size-4 [&_svg]:shrink-0';
const PILL_ON = 'bg-active font-medium text-foreground';
const PILL_OFF = 'text-muted-foreground hover:bg-hover hover:text-foreground';

/**
 * Papers · Inside my PDFs, as one row of quiet pills.
 *
 * Never scrolls: in a narrow sidebar the labels shorten — Scholar · PDFs —
 * and the full name stays the accessible name and the tooltip.
 * The length follows the sidebar's width only, never the selection, so a
 * label never rewrites itself under the pointer that just picked it.
 */
function SourceSwitch({
  source,
  onChange,
  enabled,
  reasonOff,
}: {
  source: ResearchSourceId;
  onChange: (source: ResearchSourceId) => void;
  enabled: (source: ResearchSourceId) => boolean;
  reasonOff: (source: ResearchSourceId) => string | null;
}) {
  return (
    <div role="radiogroup" aria-label="Search in" className="-mx-1 flex min-w-0 items-center gap-0.5 px-1">
      {RESEARCH_SOURCE_IDS.map((id) => (
        <SourcePill
          key={id}
          id={id}
          active={id === source}
          available={enabled(id)}
          reasonOff={enabled(id) ? null : reasonOff(id)}
          onSelect={() => onChange(id)}
        />
      ))}
    </div>
  );
}

/**
 * A pill label as wide as its medium-weight self, so the pill does not grow
 * (and push its neighbours) when picking it makes the text medium.
 */
function StableLabel({ children, className }: { children: string; className?: string }) {
  return (
    <span aria-hidden="true" className={cn('inline-grid', className)}>
      <span className="col-start-1 row-start-1">{children}</span>
      <span className="invisible col-start-1 row-start-1 h-0 font-medium">{children}</span>
    </span>
  );
}

function SourcePill({
  id,
  active,
  available,
  reasonOff,
  onSelect,
}: {
  id: ResearchSourceId;
  active: boolean;
  available: boolean;
  /** Why it is off here, as the catalog says it. */
  reasonOff: string | null;
  onSelect: () => void;
}) {
  const reasonId = useId();
  const { label, shortLabel } = RESEARCH_SOURCES[id];
  const short = shortLabel !== label;
  const pill = (
    <button
      type="button"
      role="radio"
      aria-checked={active}
      aria-label={label}
      aria-describedby={available ? undefined : reasonId}
      disabled={!available}
      onClick={onSelect}
      className={cn(PILL, active ? PILL_ON : PILL_OFF, 'disabled:cursor-not-allowed disabled:opacity-50')}
    >
      {short ? (
        <>
          <StableLabel className="@max-[380px]/research:hidden">{label}</StableLabel>
          <StableLabel className="hidden @max-[380px]/research:inline-grid">{shortLabel}</StableLabel>
        </>
      ) : (
        <StableLabel>{label}</StableLabel>
      )}
    </button>
  );
  if (available) {
    if (!short) return pill;
    return (
      <Tooltip>
        <TooltipTrigger asChild>{pill}</TooltipTrigger>
        <TooltipContent side="bottom">{label}</TooltipContent>
      </Tooltip>
    );
  }
  const reason = `${label}: ${reasonOff ?? 'Not available here.'}`;
  // A disabled button gets no pointer events, so the tooltip hangs off a
  // wrapper; the same reason is the button's description.
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="shrink-0">
          {pill}
          <span id={reasonId} className="sr-only">
            {reason}
          </span>
        </span>
      </TooltipTrigger>
      <TooltipContent>{reason}</TooltipContent>
    </Tooltip>
  );
}

function FiltersPopover({
  count,
  limit,
  onLimitChange,
  filters,
  onFiltersChange,
}: {
  count: number;
  limit: number;
  onLimitChange: (limit: number) => void;
  filters: PaperFilters;
  onFiltersChange: (filters: PaperFilters) => void;
}) {
  const set = (patch: Partial<PaperFilters>) => onFiltersChange({ ...filters, ...patch });
  const label = 'text-xs font-medium text-muted-foreground';
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="icon"
          size="icon"
          className="relative h-9 w-9"
          aria-label={count > 0 ? `Search filters, ${count} active` : 'Search filters'}
        >
          <SlidersHorizontal aria-hidden="true" />
          {count > 0 && (
            <span aria-hidden="true" className="absolute right-1.5 top-1.5 h-1.5 w-1.5 rounded-full bg-primary" />
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-72 space-y-3">
        <p className="text-sm font-medium">Filters</p>
        <div className="grid grid-cols-2 gap-2">
          <label className="block space-y-1">
            <span className={label}>From year</span>
            <Input
              inputMode="numeric"
              value={filters.yearFrom}
              onChange={(event) => set({ yearFrom: event.target.value })}
              placeholder="2020"
              maxLength={4}
              aria-label="Published from year"
            />
          </label>
          <label className="block space-y-1">
            <span className={label}>To year</span>
            <Input
              inputMode="numeric"
              value={filters.yearTo}
              onChange={(event) => set({ yearTo: event.target.value })}
              placeholder="2026"
              maxLength={4}
              aria-label="Published up to year"
            />
          </label>
        </div>
        <label className="flex items-center justify-between gap-3">
          <span className={label}>Kind</span>
          <NativeSelect
            className="w-32"
            value={filters.kind}
            aria-label="Kind of work"
            onChange={(event) => set({ kind: event.target.value as PaperFilters['kind'] })}
          >
            <option value="any">Any</option>
            <option value="article">Articles</option>
            <option value="review">Reviews</option>
            <option value="preprint">Preprints</option>
          </NativeSelect>
        </label>
        <label className="flex items-center justify-between gap-3">
          <span className={label}>Order</span>
          <NativeSelect
            className="w-32"
            value={filters.sort}
            aria-label="Order of results"
            onChange={(event) => set({ sort: event.target.value as PaperFilters['sort'] })}
          >
            <option value="relevance">Most relevant</option>
            <option value="recent">Most recent</option>
            <option value="cited">Most cited</option>
          </NativeSelect>
        </label>
        <label className="flex cursor-pointer items-center gap-2 text-sm">
          <Checkbox
            checked={filters.openAccessOnly}
            onCheckedChange={(checked) => set({ openAccessOnly: checked === true })}
            aria-label="Open-access papers only"
          />
          Open-access papers only
        </label>
        <label className="flex items-center justify-between gap-3">
          <span className={label}>Results per search</span>
          <NativeSelect
            className="w-20"
            value={limit}
            aria-label="Number of results to return"
            onChange={(event) => onLimitChange(Number(event.target.value))}
          >
            {RESULT_LIMITS.map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </NativeSelect>
        </label>
      </PopoverContent>
    </Popover>
  );
}
