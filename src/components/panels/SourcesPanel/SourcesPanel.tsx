import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import {
  AlertTriangle,
  BookOpen,
  Check,
  ChevronRight,
  ClipboardCopy,
  Crosshair,
  Download,
  ExternalLink,
  FileUp,
  MoreHorizontal,
  Pencil,
  Plus,
  Quote,
  RefreshCw,
  Search,
  SearchCheck,
  Trash2,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Spinner } from '@/components/ui/spinner';
import { EmptyState } from '@/components/ui/empty-state';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useToast } from '@/components/ui/toastContext';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { cn } from '@/lib/utils';
import { copyToClipboard } from '@/lib/clipboard';
import {
  canonicalDoi,
  citationStyleInfo,
  identifierKey,
  manualRecord,
  referenceByline,
  referenceLink,
  referenceMarks,
  referenceNames,
  referenceTitle,
  referenceVenue,
  referenceYear,
  useBibliography,
  useEditorActions,
  useEditorDoc,
  usePageReadOnly,
  type CslName,
  type ReferenceRecord,
} from '@/editor';
import { parseBibtex, toBibtex } from '@/editor/bibtex';
import { downloadBlob, exportFilename } from '@/export/download';
import { resolveFailure, resolveSource } from '@/data/sources';
import { useWorkspaceId } from '@/components/workspace/workspaceContextState';
import {
  CitationStylePicker,
  ReferenceStatus,
  findingMarks,
  revealCitationUsage,
  useCiteAndAnnounce,
  useReferenceHealth,
  type ReferenceFinding,
} from '@/components/editor/References';
import type { ReferenceAudit } from '@/data/references';
import { shortDateTime } from '@/components/layout/editedLabel';
import { usePanels } from '../panelsContextState';
import { scrollBehavior } from '@/lib/motion';

type Row = {
  key: string;
  record: ReferenceRecord | null;
  number?: number;
  marker?: string | null;
  usages: number;
  firstUsage?: { blockId: string; childId: string };
  inLibrary: boolean;
};

/** The identifier the registries can check the entry by: its key, when it carries a scheme. */
function resolvableIdentifier(row: Row): string | null {
  return identifierKey(row.key) ?? (row.record?.csl.DOI ? `doi:${canonicalDoi(row.record.csl.DOI) ?? row.record.csl.DOI}` : null);
}

/** "Ada Lovelace; Charles Babbage" from the names, and back. */
function namesText(names: readonly CslName[] | undefined): string {
  return (names ?? [])
    .map((name) => name.literal ?? [name.family, name.given].filter(Boolean).join(', '))
    .join('; ');
}

function parseNames(value: string): CslName[] {
  return value
    .split(/\s*;\s*/)
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      const [family, given] = part.split(/\s*,\s*/, 2);
      if (given) return { family: family ?? part, given };
      const words = part.split(/\s+/);
      return words.length > 1 ? { family: words.at(-1) ?? part, given: words.slice(0, -1).join(' ') } : { literal: part };
    });
}

function SourceEditor({
  record,
  rowKey,
  onSave,
  onCancel,
}: {
  record: ReferenceRecord | null;
  rowKey: string;
  onSave: (record: ReferenceRecord) => void;
  onCancel: () => void;
}) {
  const [draft, setDraft] = useState({
    title: record?.csl.title ?? '',
    authors: namesText(record?.csl.author),
    year: record ? referenceYear(record) ?? '' : '',
    venue: record?.csl['container-title'] ?? '',
    doi: record?.csl.DOI ?? '',
    url: record?.csl.URL ?? '',
  });
  const field = (name: keyof typeof draft, label: string, placeholder?: string) => (
    <label className="block text-xs">
      <span className="mb-1 block text-muted-foreground">{label}</span>
      <Input
        value={draft[name]}
        placeholder={placeholder}
        onChange={(event) => setDraft((previous) => ({ ...previous, [name]: event.target.value }))}
      />
    </label>
  );
  return (
    <form
      className="mt-2 space-y-2 rounded-md bg-background p-2.5 ring-1 ring-border"
      onSubmit={(event) => {
        event.preventDefault();
        // Changed details are the author's, not the registry's: the entry is
        // no longer what a record said, so it becomes `manual` and unchecked.
        const year = Number(draft.year.trim());
        const authors = parseNames(draft.authors);
        const csl = {
          ...(record?.csl ?? { type: 'document' as const }),
          title: draft.title.trim() || rowKey,
          ...(authors.length ? { author: authors } : { author: undefined }),
          issued: Number.isInteger(year) && year > 0 ? { 'date-parts': [[year]] } : undefined,
          'container-title': draft.venue.trim() || undefined,
          DOI: canonicalDoi(draft.doi) ?? (draft.doi.trim() || undefined),
          URL: draft.url.trim() || undefined,
        };
        const clean = Object.fromEntries(Object.entries(csl).filter(([, value]) => value !== undefined)) as Omit<ReferenceRecord['csl'], 'id'>;
        onSave(manualRecord(rowKey, clean, record?.kind ?? 'other', record?.flags ?? []));
      }}
    >
      {field('title', 'Title')}
      {field('authors', 'Authors', 'Lovelace, Ada; Babbage, Charles')}
      <div className="grid grid-cols-[5rem_1fr] gap-2">
        {field('year', 'Year')}
        {field('venue', 'Venue', 'Journal or conference')}
      </div>
      {field('doi', 'DOI')}
      {field('url', 'URL')}
      <div className="flex justify-end gap-1.5 pt-1">
        <Button type="button" size="sm" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" size="sm">
          Save
        </Button>
      </div>
    </form>
  );
}

function SourceRow({
  row,
  onCite,
  onVerify,
  onEdit,
  onRemove,
  verifying,
  highlighted,
  readOnly = false,
  finding,
  titleOf,
}: {
  /** A viewer's row reads, links and copies; it never cites, verifies, edits or removes. */
  readOnly?: boolean;
  /** What the last reference check found about it. */
  finding?: ReferenceFinding;
  titleOf: (key: string) => string;
  row: Row;
  onCite: (() => void) | null;
  onVerify: (() => void) | null;
  onEdit: (record: ReferenceRecord) => void;
  onRemove: () => void;
  verifying: boolean;
  highlighted: boolean;
}) {
  const [editing, setEditing] = useState(false);
  // Set when "Remove from sources" was chosen on a source that is still cited:
  // removing the library entry would leave every citation in place, so the
  // row would not go anywhere and the action would seem to do nothing.
  const [stillCited, setStillCited] = useState(false);
  const { toast } = useToast();
  const link = row.record ? referenceLink(row.record) : null;
  const title = referenceTitle(row.record, row.key);
  const byline = row.record ? referenceByline(row.record) : '';
  const manual = row.record?.provider === 'manual';

  const copyBibtex = async () => {
    if (!row.record) return;
    const copied = await copyToClipboard({ plain: toBibtex([row.record]) });
    toast(copied ? { title: 'BibTeX copied' } : { title: 'Could not copy', variant: 'error' });
  };

  return (
    <li
      data-source-key={row.key}
      className={cn(
        'group rounded-md px-2 py-2 transition-colors duration-150 hover:bg-hover has-focus-visible:bg-hover',
        highlighted && 'bg-selection',
      )}
    >
      <div className="flex items-start gap-2">
        <span className="mt-px w-6 shrink-0 text-right text-xs tabular-nums text-muted-foreground">
          {row.marker ?? (row.number !== undefined ? `[${row.number}]` : '')}
        </span>
        <div className="min-w-0 flex-1">
          <p className="line-clamp-2 text-sm font-medium leading-snug">{title}</p>
          {byline && <p className="mt-0.5 truncate text-xs text-muted-foreground">{byline}</p>}
          <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted-foreground">
            <ReferenceStatus record={row.record} />
            {!row.record && <span className="text-warning">No details attached</span>}
            {manual && <span title="Typed, imported or edited — not checked against a registry">Entered by hand</span>}
            <span>{row.usages > 0 ? `Cited ${row.usages === 1 ? 'once' : `${row.usages}×`}` : 'Not cited yet'}</span>
          </p>
          {findingMarks(finding, titleOf).map((mark) => (
            <p key={mark.kind} data-finding={mark.kind} className="mt-1 text-xs text-tint-yellow-fg">
              <span className="font-medium">{mark.label}:</span> {mark.detail}
            </p>
          ))}
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              type="button"
              variant="icon"
              size="icon-xs"
              aria-label={`Actions for ${title}`}
              className="shrink-0 opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100 data-[state=open]:opacity-100 pointer-coarse:opacity-100"
            >
              <MoreHorizontal />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56">
            {!readOnly && onCite && (
              <DropdownMenuItem onSelect={onCite}>
                <Quote />
                Cite at cursor
              </DropdownMenuItem>
            )}
            {row.firstUsage && (
              <DropdownMenuItem onSelect={() => row.firstUsage && revealCitationUsage(row.firstUsage)}>
                <Crosshair />
                Show where it is cited
              </DropdownMenuItem>
            )}
            {link && (
              <DropdownMenuItem asChild>
                <a href={link.href} target="_blank" rel="noreferrer noopener">
                  <ExternalLink />
                  Open source
                </a>
              </DropdownMenuItem>
            )}
            {row.record && (
              <DropdownMenuItem onSelect={() => void copyBibtex()}>
                <ClipboardCopy />
                Copy BibTeX
              </DropdownMenuItem>
            )}
            {onVerify && !readOnly && (
              <DropdownMenuItem onSelect={onVerify}>
                <RefreshCw />
                Check against the registries
              </DropdownMenuItem>
            )}
            {!readOnly && (
              <DropdownMenuItem onSelect={() => setEditing(true)}>
                <Pencil />
                Edit details
              </DropdownMenuItem>
            )}
            {row.inLibrary && !readOnly && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  destructive
                  onSelect={() => {
                    if (row.usages > 0) setStillCited(true);
                    else onRemove();
                  }}
                >
                  <Trash2 />
                  Remove from sources
                </DropdownMenuItem>
              </>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      {verifying && (
        <p className="mt-1 flex items-center gap-1.5 pl-8 text-xs text-muted-foreground">
          <Spinner /> Checking the registries…
        </p>
      )}
      {stillCited && row.usages > 0 && (
        <div role="status" className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 pl-8 text-xs text-muted-foreground">
          <span>
            Still cited {row.usages === 1 ? 'once' : `${row.usages} times`}: remove the citations first.
          </span>
          {row.firstUsage && (
            <button
              type="button"
              className="rounded-xs font-medium text-link hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              onClick={() => row.firstUsage && revealCitationUsage(row.firstUsage)}
            >
              Show where
            </button>
          )}
          <button
            type="button"
            className="rounded-xs font-medium text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            onClick={() => setStillCited(false)}
          >
            Dismiss
          </button>
        </div>
      )}
      {editing && (
        <SourceEditor
          record={row.record}
          rowKey={row.key}
          onCancel={() => setEditing(false)}
          onSave={(record) => {
            onEdit(record);
            setEditing(false);
          }}
        />
      )}
    </li>
  );
}

/**
 * The document's sources: everything it cites, in reference-list order, and
 * everything the author keeps in its library for later.
 *
 * Each source shows its reference state where it matters (09 §5): a mark
 * for one that needs review, with what differs, one no registry found, a
 * retraction with its notice, a preprint with a published version. Adding
 * by identifier goes through the resolver, never trusting what was typed;
 * an entry typed, imported or edited by hand is `manual` until checked.
 */
/**
 * "Check references" (P2.UI-4): the page's references looked up again, and
 * what the last check found, in its counts. The refresh it proposes is
 * reviewed in the page like any change set.
 */
function ReferenceCheck({
  report,
  check,
  checking,
  error,
}: {
  report: ReferenceAudit | null;
  check: (() => Promise<void>) | null;
  checking: boolean;
  error: string | null;
}) {
  const counts = report?.counts;
  const found = counts
    ? [
        counts.retracted && `${counts.retracted} retracted`,
        counts.stale && `${counts.stale} out of date`,
        counts.duplicates && `${counts.duplicates} duplicate${counts.duplicates === 1 ? '' : 's'}`,
        counts.orphans && `${counts.orphans} cited with no entry`,
        counts.needs_review && `${counts.needs_review} to review`,
        counts.not_found && `${counts.not_found} not found`,
      ].filter(Boolean)
    : [];
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between gap-2">
        <p className="min-w-0 text-xs text-muted-foreground" aria-live="polite">
          {checking
            ? 'Checking the references…'
            : report
              ? `Checked ${shortDateTime(Date.parse(report.checked_at))}: ${found.length ? found.join(' · ') : 'nothing to fix'}.`
              : 'References not checked yet.'}
        </p>
        {check && (
          <Button type="button" variant="ghost" size="sm" onClick={() => void check()} disabled={checking} className="shrink-0">
            {checking ? <Spinner /> : <SearchCheck aria-hidden="true" />}
            Check references
          </Button>
        )}
      </div>
      {report && !report.outside_lookups && (
        <p className="text-xs text-muted-foreground">Outside research is switched off in this workspace, so nothing was looked up.</p>
      )}
      {report?.change_set_id && (counts?.stale ?? 0) > 0 && (
        <p className="text-xs text-muted-foreground">A refresh of the out-of-date records is proposed for review in the page.</p>
      )}
      {error && <p role="alert" className="text-xs text-destructive">{error}</p>}
    </div>
  );
}

export function SourcesPanel() {
  const workspaceId = useWorkspaceId();
  const { doc } = useEditorDoc();
  const { upsertSources, updateSource, removeSource, setCitationStyle } = useEditorActions();
  // A viewer reads and exports the page's sources; the library is the page's, and theirs to read only.
  const readOnly = usePageReadOnly();
  const bibliography = useBibliography();
  const health = useReferenceHealth();
  const cite = useCiteAndAnnounce();
  const { toast } = useToast();
  const [identifier, setIdentifier] = useState('');
  const [adding, setAdding] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);
  const [filter, setFilter] = useState('');
  const [verifying, setVerifying] = useState<string | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [importText, setImportText] = useState('');
  const fileInput = useRef<HTMLInputElement | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);
  const [highlighted, setHighlighted] = useState<string | null>(null);
  const { intent } = usePanels();

  const library = useMemo(() => doc.sources ?? [], [doc.sources]);
  const libraryKeys = useMemo(() => new Set(library.map((source) => source.key)), [library]);

  const rows = useMemo(() => {
    const cited: Row[] = bibliography.entries.map((entry) => ({
      key: entry.key,
      record: entry.record,
      number: entry.number,
      marker: entry.marker,
      usages: entry.usages.length,
      firstUsage: entry.usages[0],
      inLibrary: libraryKeys.has(entry.key),
    }));
    const citedKeys = new Set(cited.map((row) => row.key));
    const saved: Row[] = library
      .filter((source) => !citedKeys.has(source.key))
      .map((source) => ({ key: source.key, record: source, usages: 0, inLibrary: true }));
    const q = filter.trim().toLowerCase();
    const matches = (row: Row) =>
      !q ||
      [row.key, ...(row.record ? [row.record.csl.title, ...referenceNames(row.record), referenceVenue(row.record), referenceYear(row.record)] : [])]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(q));
    return { cited: cited.filter(matches), saved: saved.filter(matches), total: cited.length + saved.length };
  }, [bibliography, filter, library, libraryKeys]);

  // Opened on one source ("Show in sources"): scroll to its row and mark it
  // briefly. The filter is cleared first, or the row might not be there.
  const handledIntent = useRef<number | null>(null);
  useEffect(() => {
    if (intent?.tab !== 'sources' || handledIntent.current === intent.id) return;
    handledIntent.current = intent.id;
    const key = intent.sourceKey;
    setFilter('');
    setHighlighted(key);
    requestAnimationFrame(() => {
      listRef.current
        ?.querySelector(`[data-source-key="${CSS.escape(key)}"]`)
        ?.scrollIntoView({ block: 'center', behavior: scrollBehavior() });
    });
    const timer = window.setTimeout(() => setHighlighted(null), 2000);
    return () => window.clearTimeout(timer);
  }, [intent]);

  /** References a reviewer reads first: retracted, needing review, not found. */
  const attention = useMemo(
    () => [...rows.cited, ...rows.saved].filter((row) => referenceMarks(row.record).some((mark) => mark.tone !== 'neutral')).length,
    [rows],
  );

  const add = async (event: FormEvent) => {
    event.preventDefault();
    const value = identifier.trim();
    if (!value) return;
    setAdding(true);
    setAddError(null);
    try {
      const { record } = await resolveSource(workspaceId, value);
      upsertSources([record]);
      setIdentifier('');
      toast({ title: 'Added to sources', description: referenceTitle(record) });
    } catch (error) {
      setAddError(resolveFailure(error));
    } finally {
      setAdding(false);
    }
  };

  const verify = async (row: Row) => {
    const id = resolvableIdentifier(row);
    if (!id) return;
    setVerifying(row.key);
    try {
      const { record } = await resolveSource(workspaceId, id, {
        ...(row.record?.csl.title && row.record.provider === 'manual' ? { title: row.record.csl.title } : {}),
      });
      // Stored under the row's own key, so every citation of it picks it up.
      upsertSources([{ ...record, key: row.key }]);
      toast({ title: 'Checked against the registries', description: referenceTitle(record) });
    } catch (error) {
      toast({ title: 'Could not check it', description: resolveFailure(error), variant: 'error' });
    } finally {
      setVerifying(null);
    }
  };

  const edit = (row: Row, record: ReferenceRecord) => {
    if (row.inLibrary) updateSource(row.key, record);
    else upsertSources([record]);
  };

  const exportBibtex = () => {
    const all = [
      ...bibliography.entries.flatMap((entry) => (entry.record ? [entry.record] : [])),
      ...rows.saved.flatMap((row) => (row.record ? [row.record] : [])),
    ];
    if (all.length === 0) return;
    downloadBlob(
      new Blob([toBibtex(all)], { type: 'application/x-bibtex' }),
      exportFilename(doc.name, 'bib'),
    );
  };

  const runImport = (text: string) => {
    const { sources, skipped } = parseBibtex(text);
    if (sources.length === 0) {
      toast({ title: 'No entries found', description: 'Paste the contents of a .bib file.', variant: 'error' });
      return;
    }
    upsertSources(sources);
    setImportOpen(false);
    setImportText('');
    toast({
      title: `Imported ${sources.length} source${sources.length === 1 ? '' : 's'}`,
      description: skipped ? `${skipped} entr${skipped === 1 ? 'y' : 'ies'} without a title were skipped.` : 'Check them against the registries from each entry’s menu.',
    });
  };

  const titleOf = (key: string) => {
    const record = library.find((source) => source.key === key) ?? bibliography.byKey.get(key)?.record;
    return referenceTitle(record, key);
  };

  const renderRows = (list: Row[]) => (
    <ul>
      {list.map((row) => (
        <SourceRow
          key={row.key}
          row={row}
          finding={health.findings.get(row.key)}
          titleOf={titleOf}
          verifying={verifying === row.key}
          highlighted={highlighted === row.key}
          onCite={row.record ? () => void cite([row.record as ReferenceRecord]) : null}
          onVerify={resolvableIdentifier(row) ? () => void verify(row) : null}
          onEdit={(record) => edit(row, record)}
          onRemove={() => removeSource(row.key)}
          readOnly={readOnly}
        />
      ))}
    </ul>
  );

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="shrink-0 space-y-2.5 px-3 pb-2 pt-3">
        {readOnly ? (
          <div className="flex items-center justify-between gap-2">
            <p className="text-xs text-muted-foreground">You can view this page’s sources, not change them.</p>
            <Button type="button" variant="ghost" size="sm" onClick={exportBibtex} disabled={rows.total === 0}>
              <Download aria-hidden="true" />
              Export .bib
            </Button>
          </div>
        ) : (
        <form onSubmit={add}>
          <label htmlFor="source-identifier" className="sr-only">
            Add a source
          </label>
          <div className="flex gap-1">
            <div className="relative min-w-0 flex-1">
              <Plus
                aria-hidden="true"
                className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
              />
              <Input
                id="source-identifier"
                value={identifier}
                onChange={(event) => setIdentifier(event.target.value)}
                placeholder="Add by DOI, arXiv id or PMID"
                className="h-9 pl-8"
                aria-describedby={addError ? 'source-identifier-error' : undefined}
              />
            </div>
            <Button type="submit" variant="secondary" size="sm" className="h-9" disabled={adding || !identifier.trim()}>
              {adding && <Spinner />}
              Add
            </Button>
            {/* BibTeX in and out: occasional actions, so behind "…" rather
                than crowding the style row. */}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button type="button" variant="icon" size="icon" className="h-9 w-9 shrink-0" aria-label="BibTeX import and export">
                  <MoreHorizontal aria-hidden="true" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56">
                <DropdownMenuItem onSelect={() => setImportOpen(true)}>
                  <FileUp aria-hidden="true" />
                  Import BibTeX…
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={exportBibtex} disabled={rows.total === 0}>
                  <Download aria-hidden="true" />
                  Export .bib
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
          {addError && (
            <p id="source-identifier-error" className="mt-1.5 text-xs text-destructive">
              {addError}
            </p>
          )}
        </form>
        )}

        <ReferenceCheck report={health.report} check={readOnly ? null : health.check} checking={health.checking} error={health.error} />

        {/* The page's style, with the processor's and the styles' credits. */}
        <Collapsible>
          <CollapsibleTrigger className="group/style -ml-1 flex max-w-full items-center gap-1 rounded-sm px-1 py-0.5 text-xs text-muted-foreground transition-colors hover:bg-hover hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
            <ChevronRight aria-hidden="true" className="h-3.5 w-3.5 shrink-0 transition-transform group-data-[state=open]/style:rotate-90" />
            <span className="truncate">
              Citation style: <span className="font-medium text-foreground">{doc.citationStyle ? citationStyleInfo(doc.citationStyle).name : `Auto (${citationStyleInfo(bibliography.style).name})`}</span>
            </span>
          </CollapsibleTrigger>
          <CollapsibleContent className="pt-1.5">
            <CitationStylePicker
              value={doc.citationStyle ?? null}
              onChange={(style) => !readOnly && setCitationStyle(style)}
              disabled={readOnly}
            />
          </CollapsibleContent>
        </Collapsible>

        {rows.total > 5 && (
          <div className="relative">
            <Search aria-hidden="true" className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={filter}
              onChange={(event) => setFilter(event.target.value)}
              placeholder="Filter sources"
              aria-label="Filter sources"
              className="pl-8"
            />
          </div>
        )}
      </div>

      <div ref={listRef} className="min-h-0 flex-1 space-y-4 overflow-y-auto px-1.5 pb-4">
        {attention > 0 && (
          <p className="mx-2 flex items-start gap-2 rounded-md bg-tint-yellow px-2.5 py-2 text-xs text-tint-yellow-fg">
            <AlertTriangle aria-hidden="true" className="mt-px h-3.5 w-3.5 shrink-0" />
            <span>
              {attention} source{attention === 1 ? ' needs' : 's need'} a look — retracted, not found, or with details the
              registries disagree on. Each says why.
            </span>
          </p>
        )}
        {rows.total === 0 ? (
          <EmptyState
            icon={BookOpen}
            title="No sources yet"
            description="Add one by DOI or arXiv id, cite from Research, or ask the assistant to find and cite sources."
          />
        ) : (
          <>
            {rows.cited.length > 0 && (
              <section aria-label="Cited on this page">
                <h3 className="px-2 pb-1 text-xs font-medium text-muted-foreground">Cited · {rows.cited.length}</h3>
                {renderRows(rows.cited)}
              </section>
            )}
            {rows.saved.length > 0 && (
              <section aria-label="Saved for later, not cited">
                <h3 className="px-2 pb-1 text-xs font-medium text-muted-foreground">
                  Saved for later · {rows.saved.length}
                </h3>
                {renderRows(rows.saved)}
              </section>
            )}
            {rows.cited.length + rows.saved.length === 0 && (
              <EmptyState size="inline" title={`Nothing matches “${filter}”`} />
            )}
          </>
        )}
      </div>

      <Dialog open={importOpen} onOpenChange={setImportOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Import BibTeX</DialogTitle>
            <DialogDescription>
              Paste entries from Zotero, Mendeley, Google Scholar or a .bib file. They join this page’s
              sources as entered by hand, unchecked until you check them against the registries.
            </DialogDescription>
          </DialogHeader>
          <Textarea
            value={importText}
            onChange={(event) => setImportText(event.target.value)}
            placeholder="@article{smith2020, title={…}, author={…}, year={2020}, doi={10.…}}"
            className="mt-3 min-h-40 font-mono text-xs"
            aria-label="BibTeX to import"
          />
          <input
            ref={fileInput}
            type="file"
            accept=".bib,.bibtex,text/plain,application/x-bibtex"
            className="hidden"
            onChange={async (event) => {
              const file = event.target.files?.[0];
              if (!file) return;
              setImportText(await file.text());
              event.target.value = '';
            }}
          />
          <DialogFooter className="mt-3">
            <Button type="button" variant="ghost" onClick={() => fileInput.current?.click()}>
              <FileUp className="h-4 w-4" />
              Choose file…
            </Button>
            <Button type="button" onClick={() => runImport(importText)} disabled={!importText.trim()}>
              <Check className="h-4 w-4" />
              Import
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
