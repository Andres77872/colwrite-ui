import { useContext, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { CitationChild, CitationSource } from '@/editor';
import type { InlineWidgetProps } from '../types';
import { cn } from '@/lib/utils';
import { safeExternalHttpUrl } from '@/lib/url';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Spinner } from '@/components/ui/spinner';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import {
  canonicalArxivId,
  canonicalCitationKey,
  canonicalDoi,
  citationLabel,
  entryForKey,
  formatReference,
  referenceMarker,
  useBibliography,
  useEditor,
  yearOf,
  type BibliographyEntry,
} from '@/editor';
import { revealReferenceEntry } from '@/components/editor/References/navigation';
import { PanelsContext } from '@/components/panels/panelsContextState';
import { searchArxiv, type ArxivResult } from '@/services/arxiv';
import {
  researchAuthorsLabel,
  researchExternalId,
  searchSemanticScholar,
  type ResearchPaper,
} from '@/services/semanticScholar';
import {
  InlineTrigger,
  InlinePopover,
  SettingsFooter,
  SettingsRow,
  stopEditorEvents,
  useInlineChild,
} from '../shared';
import { useAgentTools } from '@/components/preferences';
import { BookMarked, ChevronRight, ExternalLink, ListOrdered, Plus, Search, X } from 'lucide-react';

/**
 * Type-guard wrapper. It declares no hooks, so returning early here is safe;
 * the guard used to sit above the content component's hooks, which meant a
 * child whose type changed in place rendered fewer hooks than the previous
 * pass and crashed React.
 */
export function CitationInline({ child, ...rest }: InlineWidgetProps) {
  if (child.type !== 'citation') return null;
  return <CitationInlineContent child={child} {...rest} />;
}

type Style = NonNullable<CitationChild['style']>;

const STYLES: Array<{ value: Style; label: string; example: string }> = [
  { value: 'numeric', label: 'Numeric', example: '[1–3]' },
  { value: 'author-year', label: 'Author–year', example: '(Smith, 2020)' },
  { value: 'ieee', label: 'IEEE', example: '[1]–[3]' },
];

const EMPTY_KEYS: string[] = [];
const EMPTY_SOURCES: CitationSource[] = [];

type CitationSearchResult = {
  key: string;
  provider: 'arxiv' | 'semantic_scholar';
  providerLabel: string;
  providerId: string;
  title: string;
  authors?: string;
  year?: string;
  source: CitationSource;
};

function arxivCandidate(result: ArxivResult): CitationSearchResult | null {
  const providerId = result.id.trim();
  const arxivId = canonicalArxivId(providerId);
  const title = result.title.trim();
  if (!arxivId || !title) return null;
  const doi = canonicalDoi(result.doi);
  const key = doi ?? arxivId;
  const year = yearOf(result.date);
  return {
    key,
    provider: 'arxiv',
    providerLabel: 'arXiv',
    providerId,
    title,
    authors: result.authors,
    year,
    source: {
      key,
      title,
      authors: result.authors,
      year,
      venue: 'arXiv',
      url: result.url,
      provider: 'arxiv',
      providerId,
      doi,
      pdfUrl: result.pdfUrl,
    },
  };
}

function semanticScholarCandidate(paper: ResearchPaper): CitationSearchResult {
  const rawDoi = researchExternalId(paper, 'DOI');
  const doi = canonicalDoi(rawDoi);
  const arxivId = canonicalArxivId(researchExternalId(paper, 'ArXiv'));
  const key = doi ?? arxivId ?? `S2:${paper.paper_id}`;
  const authors = researchAuthorsLabel(paper) ?? undefined;
  const year = paper.year === null ? undefined : String(paper.year);
  return {
    key,
    provider: 'semantic_scholar',
    providerLabel: 'Semantic Scholar',
    providerId: paper.paper_id,
    title: paper.title,
    authors,
    year,
    source: {
      key,
      title: paper.title,
      authors,
      year,
      venue: paper.venue ?? 'Semantic Scholar',
      url: paper.url ?? undefined,
      provider: 'semantic_scholar',
      providerId: paper.paper_id,
      doi,
      externalIds: paper.external_ids,
      pdfUrl: paper.pdf_url ?? undefined,
      citationCount: paper.citation_count ?? undefined,
      influentialCitationCount: paper.influential_citation_count ?? undefined,
      referenceCount: paper.reference_count ?? undefined,
      isOpenAccess: paper.is_open_access,
    },
  };
}

function deduplicateCandidates(candidates: CitationSearchResult[]): CitationSearchResult[] {
  const unique = new Map<string, CitationSearchResult>();
  for (const candidate of candidates) {
    const identity = candidate.key.toLocaleLowerCase();
    if (!unique.has(identity)) unique.set(identity, candidate);
  }
  return Array.from(unique.values());
}

/** Characters a parenthetical citation may sit flush against. */
const OPENS_OR_SPACE = /[\s([{\u2018\u201C"'/\u2013\u2014-]/;

/**
 * Whether an author–year citation needs a visual gap before it.
 *
 * "lengths (Vaswani, 2017)" is how a parenthetical citation reads; glued on
 * as "lengths(Vaswani, 2017)" the paper looks broken. Numeric markers stay
 * glued ("lengths[1]"), which is their convention. The gap is presentation
 * only — the document text is not changed — so it is skipped when the text
 * already has a space or an opening bracket there.
 */
function needsLeadingGap(host: HTMLElement): boolean {
  const editable = host.parentElement?.closest<HTMLElement>('[contenteditable]');
  if (!editable) return false;
  const range = document.createRange();
  range.setStart(editable, 0);
  range.setEndBefore(host);
  const before = range.toString();
  if (!before) return false;
  return !OPENS_OR_SPACE.test(before.slice(-1));
}

function CitationInlineContent(props: InlineWidgetProps<CitationChild>) {
  const { child } = props;
  const { patch, remove } = useInlineChild(props);
  const { blocks, updateParagraphChild } = useEditor();
  const bibliography = useBibliography();
  const { isSourceEnabled, loading: preferencesLoading } = useAgentTools();
  // Optional: the widget also renders outside the workspace (tests, the
  // design previews), where there is no sidebar to open.
  const panels = useContext(PanelsContext);
  const arxivEnabled = isSourceEnabled('arxiv');
  const semanticScholarEnabled = isSourceEnabled('semantic_scholar');
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<CitationSearchResult[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState('');
  const [searchWarning, setSearchWarning] = useState('');
  const [previewOpen, setPreviewOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  // When the editor closed. Closing hands focus back programmatically, and a
  // hover card opened by that focus would replace one popover with another
  // and linger with the pointer nowhere near it.
  const editorClosedAt = useRef(-Infinity);
  const rootRef = useRef<HTMLSpanElement>(null);

  // Shared empties rather than fresh `[]` literals: a new array every render
  // is a new dependency every render, so every memo below would recompute on
  // any state change at all.
  const keys = child.keys ?? EMPTY_KEYS;
  const sources = child.sources ?? EMPTY_SOURCES;
  // The document's style, when the author chose one, wins over the citation's.
  const style: Style = bibliography.documentStyle ?? child.style ?? 'numeric';

  const label = citationLabel(child, bibliography);
  const parenthetical = style === 'author-year';

  // Kept current as the writer types before the citation: the check reads
  // the live text, so it re-runs on the paragraph's input events.
  // The gap is shown or hidden on the DOM node directly: it follows the live
  // text around the widget, not React state.
  const gapRef = useRef<HTMLSpanElement>(null);
  useLayoutEffect(() => {
    const root = rootRef.current;
    const gap = gapRef.current;
    if (!root || !gap) return;
    const host = root.closest<HTMLElement>('[data-child-id]') ?? root;
    const editable = host.parentElement?.closest<HTMLElement>('[contenteditable]');
    const update = () => {
      gap.hidden = !needsLeadingGap(host);
    };
    update();
    editable?.addEventListener('input', update);
    return () => editable?.removeEventListener('input', update);
  }, [parenthetical, label]);

  // Keyed canonically, because a citation's `keys` and its `sources[].key` are
  // two independently written spellings of the same identifier.
  const byKey = useMemo(() => {
    const map = new Map<string, CitationSource>();
    for (const source of sources) map.set(canonicalCitationKey(source.key), source);
    return map;
  }, [sources]);
  const localSource = (key: string) => byKey.get(canonicalCitationKey(key));

  /**
   * What this citation stands for, spelled out.
   *
   * The pill's accessible name used to be its own text — "[1], button" — which
   * tells a screen-reader user the one thing they can already infer and none of
   * what they need.
   */
  const description = useMemo(() => {
    if (keys.length === 0) return 'Citation with no source attached';
    const titles = keys.map((key) => {
      const entry = entryForKey(bibliography, key);
      return entry?.source.title ?? byKey.get(canonicalCitationKey(key))?.title ?? key;
    });
    return `Citation ${label}: ${titles.join('; ')}`;
  }, [bibliography, byKey, keys, label]);

  const attach = (result: CitationSearchResult) => {
    // Re-attaching a key that is already there is an upgrade, not a no-op: it
    // is how a key typed by hand acquires a title. Matched canonically, so
    // attaching a DOI upgrades the same paper cited under its arXiv id.
    const target = canonicalCitationKey(result.key);
    const present = keys.some((key) => canonicalCitationKey(key) === target);
    patch({
      keys: present ? keys : [...keys, result.key],
      sources: [
        ...sources.filter((source) => canonicalCitationKey(source.key) !== target),
        result.source,
      ],
    });
  };

  const detach = (key: string) => {
    const target = canonicalCitationKey(key);
    patch({
      keys: keys.filter((k) => canonicalCitationKey(k) !== target),
      sources: sources.filter((source) => canonicalCitationKey(source.key) !== target),
    });
  };

  const addManualKey = (raw: string) => {
    const key = canonicalCitationKey(raw);
    // Compared canonically: adding `10.1/X` to a citation that already has
    // `10.1/x` is adding nothing.
    if (!key || keys.some((existing) => canonicalCitationKey(existing) === key)) return;
    // If the document already cites this key with metadata, adopt it rather
    // than adding a second, blank-looking entry for the same paper.
    const known = entryForKey(bibliography, key)?.source;
    patch({
      keys: [...keys, key],
      sources: [
        ...sources,
        known ?? {
          key,
          provider: 'manual',
          ...(canonicalDoi(key) ? { doi: canonicalDoi(key) } : {}),
        },
      ],
    });
  };

  const runSearch = async () => {
    const text = query.trim();
    if (!text || searching) return;
    if (!arxivEnabled && !semanticScholarEnabled) {
      setSearchError(
        'No paper search source is enabled. Paste a citation key or enable a source in Settings → AI & tools.',
      );
      setResults(null);
      return;
    }
    setSearching(true);
    setSearchError('');
    setSearchWarning('');
    try {
      const [semanticScholar, arxiv] = await Promise.allSettled([
        semanticScholarEnabled
          ? searchSemanticScholar({ query: text, limit: 6 })
          : Promise.resolve(null),
        arxivEnabled ? searchArxiv({ query: text, limit: 6 }) : Promise.resolve(null),
      ]);

      const semanticFailed =
        semanticScholarEnabled && semanticScholar.status === 'rejected';
      const arxivFailed = arxivEnabled && arxiv.status === 'rejected';
      const enabledCount = Number(semanticScholarEnabled) + Number(arxivEnabled);
      const failedCount = Number(semanticFailed) + Number(arxivFailed);
      if (enabledCount > 0 && failedCount === enabledCount) {
        const label =
          semanticScholarEnabled && arxivEnabled
            ? 'either source index'
            : semanticScholarEnabled
              ? 'Semantic Scholar'
              : 'arXiv';
        setSearchError(`Could not reach ${label}. Add the key by hand instead.`);
        setResults([]);
        return;
      }

      const semanticResults =
        semanticScholar.status === 'fulfilled' && semanticScholar.value !== null
          ? semanticScholar.value.data.map(semanticScholarCandidate)
          : [];
      const arxivResults =
        arxiv.status === 'fulfilled' && arxiv.value !== null
          ? arxiv.value
              .map(arxivCandidate)
              .filter((candidate): candidate is CitationSearchResult => candidate !== null)
          : [];
      // Semantic Scholar is first so a DOI present in both indexes keeps its
      // richer provenance and citation-graph metadata.
      setResults(deduplicateCandidates([...semanticResults, ...arxivResults]));

      if (semanticFailed) {
        setSearchWarning('Semantic Scholar is unavailable; showing arXiv results.');
      } else if (arxivFailed) {
        setSearchWarning('arXiv is unavailable; showing Semantic Scholar results.');
      }
    } catch {
      // Defensive fallback for failures outside the settled provider requests.
      setSearchError('Could not search source indexes. Add the key by hand instead.');
      setResults([]);
    } finally {
      setSearching(false);
    }
  };

  const enabledSourceLabels = [
    arxivEnabled ? 'arXiv' : null,
    semanticScholarEnabled ? 'Semantic Scholar' : null,
  ].filter((label): label is string => label !== null);
  const sourceSearchLabel =
    enabledSourceLabels.length === 2
      ? enabledSourceLabels.join(' and ')
      : enabledSourceLabels[0];
  // Short enough to read whole in the field; which indexes are searched is
  // the field's title.
  const searchPlaceholder = preferencesLoading
    ? 'Loading sources…'
    : sourceSearchLabel
      ? 'Search or paste DOI / arXiv ID'
      : 'Paste a citation key or DOI';

  /**
   * Citation style is a document-wide decision, so changing it here offers to
   * change it everywhere. Leaving one paragraph in author–year and the rest in
   * numeric is never what anyone meant.
   */
  const applyStyleEverywhere = (next: Style) => {
    for (const block of blocks) {
      if (block.type !== 'paragraph') continue;
      for (const candidate of block.children ?? []) {
        if (candidate.type === 'citation' && candidate.style !== next) {
          updateParagraphChild(block.id, candidate.id, { style: next });
        }
      }
    }
  };

  const otherCitations = useMemo(
    () =>
      blocks
        .filter((block) => block.type === 'paragraph')
        .flatMap((block) => (block.type === 'paragraph' ? block.children ?? [] : []))
        .filter((candidate) => candidate.type === 'citation' && candidate.id !== child.id).length,
    [blocks, child.id],
  );

  const hasOptions = Boolean(child.prefix || child.locator || child.suffix);

  return (
    <>
    {/* A real, breakable space rather than a margin: at a line wrap it hangs
        at the end of the line instead of indenting the next one. It lives
        inside the widget's placeholder, which is emptied on save, so the
        document text is unchanged. */}
    {parenthetical && (
      <span ref={gapRef} aria-hidden="true" hidden className="whitespace-pre-wrap">
        {' '}
      </span>
    )}
    <span
      ref={rootRef}
      className="citation-inline relative inline-block align-baseline"
      role="group"
      aria-label="Citation"
      contentEditable={false}
      {...stopEditorEvents}
    >
      {/* A reader scanning a cited paragraph should not have to open each
          pill to find out which paper it is: hovering previews the source,
          the way Notion previews a link. The card steps aside while the
          editing popover is open. */}
      <TooltipProvider delayDuration={300} skipDelayDuration={150}>
      <Tooltip
        open={previewOpen && !editing}
        onOpenChange={(open) => {
          if (open && performance.now() - editorClosedAt.current < 400) return;
          setPreviewOpen(open);
        }}
      >
      <InlinePopover
        align="start"
        contentClassName="w-[24rem] max-w-[85vw] p-3"
        onOpenChange={(open) => {
          setEditing(open);
          if (open) setPreviewOpen(false);
          else editorClosedAt.current = performance.now();
        }}
        trigger={
          <TooltipTrigger asChild>
            <InlineTrigger
              look="citation"
              tone={keys.length === 0 ? 'error' : 'default'}
              aria-label={description}
            >
              {label}
            </InlineTrigger>
          </TooltipTrigger>
        }
      >
        {(close, closeAndLeave) => (
          <>
            <SettingsRow label="Sources">
              {keys.length === 0 ? (
                <p className="rounded-md border border-dashed border-border px-2 py-3 text-center text-xs text-muted-foreground">
                  No source attached yet — search below or paste a key.
                </p>
              ) : (
                <ul className="space-y-1">
                  {keys.map((key) => (
                    <SourceRow
                      key={key}
                      sourceKey={key}
                      source={localSource(key)}
                      entry={entryForKey(bibliography, key)}
                      style={style}
                      onDetach={() => detach(key)}
                      // Reveal first, then dismiss without the usual focus
                      // return: the entry is where the reader asked to be.
                      onShowReference={(entry) => {
                        revealReferenceEntry(entry);
                        closeAndLeave();
                      }}
                      onShowInSources={
                        panels
                          ? () => {
                              panels.openSidebar('sources', { tab: 'sources', sourceKey: key });
                              closeAndLeave();
                            }
                          : undefined
                      }
                    />
                  ))}
                </ul>
              )}
            </SettingsRow>

            <SettingsRow label="Find a source" htmlFor={`citation-search-${child.id}`}>
              <div className="flex gap-1">
                <Input
                  id={`citation-search-${child.id}`}
                  type="text"
                  value={query}
                  placeholder={searchPlaceholder}
                  title={sourceSearchLabel ? `Searches ${sourceSearchLabel}` : undefined}
                  onChange={(event) => setQuery(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key !== 'Enter') return;
                    event.preventDefault();
                    // A bare identifier is a key, not a search: pasting
                    // "2103.00020" should attach it, not query for it.
                    const isIdentifier =
                      /^(10\.\d{4,}\/|arXiv:|S2:|\d{4}\.\d{4,})/i.test(query.trim());
                    if (
                      isIdentifier ||
                      (!preferencesLoading && !arxivEnabled && !semanticScholarEnabled)
                    ) {
                      addManualKey(query.trim());
                      setQuery('');
                      return;
                    }
                    if (preferencesLoading) return;
                    runSearch();
                  }}
                  className="h-8 min-w-0 flex-1 px-2"
                />
                <Button
                  type="button"
                  variant="outline"
                  size="icon-sm"
                  onClick={runSearch}
                  disabled={
                    searching ||
                    preferencesLoading ||
                    enabledSourceLabels.length === 0 ||
                    !query.trim()
                  }
                  aria-label="Search"
                >
                  {searching ? <Spinner className="h-3.5 w-3.5" /> : <Search className="h-3.5 w-3.5" />}
                </Button>
              </div>

              {searchError && (
                <p role="alert" className="mt-1 text-xs text-destructive">
                  {searchError}
                </p>
              )}

              {searchWarning && (
                <p role="status" className="mt-1 text-xs text-muted-foreground">
                  {searchWarning}
                </p>
              )}

              {!preferencesLoading && enabledSourceLabels.length === 0 && !searchError && (
                <p role="status" className="mt-1 text-xs text-muted-foreground">
                  Paper search is off. You can still paste a DOI, arXiv id, or citation key.
                </p>
              )}

              {results && results.length === 0 && !searchError && (
                <p className="mt-1 text-xs text-muted-foreground">
                  Nothing found. Press Enter to add “{query.trim()}” as a key anyway.
                </p>
              )}

              {results && results.length > 0 && (
                <ul className="mt-1 max-h-44 space-y-1 overflow-y-auto">
                  {results.map((result) => (
                    <li key={`${result.provider}:${result.providerId}`}>
                      <button
                        type="button"
                        onClick={() => attach(result)}
                        className="flex w-full items-start gap-2 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-accent/50"
                      >
                        <Plus aria-hidden="true" className="mt-0.5 h-3 w-3 shrink-0 text-muted-foreground" />
                        <span className="min-w-0 flex-1">
                          <span className="flex items-center gap-1">
                            <span className="min-w-0 flex-1 truncate text-xs">{result.title}</span>
                            {localSource(result.key) !== undefined && (
                              <Badge variant="outline" className="h-4 shrink-0 px-1 text-2xs">
                                Attached
                              </Badge>
                            )}
                            <Badge variant="secondary" className="h-4 shrink-0 px-1 text-2xs">
                              {result.providerLabel}
                            </Badge>
                          </span>
                          <span className="block truncate text-xs text-muted-foreground">
                            {[result.authors, result.year].filter(Boolean).join(' · ')}
                          </span>
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </SettingsRow>

            {/* Style and the prefix / locator / suffix are set once in a
                while; behind a disclosure the popover is about the source. */}
            <Collapsible defaultOpen={hasOptions} className="mt-1">
              <CollapsibleTrigger className="group/more -ml-1 flex items-center gap-1 rounded-sm px-1 py-0.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-hover hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                <ChevronRight
                  aria-hidden="true"
                  className="h-3.5 w-3.5 transition-transform group-data-[state=open]/more:rotate-90"
                />
                More options
              </CollapsibleTrigger>
              <CollapsibleContent>
                <div className="pt-2">
                <SettingsRow label="Style">
                  <div className="flex gap-0.5 rounded-md bg-subtle p-0.5">
                    {STYLES.map((option) => (
                      <button
                        key={option.value}
                        type="button"
                        onClick={() => patch({ style: option.value })}
                        aria-pressed={style === option.value}
                        className={cn(
                          'flex-1 rounded-[5px] px-2 py-1 text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                          style === option.value
                            ? 'bg-background font-medium text-foreground shadow-sm'
                            : 'text-muted-foreground hover:text-foreground',
                        )}
                      >
                        <span className="block">{option.label}</span>
                        <span
                          className={cn(
                            'block text-xs',
                            style === option.value ? 'text-foreground/70' : 'text-muted-foreground',
                          )}
                        >
                          {option.example}
                        </span>
                      </button>
                    ))}
                  </div>
                  {otherCitations > 0 && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="mt-1 h-6 px-1.5 text-xs text-muted-foreground"
                      onClick={() => applyStyleEverywhere(style)}
                    >
                      Apply this style to all {otherCitations + 1} citations
                    </Button>
                  )}
                </SettingsRow>

                <div className="grid grid-cols-3 gap-2">
                  <SettingsRow label="Prefix" htmlFor={`prefix-${child.id}`}>
                    <Input
                      id={`prefix-${child.id}`}
                      type="text"
                      value={child.prefix ?? ''}
                      placeholder="see"
                      onChange={(event) => patch({ prefix: event.target.value })}
                      className="h-8 px-2"
                    />
                  </SettingsRow>
                  <SettingsRow label="Locator" htmlFor={`locator-${child.id}`}>
                    <Input
                      id={`locator-${child.id}`}
                      type="text"
                      value={child.locator ?? ''}
                      placeholder="p. 12"
                      onChange={(event) => patch({ locator: event.target.value })}
                      className="h-8 px-2"
                    />
                  </SettingsRow>
                  <SettingsRow label="Suffix" htmlFor={`suffix-${child.id}`}>
                    <Input
                      id={`suffix-${child.id}`}
                      type="text"
                      value={child.suffix ?? ''}
                      placeholder="ch. 2"
                      onChange={(event) => patch({ suffix: event.target.value })}
                      className="h-8 px-2"
                    />
                  </SettingsRow>
                </div>
                </div>
              </CollapsibleContent>
            </Collapsible>

            <SettingsFooter
              onRemove={() => {
                close();
                remove();
              }}
              onDone={close}
            />
          </>
        )}
      </InlinePopover>
      <TooltipContent
        side="bottom"
        align="start"
        sideOffset={6}
        className="w-[20rem] max-w-[85vw] rounded-lg border border-border bg-popover p-0 text-sm font-normal text-popover-foreground shadow-lg"
      >
        <CitationPreview
          keys={keys}
          sourceFor={(key) => entryForKey(bibliography, key)?.source ?? localSource(key)}
          onShowInSources={
            panels
              ? (key) => {
                  setPreviewOpen(false);
                  panels.openSidebar('sources', { tab: 'sources', sourceKey: key });
                }
              : undefined
          }
        />
      </TooltipContent>
      </Tooltip>
      </TooltipProvider>
    </span>
    </>
  );
}

/** The hover card: each cited source's title, authors · year · venue, and where to go. */
function CitationPreview({
  keys,
  sourceFor,
  onShowInSources,
}: {
  keys: readonly string[];
  sourceFor: (key: string) => CitationSource | undefined;
  onShowInSources?: (key: string) => void;
}) {
  if (keys.length === 0) {
    return <p className="px-3 py-2.5 text-xs text-muted-foreground">No source attached yet. Click to add one.</p>;
  }
  const shown = keys.slice(0, 3);
  return (
    <div className="divide-y divide-border">
      {shown.map((key) => {
        const source = sourceFor(key);
        const url = safeExternalHttpUrl(source?.url ?? source?.pdfUrl);
        const meta = [source?.authors, source?.year, source?.venue].filter(Boolean).join(' · ');
        return (
          <div key={key} className="px-3 py-2.5">
            <p className="line-clamp-2 text-sm font-medium leading-snug">{source?.title ?? key}</p>
            {meta && <p className="mt-0.5 truncate text-xs text-muted-foreground">{meta}</p>}
            {(url || onShowInSources) && (
              <div className="mt-1.5 flex items-center gap-3 text-xs">
                {url && (
                  <a
                    href={url}
                    target="_blank"
                    rel="noreferrer noopener"
                    tabIndex={-1}
                    className="inline-flex items-center gap-1 text-link hover:underline"
                  >
                    Open
                    <ExternalLink aria-hidden="true" className="h-3 w-3" />
                  </a>
                )}
                {onShowInSources && (
                  <button
                    type="button"
                    tabIndex={-1}
                    onClick={() => onShowInSources(key)}
                    className="text-muted-foreground hover:text-foreground"
                  >
                    Show in sources
                  </button>
                )}
              </div>
            )}
          </div>
        );
      })}
      {keys.length > shown.length && (
        <p className="px-3 py-2 text-xs text-muted-foreground">and {keys.length - shown.length} more</p>
      )}
    </div>
  );
}

/**
 * One attached source, shown the way it will appear in the reference list.
 *
 * Editing a citation used to mean reading a title and trusting that the
 * bibliography agreed; the row now renders through the same `formatReference`
 * the reference list uses, so what is checked here is what is published.
 */
function SourceRow({
  sourceKey,
  source,
  entry,
  style,
  onDetach,
  onShowReference,
  onShowInSources,
}: {
  sourceKey: string;
  source: CitationSource | undefined;
  entry: BibliographyEntry | null;
  style: Style;
  onDetach: () => void;
  onShowReference: (entry: BibliographyEntry) => void;
  /** Opens the Sources tab on this source; absent outside the workspace. */
  onShowInSources?: () => void;
}) {
  const resolved = entry?.source ?? source;
  const url = safeExternalHttpUrl(resolved?.url ?? resolved?.pdfUrl);
  const title = resolved?.title ?? sourceKey;
  const formatted = entry
    ? formatReference(entry, style).text
    : [resolved?.authors, resolved?.year, resolved?.venue].filter(Boolean).join(' · ');
  // An unresolved entry formats to its own key, which the title line already is.
  const detail = formatted === title ? '' : formatted;

  return (
    <li className="flex items-start gap-2 rounded-md px-2 py-1.5 transition-colors hover:bg-hover">
      {entry && (
        <button
          type="button"
          onClick={() => onShowReference(entry)}
          title="Show in the reference list"
          aria-label={`Show reference ${entry.number} for ${title}`}
          className="mt-px shrink-0 rounded-xs px-1 text-xs tabular-nums text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
        >
          {referenceMarker(entry, style) || `#${entry.number}`}
        </button>
      )}
      <span className="min-w-0 flex-1">
        <span className="block truncate text-xs font-medium">{title}</span>
        {detail && (
          <span className="block truncate text-xs text-muted-foreground">{detail}</span>
        )}
        {entry && entry.usages.length > 1 && (
          <span className="mt-0.5 flex items-center gap-1 text-2xs text-muted-foreground">
            <ListOrdered aria-hidden="true" className="h-3 w-3" />
            Cited {entry.usages.length} times in this document
          </span>
        )}
      </span>
      {onShowInSources && (
        <button
          type="button"
          onClick={onShowInSources}
          title="Show in sources"
          aria-label={`Show ${title} in sources`}
          className="shrink-0 text-muted-foreground hover:text-foreground"
        >
          <BookMarked className="h-3.5 w-3.5" />
        </button>
      )}
      {url && (
        <a
          href={url}
          target="_blank"
          rel="noreferrer noopener"
          className="shrink-0 text-muted-foreground hover:text-foreground"
          aria-label={`Open ${title}`}
        >
          <ExternalLink className="h-3.5 w-3.5" />
        </a>
      )}
      <button
        type="button"
        onClick={onDetach}
        aria-label={`Remove ${sourceKey}`}
        className="shrink-0 text-muted-foreground hover:text-destructive"
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </li>
  );
}
