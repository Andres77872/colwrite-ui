import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import {
  AlertTriangle,
  BadgeCheck,
  BookOpen,
  Check,
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
import { cn } from '@/lib/utils';
import {
  canonicalCitationKey,
  isVerifiedSource,
  referenceLink,
  useBibliography,
  useEditorActions,
  useEditorState,
  type CitationSource,
  type Doc,
} from '@/editor';
import { parseBibtex, toBibtex } from '@/editor/bibtex';
import { downloadBlob, exportFilename } from '@/export/download';
import { resolveSource } from '@/services/sources';
import { ApiError } from '@/services/contracts';
import { revealCitationUsage, useCiteAtCursor } from '@/components/editor/References';
import { usePanels } from '../panelsContextState';
import { scrollBehavior } from '@/lib/motion';

type Row = {
  key: string;
  source: CitationSource;
  number?: number;
  usages: number;
  firstUsage?: { blockId: string; childId: string };
  inLibrary: boolean;
  verified: boolean;
};

const STYLES: ReadonlyArray<{ value: Doc['citationStyle'] | null; label: string }> = [
  { value: null, label: 'Auto' },
  { value: 'numeric', label: 'Numeric' },
  { value: 'ieee', label: 'IEEE' },
  { value: 'author-year', label: 'Author–year' },
];

/** What went wrong resolving an identifier, in the author's terms. */
function resolveError(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.status === 400) return 'That is not a DOI, an arXiv id or a Semantic Scholar id.';
    if (error.status === 404) return 'No record exists for that identifier. Check it for typos.';
    if (error.status === 403) return error.message;
    if (error.status === 503) return 'The registry could not be reached. Try again in a moment.';
  }
  return error instanceof Error ? error.message : 'The source could not be resolved.';
}

/** The identifier a registry can confirm, if the source has one. */
function resolvableIdentifier(source: CitationSource): string | null {
  const candidates = [source.doi, source.key, source.externalIds?.ArXiv, source.externalIds?.DOI];
  for (const candidate of candidates) {
    if (!candidate) continue;
    if (/^10\.\d{4,9}\//i.test(canonicalCitationKey(candidate))) return candidate;
    if (/^\d{4}\.\d{4,5}$/.test(canonicalCitationKey(candidate))) return candidate;
    if (/^S2:/i.test(candidate)) return candidate;
  }
  return null;
}

function Byline({ source }: { source: CitationSource }) {
  const parts = [source.authors, source.year, source.venue].filter(Boolean);
  if (parts.length === 0) return null;
  return <p className="mt-0.5 truncate text-xs text-muted-foreground">{parts.join(' · ')}</p>;
}

function SourceEditor({
  source,
  onSave,
  onCancel,
}: {
  source: CitationSource;
  onSave: (patch: Partial<CitationSource>) => void;
  onCancel: () => void;
}) {
  const [draft, setDraft] = useState({
    title: source.title ?? '',
    authors: source.authors ?? '',
    year: source.year ?? '',
    venue: source.venue ?? '',
    url: source.url ?? '',
    doi: source.doi ?? '',
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
        // no longer what a record said, so it stops claiming to be verified.
        const changed = (Object.keys(draft) as Array<keyof typeof draft>).some(
          (field) => (source[field] ?? '') !== draft[field],
        );
        onSave(changed ? { ...draft, provider: 'manual' } : draft);
      }}
    >
      {field('title', 'Title')}
      {field('authors', 'Authors', 'Ada Lovelace, Charles Babbage')}
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
}: {
  row: Row;
  onCite: () => void;
  onVerify: (() => void) | null;
  onEdit: (patch: Partial<CitationSource>) => void;
  onRemove: () => void;
  verifying: boolean;
  highlighted: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const { toast } = useToast();
  const link = referenceLink(row.source);

  const copyBibtex = async () => {
    try {
      await navigator.clipboard.writeText(toBibtex([row.source]));
      toast({ title: 'BibTeX copied' });
    } catch {
      toast({ title: 'Could not copy', variant: 'error' });
    }
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
          {row.number !== undefined ? `[${row.number}]` : ''}
        </span>
        <div className="min-w-0 flex-1">
          <p className="line-clamp-2 text-sm font-medium leading-snug">{row.source.title || row.key}</p>
          <Byline source={row.source} />
          <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted-foreground">
            {row.verified ? (
              <span
                className="inline-flex items-center gap-1 text-success"
                title="Metadata came from a registry or a source the assistant read"
              >
                <BadgeCheck aria-hidden="true" className="h-3.5 w-3.5" />
                Verified
              </span>
            ) : (
              <span
                className="inline-flex items-center gap-1 text-warning"
                title="Typed or imported — not confirmed against a registry"
              >
                <AlertTriangle aria-hidden="true" className="h-3.5 w-3.5" />
                Unverified
              </span>
            )}
            <span>{row.usages > 0 ? `Cited ${row.usages === 1 ? 'once' : `${row.usages}×`}` : 'Not cited yet'}</span>
          </p>
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              type="button"
              variant="icon"
              size="icon-xs"
              aria-label={`Actions for ${row.source.title || row.key}`}
              className="shrink-0 opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100 data-[state=open]:opacity-100 pointer-coarse:opacity-100"
            >
              <MoreHorizontal />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56">
            <DropdownMenuItem onSelect={onCite}>
              <Quote />
              Cite at cursor
            </DropdownMenuItem>
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
            <DropdownMenuItem onSelect={() => void copyBibtex()}>
              <ClipboardCopy />
              Copy BibTeX
            </DropdownMenuItem>
            {onVerify && (
              <DropdownMenuItem onSelect={onVerify}>
                <RefreshCw />
                {row.verified ? 'Refresh from registry' : 'Verify against registry'}
              </DropdownMenuItem>
            )}
            <DropdownMenuItem onSelect={() => setEditing(true)}>
              <Pencil />
              Edit details
            </DropdownMenuItem>
            {row.inLibrary && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem destructive onSelect={onRemove}>
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
          <Spinner /> Checking the registry…
        </p>
      )}
      {editing && (
        <SourceEditor
          source={row.source}
          onCancel={() => setEditing(false)}
          onSave={(patch) => {
            onEdit(patch);
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
 * Each source says whether its metadata was *verified* — copied from a
 * registry or from a source the assistant actually read — or typed. Adding
 * by DOI or arXiv id resolves against the registry, never trusting what was
 * typed; imported BibTeX stays unverified until the author checks it.
 */
export function SourcesPanel() {
  const { doc } = useEditorState();
  const { upsertSources, updateSource, removeSource, setCitationStyle } = useEditorActions();
  const bibliography = useBibliography();
  const cite = useCiteAtCursor();
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
  const libraryKeys = useMemo(
    () => new Set(library.map((source) => canonicalCitationKey(source.key))),
    [library],
  );

  const rows = useMemo(() => {
    const cited: Row[] = bibliography.entries.map((entry) => ({
      key: entry.key,
      source: entry.source,
      number: bibliography.style === 'author-year' ? undefined : entry.number,
      usages: entry.usages.length,
      firstUsage: entry.usages[0],
      inLibrary: libraryKeys.has(entry.key),
      verified: entry.verified,
    }));
    const citedKeys = new Set(cited.map((row) => row.key));
    const saved: Row[] = library
      .filter((source) => !citedKeys.has(canonicalCitationKey(source.key)))
      .map((source) => ({
        key: canonicalCitationKey(source.key),
        source,
        usages: 0,
        inLibrary: true,
        verified: isVerifiedSource(source),
      }));
    const q = filter.trim().toLowerCase();
    const matches = (row: Row) =>
      !q ||
      [row.source.title, row.source.authors, row.source.venue, row.source.year, row.key]
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
    const key = canonicalCitationKey(intent.sourceKey);
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

  const unverified = useMemo(
    () => [...rows.cited, ...rows.saved].filter((row) => !row.verified).length,
    [rows],
  );

  const add = async (event: FormEvent) => {
    event.preventDefault();
    const value = identifier.trim();
    if (!value) return;
    setAdding(true);
    setAddError(null);
    try {
      const source = await resolveSource(value);
      upsertSources([source]);
      setIdentifier('');
      toast({ title: 'Added to sources', description: source.title });
    } catch (error) {
      setAddError(resolveError(error));
    } finally {
      setAdding(false);
    }
  };

  const verify = async (row: Row) => {
    const id = resolvableIdentifier(row.source);
    if (!id) return;
    setVerifying(row.key);
    try {
      const source = await resolveSource(id);
      // Stored under the row's own key, so every citation of it picks it up.
      upsertSources([{ ...source, key: row.source.key }]);
      toast({ title: 'Verified', description: source.title });
    } catch (error) {
      toast({ title: 'Could not verify', description: resolveError(error), variant: 'error' });
    } finally {
      setVerifying(null);
    }
  };

  const edit = (row: Row, patch: Partial<CitationSource>) => {
    if (row.inLibrary) updateSource(row.source.key, patch);
    else upsertSources([{ ...row.source, ...patch }]);
  };

  const exportBibtex = () => {
    const all = [...bibliography.entries.map((entry) => entry.source), ...rows.saved.map((row) => row.source)];
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
      description: skipped ? `${skipped} entr${skipped === 1 ? 'y' : 'ies'} without a title were skipped.` : 'Verify them against their DOI or arXiv id from each entry’s menu.',
    });
  };

  const renderRows = (list: Row[]) => (
    <ul>
      {list.map((row) => (
        <SourceRow
          key={row.key}
          row={row}
          verifying={verifying === row.key}
          highlighted={highlighted === row.key}
          onCite={() => {
            const block = cite([row.source]);
            if (block) toast({ title: 'Citation inserted' });
          }}
          onVerify={resolvableIdentifier(row.source) ? () => void verify(row) : null}
          onEdit={(patch) => edit(row, patch)}
          onRemove={() => removeSource(row.source.key)}
        />
      ))}
    </ul>
  );

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="shrink-0 space-y-2.5 px-3 pb-2 pt-3">
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
                placeholder="Add by DOI, arXiv id or S2 id"
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

        <div className="flex min-w-0 flex-wrap items-center gap-1">
          <span aria-hidden="true" className="pr-0.5 text-xs text-muted-foreground">
            Style
          </span>
          <div role="radiogroup" aria-label="Citation style" className="flex flex-wrap items-center gap-0.5">
            {STYLES.map((option) => {
              const active = (doc.citationStyle ?? null) === option.value;
              return (
                <button
                  key={option.label}
                  type="button"
                  role="radio"
                  aria-checked={active}
                  onClick={() => setCitationStyle(option.value)}
                  className={cn(
                    'h-6 whitespace-nowrap rounded-sm px-1.5 text-xs transition-colors duration-120 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                    active
                      ? 'bg-active font-medium text-foreground'
                      : 'text-muted-foreground hover:bg-hover hover:text-foreground',
                  )}
                >
                  {option.label}
                </button>
              );
            })}
          </div>
        </div>

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
        {unverified > 0 && (
          <p className="mx-2 flex items-start gap-2 rounded-md bg-tint-yellow px-2.5 py-2 text-xs text-tint-yellow-fg">
            <AlertTriangle aria-hidden="true" className="mt-px h-3.5 w-3.5 shrink-0" />
            <span>
              {unverified} source{unverified === 1 ? ' is' : 's are'} not verified against a registry — reviewers
              check those first. Verify each from its menu.
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
              <section aria-label="Cited in this document">
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
              <p className="px-2 text-sm text-muted-foreground">Nothing matches “{filter}”.</p>
            )}
          </>
        )}
      </div>

      <Dialog open={importOpen} onOpenChange={setImportOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Import BibTeX</DialogTitle>
            <DialogDescription>
              Paste entries from Zotero, Mendeley, Google Scholar or a .bib file. They join this document’s
              sources as unverified until you check them against their DOI or arXiv id.
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
