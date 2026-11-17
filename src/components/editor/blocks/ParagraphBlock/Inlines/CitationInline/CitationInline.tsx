import { useContext, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { CitationChild, ReferenceRecord } from '@/editor';
import type { InlineWidgetProps } from '../types';
import { safeExternalHttpUrl } from '@/lib/url';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Spinner } from '@/components/ui/spinner';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import {
  citationKeys,
  citationLabel,
  citationLabelText,
  entryForKey,
  identifierKey,
  isParenthetical,
  markupText,
  referenceByline,
  referenceLink,
  referenceTitle,
  useBibliography,
  useEditorActions,
  type BibliographyEntry,
} from '@/editor';
import { revealReferenceEntry } from '@/components/editor/References/navigation';
import { CitationStylePicker, CslText, ReferenceStatus } from '@/components/editor/References';
import { PanelsContext } from '@/components/panels/panelsContextState';
import { PaperRow } from '@/components/panels/shared';
import { paperFailure, searchPapers, type Paper } from '@/data/papers';
import { resolveFailure, resolveSource } from '@/data/sources';
import { WorkspaceContext } from '@/components/workspace/workspaceContextState';
import {
  InlineTrigger,
  InlinePopover,
  SettingsFooter,
  SettingsRow,
  stopEditorEvents,
  useInlineChild,
} from '../shared';
import { AssistantCatalogContext, NO_CATALOG } from '@/components/preferences/assistantCatalogContextState';
import { BookMarked, ChevronRight, ExternalLink, ListOrdered, Search, X } from 'lucide-react';

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

const EMPTY_SOURCES: ReferenceRecord[] = [];

/** Characters a parenthetical citation may sit flush against. */
const OPENS_OR_SPACE = /[\s([{‘“"'/–—-]/;

/**
 * Whether a parenthetical citation needs a visual gap before it.
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

const PASSAGE_LEVELS: Record<NonNullable<CitationChild['passage']>['level'], string> = {
  full_text: 'full text',
  abstract: 'abstract',
  snippet: 'snippet',
  metadata: 'metadata only',
};

function CitationInlineContent(props: InlineWidgetProps<CitationChild>) {
  const { child } = props;
  const { patch, remove } = useInlineChild(props);
  const { setCitationStyle } = useEditorActions();
  const bibliography = useBibliography();
  // Optional: the widget also renders outside the workspace (tests, the
  // design previews), where there is no sidebar to open and no catalog: no
  // paper search there.
  const assistant = useContext(AssistantCatalogContext) ?? NO_CATALOG;
  const workspaceId = useContext(WorkspaceContext)?.workspace.id ?? null;
  const panels = useContext(PanelsContext);
  const preferencesLoading = assistant.loading;
  const searchEnabled = workspaceId !== null && assistant.papers.on;
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Paper[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState('');
  const [unresolved, setUnresolved] = useState<string | null>(null);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  // When the editor closed. Closing hands focus back programmatically, and a
  // hover card opened by that focus would replace one popover with another
  // and linger with the pointer nowhere near it.
  const editorClosedAt = useRef(-Infinity);
  const rootRef = useRef<HTMLSpanElement>(null);

  const keys = useMemo(() => citationKeys(child), [child]);
  const sources = child.sources ?? EMPTY_SOURCES;
  const label = citationLabel(child, bibliography);
  const labelText = markupText(label);
  const parenthetical = isParenthetical(label);

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
  }, [parenthetical, labelText]);

  /** The work a key names: the page's record of it, else this citation's copy. */
  const recordFor = (key: string): ReferenceRecord | null =>
    entryForKey(bibliography, key)?.record ?? sources.find((source) => source.key === key) ?? null;

  /**
   * What this citation stands for, spelled out.
   *
   * The pill's accessible name used to be its own text — "[1], button" — which
   * tells a screen-reader user the one thing they can already infer and none of
   * what they need.
   */
  const description = keys.length === 0
    ? 'Citation with no source attached'
    : `Citation ${citationLabelText(child, bibliography)}: ${keys.map((key) => referenceTitle(recordFor(key), key)).join('; ')}`;

  /** Attach a work: a key already there takes the new record, which is how a typed key gets its details. */
  const attach = (record: ReferenceRecord) => {
    patch({
      keys: keys.includes(record.key) ? keys : [...keys, record.key],
      sources: [...sources.filter((source) => source.key !== record.key), record],
    });
    setUnresolved(null);
  };

  const detach = (key: string) => {
    patch({
      keys: keys.filter((k) => k !== key),
      sources: sources.filter((source) => source.key !== key),
    });
  };

  /** A key with no record: what the author typed, as they typed it, or with its scheme. */
  const addKey = (raw: string) => {
    const key = identifierKey(raw) ?? raw.trim();
    if (!key || keys.includes(key)) return;
    // If the page already has this work, adopt its record rather than a bare key.
    const known = entryForKey(bibliography, key)?.record;
    patch({ keys: [...keys, key], sources: known ? [...sources, known] : sources });
    setUnresolved(null);
    setQuery('');
  };

  /** A pasted identifier, checked by the registries before it is cited. */
  const resolve = async (raw: string) => {
    if (workspaceId === null) {
      addKey(raw);
      return;
    }
    setSearching(true);
    setSearchError('');
    try {
      const { record } = await resolveSource(workspaceId, raw);
      attach(record);
      setQuery('');
    } catch (error) {
      setSearchError(resolveFailure(error));
      setUnresolved(raw.trim());
    } finally {
      setSearching(false);
    }
  };

  const runSearch = async () => {
    const text = query.trim();
    if (!text || searching) return;
    if (identifierKey(text)) {
      void resolve(text);
      return;
    }
    if (!searchEnabled || workspaceId === null) {
      // Why, in the catalog's words: the workspace, the account or the server.
      setSearchError(`Paper search: ${assistant.papers.reason ?? 'not available here.'} Paste a DOI or arXiv id instead.`);
      setUnresolved(text);
      setResults(null);
      return;
    }
    setSearching(true);
    setSearchError('');
    setUnresolved(null);
    try {
      const found = await searchPapers(workspaceId, { query: text, limit: 6 });
      setResults(found.items);
    } catch (error) {
      setSearchError(paperFailure(error));
      setResults([]);
    } finally {
      setSearching(false);
    }
  };

  const searchPlaceholder = preferencesLoading
    ? 'Loading sources…'
    : searchEnabled
      ? 'Search papers or paste a DOI / arXiv id'
      : 'Paste a DOI or arXiv id';

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
          pill to find out which paper it is: hovering previews the source.
          The card steps aside while the editing popover is open. */}
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
              <CslText markup={label} links={false} />
            </InlineTrigger>
          </TooltipTrigger>
        }
      >
        {(close, closeAndLeave) => (
          <>
            <SettingsRow label="Sources">
              {keys.length === 0 ? (
                <p className="rounded-md border border-dashed border-border px-2 py-3 text-center text-xs text-muted-foreground">
                  No source attached yet — search below or paste a DOI.
                </p>
              ) : (
                <ul className="space-y-1">
                  {keys.map((key) => (
                    <SourceRow
                      key={key}
                      sourceKey={key}
                      record={recordFor(key)}
                      entry={entryForKey(bibliography, key)}
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
              {keys.length > 0 && (
                <p className="mt-1 text-2xs text-muted-foreground">
                  {child.passage
                    ? `Rests on passage ${child.passage.id} (${PASSAGE_LEVELS[child.passage.level]}).`
                    : 'Passage not recorded.'}
                </p>
              )}
            </SettingsRow>

            <SettingsRow label="Find a source" htmlFor={`citation-search-${child.id}`}>
              <div className="flex gap-1">
                <Input
                  id={`citation-search-${child.id}`}
                  type="text"
                  value={query}
                  placeholder={searchPlaceholder}
                  onChange={(event) => setQuery(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key !== 'Enter') return;
                    event.preventDefault();
                    if (preferencesLoading && !identifierKey(query)) return;
                    void runSearch();
                  }}
                  className="h-8 min-w-0 flex-1 px-2"
                />
                <Button
                  type="button"
                  variant="outline"
                  size="icon-sm"
                  onClick={() => void runSearch()}
                  disabled={searching || preferencesLoading || !query.trim() || (!searchEnabled && !identifierKey(query))}
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
              {unresolved && (
                <Button type="button" variant="ghost" size="sm" className="mt-1 h-6 px-1.5 text-xs" onClick={() => addKey(unresolved)}>
                  Add “{unresolved}” as a key without details
                </Button>
              )}

              {!preferencesLoading && !searchEnabled && !searchError && (
                <p role="status" className="mt-1 text-xs text-muted-foreground">
                  Paper search is off here. You can still paste a DOI or arXiv id.
                </p>
              )}

              {results && results.length === 0 && !searchError && (
                <div className="mt-1 flex flex-wrap items-center gap-1 text-xs text-muted-foreground">
                  <span>Nothing found.</span>
                  <Button type="button" variant="ghost" size="sm" className="h-6 px-1.5 text-xs" onClick={() => addKey(query)}>
                    Add “{query.trim()}” as a key
                  </Button>
                </div>
              )}

              {results && results.length > 0 && (
                <div className="-mx-2 mt-1 max-h-60 overflow-y-auto">
                  {results.map((paper) => (
                    <PaperRow
                      key={paper.record.key}
                      paper={paper}
                      compact
                      cite={{ label: keys.includes(paper.record.key) ? 'Update' : 'Add', run: () => attach(paper.record) }}
                    />
                  ))}
                </div>
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
                {/* A style is the page's: every citation and the reference
                    list follow it, so it is chosen for the page here. */}
                <SettingsRow label="Page citation style">
                  <CitationStylePicker
                    value={bibliography.documentStyle}
                    onChange={(style) => setCitationStyle(style)}
                  />
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
          recordFor={recordFor}
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

/** The hover card: each cited work's title, byline and state, and where to go. */
function CitationPreview({
  keys,
  recordFor,
  onShowInSources,
}: {
  keys: readonly string[];
  recordFor: (key: string) => ReferenceRecord | null;
  onShowInSources?: (key: string) => void;
}) {
  if (keys.length === 0) {
    return <p className="px-3 py-2.5 text-xs text-muted-foreground">No source attached yet. Click to add one.</p>;
  }
  const shown = keys.slice(0, 3);
  return (
    <div className="divide-y divide-border">
      {shown.map((key) => {
        const record = recordFor(key);
        const url = safeExternalHttpUrl(record ? referenceLink(record)?.href : undefined);
        const meta = record ? referenceByline(record) : '';
        return (
          <div key={key} className="px-3 py-2.5">
            <p className="line-clamp-2 text-sm font-medium leading-snug">{referenceTitle(record, key)}</p>
            {meta && <p className="mt-0.5 truncate text-xs text-muted-foreground">{meta}</p>}
            <ReferenceStatus record={record} className="mt-1" />
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
 * One attached work, shown the way the reference list prints it, so what is
 * checked here is what is published.
 */
function SourceRow({
  sourceKey,
  record,
  entry,
  onDetach,
  onShowReference,
  onShowInSources,
}: {
  sourceKey: string;
  record: ReferenceRecord | null;
  entry: BibliographyEntry | null;
  onDetach: () => void;
  onShowReference: (entry: BibliographyEntry) => void;
  /** Opens the Sources tab on this source; absent outside the workspace. */
  onShowInSources?: () => void;
}) {
  const url = safeExternalHttpUrl(record ? referenceLink(record)?.href : undefined);
  const title = referenceTitle(record, sourceKey);

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
          {entry.marker ?? `#${entry.number}`}
        </button>
      )}
      <span className="min-w-0 flex-1">
        <span className="block truncate text-xs font-medium">{title}</span>
        {entry ? (
          <span className="line-clamp-2 text-xs text-muted-foreground">
            <CslText markup={entry.formatted} links={false} />
          </span>
        ) : (
          record && <span className="block truncate text-xs text-muted-foreground">{referenceByline(record)}</span>
        )}
        <ReferenceStatus record={record} className="mt-0.5" />
        {entry && entry.usages.length > 1 && (
          <span className="mt-0.5 flex items-center gap-1 text-2xs text-muted-foreground">
            <ListOrdered aria-hidden="true" className="h-3 w-3" />
            Cited {entry.usages.length} times on this page
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
