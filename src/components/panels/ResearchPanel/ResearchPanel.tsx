import { Fragment, useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { ArrowRight, Search, SlidersHorizontal, X } from 'lucide-react';
import { searchArxiv } from '@/services/arxiv';
import { searchColpaliArxiv } from '@/services/colpali';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { NativeSelect } from '@/components/ui/select';
import { Spinner } from '@/components/ui/spinner';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { useAgentTools } from '@/components/preferences';
import { useEditor } from '@/editor';
import { cn } from '@/lib/utils';
import { usePanels, type ResearchSourceId } from '../panelsContextState';
import { RESEARCH_SOURCE_IDS, RESEARCH_SOURCES } from '../toolsConfig';
import { LibraryPanel, type LibraryFocus } from '../LibraryPanel/LibraryPanel';
import {
  NO_FILTERS,
  SemanticScholarResults,
  activeFilterCount,
  useSemanticScholar,
  type SemanticScholarFilters,
} from '../SemanticScholarPanel';
import { ArxivResults, ColpaliResults } from './PaperResults';
import { PdfResults } from './PdfSearch';
import { usePdfSearch } from './usePdfSearch';
import { usePaperSearch } from './usePaperSearch';

const RESULT_LIMITS = [10, 20, 30, 40, 50] as const;

const runArxiv = (query: string, limit: number) => searchArxiv({ query, limit, lite_search: true });
const runColpali = (query: string, limit: number) => searchColpaliArxiv({ query, limit });

type S2Mode = 'papers' | 'claim';

/**
 * ResearchPanel — one search box over every paper source.
 *
 * arXiv, Semantic Scholar, ColPali and the account's own PDFs used to be four
 * rail panels with four copies of the same query row, each forgetting its
 * results the moment another panel opened. Here the query is typed once, the
 * source is a switch under it, and every source keeps its own results for as
 * long as the sidebar is open. A source the account has not enabled cannot be
 * picked, so its API is never called.
 */
export function ResearchPanel() {
  const { researchSource, setResearchSource, intent } = usePanels();
  const { isSourceEnabled } = useAgentTools();
  const { documentId } = useEditor();
  const [query, setQuery] = useState('');
  const [limit, setLimit] = useState(20);
  const [filters, setFilters] = useState<SemanticScholarFilters>(NO_FILTERS);
  const [claimYear, setClaimYear] = useState('');
  const [s2Mode, setS2Mode] = useState<S2Mode>('papers');
  const [managing, setManaging] = useState<{ focus: LibraryFocus | null } | null>(null);

  const arxiv = usePaperSearch(runArxiv);
  const colpali = usePaperSearch(runColpali);
  const s2 = useSemanticScholar();
  const pdfs = usePdfSearch();

  const enabled = (id: ResearchSourceId) => {
    const gate = RESEARCH_SOURCES[id].sourceId;
    return !gate || isSourceEnabled(gate);
  };
  // A persisted choice can outlive the account setting that allowed it.
  const source = enabled(researchSource)
    ? researchSource
    : RESEARCH_SOURCE_IDS.find(enabled) ?? 'library';
  const claimMode = source === 'semantic-scholar' && s2Mode === 'claim';
  const loading =
    source === 'arxiv' ? arxiv.loading
    : source === 'colpali' ? colpali.loading
    : source === 'library' ? pdfs.loading
    : claimMode ? Boolean(s2.assessment?.loading)
    : s2.loading;

  const run = (text: string) => {
    if (!text.trim()) return;
    if (source === 'arxiv') void arxiv.search(text, limit);
    else if (source === 'colpali') void colpali.search(text, limit);
    else if (source === 'library') void pdfs.search(text);
    else if (claimMode) void s2.assess(text, limit, claimYear);
    else void s2.search(text, limit, filters);
  };

  // "Find sources for this" from elsewhere in the app: fill the box and run it.
  const handledIntent = useRef<number | null>(null);
  useEffect(() => {
    if (intent?.tab !== 'research' || handledIntent.current === intent.id) return;
    handledIntent.current = intent.id;
    setManaging(null);
    setQuery(intent.query);
    run(intent.query);
    // Runs once per intent; `run` reads the current source and filters.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [intent]);

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    run(query);
  };

  if (managing) {
    return (
      <div className="flex h-full min-h-0 flex-col">
        {/* The file manager draws its own one-row header ("← My PDFs", or
            "← title" on a file), so there is only ever one way back. */}
        <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-3">
          <LibraryPanel initialResource={managing.focus} onExit={() => setManaging(null)} />
        </div>
      </div>
    );
  }

  const clearQuery = () => {
    setQuery('');
    if (source === 'library') pdfs.clear();
  };

  const meta = RESEARCH_SOURCES[source];
  const filterCount =
    source !== 'semantic-scholar' ? 0
    : claimMode ? Number(Boolean(claimYear.trim()))
    : activeFilterCount(filters);
  const hasFilters = source !== 'library';

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
            {claimMode ? (
              // A claim is a sentence: it wraps and grows instead of scrolling
              // sideways and losing its start. Enter checks it.
              <Textarea
                rows={1}
                className="max-h-32 min-h-9 resize-none py-2 pl-8 pr-8 text-sm leading-5 [field-sizing:content]"
                placeholder="State one claim to check…"
                aria-label="Claim to check"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
                    event.preventDefault();
                    run(query);
                  }
                }}
              />
            ) : (
              <Input
                type="search"
                className="h-9 pl-8 pr-8 text-sm [&::-webkit-search-cancel-button]:appearance-none"
                placeholder={meta.placeholder}
                aria-label={meta.placeholder}
                value={query}
                onChange={(event) => setQuery(event.target.value)}
              />
            )}
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
          {/* My PDFs has nothing to filter, but the button's slot stays, so
              the field keeps its width when the source changes. */}
          {hasFilters ? (
            <FiltersPopover
              count={filterCount}
              source={source}
              claimMode={claimMode}
              limit={limit}
              onLimitChange={setLimit}
              filters={filters}
              onFiltersChange={setFilters}
              claimYear={claimYear}
              onClaimYearChange={setClaimYear}
              disabled={loading && !claimMode}
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
                // A newer claim may replace one still being checked; searches wait.
                disabled={(loading && !claimMode) || !query.trim()}
                aria-label={claimMode ? 'Check claim' : 'Search'}
              >
                {loading ? <Spinner /> : <ArrowRight aria-hidden="true" />}
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom">
              {claimMode ? 'Check claim' : 'Search'}
              <span className="ml-2 text-tooltip-foreground/60">Enter</span>
            </TooltipContent>
          </Tooltip>
        </form>

        <SourceSwitch source={source} onChange={setResearchSource} enabled={enabled} />
        {source === 'semantic-scholar' && <S2ModeSwitch mode={s2Mode} onChange={setS2Mode} />}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-1.5 pb-4">
        {source === 'arxiv' && <ArxivResults state={arxiv} />}
        {source === 'colpali' && <ColpaliResults state={colpali} />}
        {source === 'semantic-scholar' && <SemanticScholarResults state={s2} mode={s2Mode} />}
        {source === 'library' && (
          <PdfResults state={pdfs} documentId={documentId} onManage={(focus) => setManaging({ focus })} />
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
 * arXiv · Semantic Scholar · Pages · My PDFs, as one row of quiet pills.
 *
 * Never scrolls: in a narrow sidebar the labels shorten — arXiv · Scholar ·
 * Pages · PDFs — and the full name stays the accessible name and the tooltip.
 * The length follows the sidebar's width only, never the selection, so a
 * label never rewrites itself under the pointer that just picked it.
 */
function SourceSwitch({
  source,
  onChange,
  enabled,
}: {
  source: ResearchSourceId;
  onChange: (source: ResearchSourceId) => void;
  enabled: (source: ResearchSourceId) => boolean;
}) {
  return (
    <div role="radiogroup" aria-label="Search in" className="-mx-1 flex min-w-0 items-center gap-0.5 px-1">
      {RESEARCH_SOURCE_IDS.map((id) => (
        <SourcePill
          key={id}
          id={id}
          active={id === source}
          available={enabled(id)}
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
  onSelect,
}: {
  id: ResearchSourceId;
  active: boolean;
  available: boolean;
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
  const reason = `Enable ${label} in Settings → AI & tools`;
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

/**
 * Find papers · Check a claim — Semantic Scholar's two modes, as a quiet
 * second row under the source switch while Semantic Scholar is picked. Text,
 * not icons: "check a claim" has no icon anyone reads correctly, and the
 * source row above keeps its labels and its place.
 */
function S2ModeSwitch({ mode, onChange }: { mode: S2Mode; onChange: (mode: S2Mode) => void }) {
  const options = [
    { value: 'papers', label: 'Find papers' },
    { value: 'claim', label: 'Check a claim' },
  ] as const;
  return (
    <div role="radiogroup" aria-label="Semantic Scholar mode" className="-mx-1 -mt-1 flex items-center px-1">
      {options.map(({ value, label }, index) => (
        <Fragment key={value}>
          {index > 0 && (
            <span aria-hidden="true" className="text-xs text-muted-foreground/60">
              ·
            </span>
          )}
          <button
            type="button"
            role="radio"
            aria-checked={mode === value}
            aria-label={label}
            onClick={() => onChange(value)}
            className={cn(
              'inline-flex h-6 items-center whitespace-nowrap rounded-sm px-2 text-xs transition-colors duration-120 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
              mode === value ? 'font-medium text-foreground' : 'text-muted-foreground hover:bg-hover hover:text-foreground',
            )}
          >
            <StableLabel>{label}</StableLabel>
          </button>
        </Fragment>
      ))}
    </div>
  );
}

function FiltersPopover({
  count,
  source,
  claimMode,
  limit,
  onLimitChange,
  filters,
  onFiltersChange,
  claimYear,
  onClaimYearChange,
  disabled,
}: {
  count: number;
  source: ResearchSourceId;
  claimMode: boolean;
  limit: number;
  onLimitChange: (limit: number) => void;
  filters: SemanticScholarFilters;
  onFiltersChange: (filters: SemanticScholarFilters) => void;
  claimYear: string;
  onClaimYearChange: (year: string) => void;
  disabled: boolean;
}) {
  const set = (patch: Partial<SemanticScholarFilters>) => onFiltersChange({ ...filters, ...patch });
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
        {source === 'semantic-scholar' && claimMode && (
          <label className="block space-y-1">
            <span className={label}>Limit sources to year</span>
            <Input
              value={claimYear}
              onChange={(event) => onClaimYearChange(event.target.value)}
              placeholder="Any year"
              maxLength={64}
              aria-label="Limit claim sources to year"
            />
          </label>
        )}
        {source === 'semantic-scholar' && !claimMode && (
          <>
            <div className="grid grid-cols-2 gap-2">
              <label className="block space-y-1">
                <span className={label}>Year or range</span>
                <Input
                  value={filters.year}
                  onChange={(event) => set({ year: event.target.value })}
                  placeholder="2020-2026"
                  maxLength={64}
                  disabled={disabled}
                  aria-label="Publication year filter"
                />
              </label>
              <label className="block space-y-1">
                <span className={label}>Min. citations</span>
                <Input
                  type="number"
                  min={0}
                  max={100_000_000}
                  step={1}
                  value={filters.minCitationCount}
                  onChange={(event) => set({ minCitationCount: event.target.value })}
                  placeholder="0"
                  disabled={disabled}
                  aria-label="Minimum citation count"
                />
              </label>
            </div>
            <label className="block space-y-1">
              <span className={label}>Fields of study</span>
              <Input
                value={filters.fieldsOfStudy}
                onChange={(event) => set({ fieldsOfStudy: event.target.value })}
                placeholder="Medicine, Computer Science"
                disabled={disabled}
                aria-label="Fields of study filter"
              />
            </label>
            <label className="flex cursor-pointer items-center gap-2 text-sm">
              <Checkbox
                checked={filters.openAccessOnly}
                onCheckedChange={(checked) => set({ openAccessOnly: checked === true })}
                disabled={disabled}
                aria-label="Open-access papers only"
              />
              Open-access papers only
            </label>
          </>
        )}
        <label className="flex items-center justify-between gap-3">
          <span className={label}>Results per search</span>
          <NativeSelect
            className="w-20"
            value={limit}
            aria-label="Number of results to return"
            onChange={(event) => onLimitChange(Number(event.target.value))}
            disabled={disabled}
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
