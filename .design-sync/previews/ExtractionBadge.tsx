import { describeExtraction, ExtractionBadge, PanelHeader } from 'colwrite-ui';
import { FileText, Library } from 'lucide-react';

// The whole vocabulary in one cell, then the two compositions it ships in:
// a library row (badge inside the row button, so no `describe`) and the profile
// uploads list (badge stands alone, so `describe` is on).

const STATUSES = ['ready', 'running', 'pending', 'failed', 'unsupported', null] as const;

export function EveryStatus() {
  return (
    <div className="w-full max-w-md space-y-2 rounded-lg border border-border bg-card p-4">
      {STATUSES.map((status) => (
        <div key={String(status)} className="flex items-start gap-3">
          <code className="w-24 shrink-0 pt-0.5 font-mono text-2xs text-muted-foreground">
            {status === null ? 'null' : status}
          </code>
          <span className="w-20 shrink-0">
            <ExtractionBadge status={status} />
          </span>
          <span className="min-w-0 flex-1 text-xs text-muted-foreground">
            {describeExtraction(status).hint}
          </span>
        </div>
      ))}
    </div>
  );
}

export function FailedWithError() {
  return (
    <div className="w-full max-w-md space-y-3 rounded-lg border border-border bg-card p-4">
      <div>
        <p className="flex items-center gap-2 text-sm font-medium">
          workshop-scan-2019.pdf
          <ExtractionBadge
            status="failed"
            describe
            error="upstream converter timed out after 120s (attempt 3 of 3)"
          />
        </p>
        <p className="mt-1 break-words text-xs text-muted-foreground">
          upstream converter timed out after 120s (attempt 3 of 3)
        </p>
      </div>
      <div>
        <p className="flex items-center gap-2 text-sm font-medium">
          neurips-poster-photo.pdf
          <ExtractionBadge
            status="unsupported"
            describe
            error="no text layer on pages 1–14; the file appears to be a photographic scan"
          />
        </p>
        <p className="mt-1 break-words text-xs text-muted-foreground">
          no text layer on pages 1–14; the file appears to be a photographic scan
        </p>
      </div>
    </div>
  );
}

export function InALibraryRow() {
  const rows = [
    { filename: 'attention-2017.pdf', status: 'ready' as const, meta: '2.1 MB · 15p · Unfiled' },
    {
      filename: 'scaling-laws-2020.pdf',
      status: 'running' as const,
      meta: '4.8 MB · 30p · Transformers',
    },
    { filename: 'chinchilla-2022.pdf', status: 'pending' as const, meta: '1.4 MB · Transformers' },
    {
      filename: 'workshop-scan-2019.pdf',
      status: 'failed' as const,
      meta: '9.2 MB · 14p · Unfiled',
    },
  ];
  return (
    <div className="w-80 overflow-hidden rounded-lg border border-border bg-card">
      <PanelHeader title="Library" icon={<Library aria-hidden="true" className="h-4 w-4" />} />
      <div className="space-y-1 p-2">
        {rows.map((row) => (
          <div
            key={row.filename}
            className="flex w-full min-w-0 items-start gap-2 rounded-md border border-border/50 p-2"
          >
            <FileText aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-medium">{row.filename}</span>
              <span className="mt-1 flex flex-wrap items-center gap-x-1.5 gap-y-1">
                <ExtractionBadge status={row.status} />
                <span className="truncate text-2xs text-muted-foreground">{row.meta}</span>
              </span>
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

export function InTheUploadsList() {
  const uploads = [
    { filename: 'attention-2017.pdf', status: 'ready' as const, meta: '2.1 MB · 15 pages' },
    {
      filename: 'neurips-poster-photo.pdf',
      status: 'unsupported' as const,
      meta: '6.0 MB · attached to Scaling notes',
    },
    { filename: 'chinchilla-2022.pdf', status: 'running' as const, meta: '1.4 MB' },
  ];
  return (
    <div className="w-full max-w-md rounded-lg border border-border bg-card p-4">
      <p className="text-md font-semibold">Uploads</p>
      <ul className="mt-2 divide-y divide-border/50">
        {uploads.map((upload) => (
          <li key={upload.filename} className="py-2.5">
            <p className="truncate text-sm font-medium">{upload.filename}</p>
            <p className="mt-1 flex flex-wrap items-center gap-x-1.5 gap-y-1 text-2xs text-muted-foreground">
              <ExtractionBadge status={upload.status} describe />
              <span>{upload.meta}</span>
            </p>
          </li>
        ))}
      </ul>
    </div>
  );
}
