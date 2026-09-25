import { Button, Input } from 'colwrite-ui';
import { AlertCircle, Search } from 'lucide-react';

// Ported from the Settings account rows, CollectionDialogs, panels/shared
// SearchForm and the LibraryPanel search row. The label pattern, the compact
// h-8 text-xs panel size and the invalid treatment are all the app's own.

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-sm text-muted-foreground">{label}</span>
      {children}
      {hint && <span className="text-2xs text-muted-foreground">{hint}</span>}
    </label>
  );
}

function Form({ children }: { children: React.ReactNode }) {
  return (
    <div className="w-full max-w-sm rounded-lg border border-border bg-card p-3">{children}</div>
  );
}

export function LabelledFields() {
  return (
    <Form>
      <div className="flex flex-col gap-3">
        <Field label="Display name">
          <Input defaultValue="Ada Lovelace" maxLength={120} />
        </Field>
        <Field label="Affiliation">
          <Input placeholder="University or lab" maxLength={160} />
        </Field>
        <Field label="Time zone" hint="Detected from your browser.">
          <Input defaultValue="Europe/Madrid" maxLength={64} />
        </Field>
      </div>
    </Form>
  );
}

export function SearchRow() {
  return (
    <Form>
      <div className="flex flex-col gap-3">
        <div className="flex items-center gap-2">
          <div className="relative min-w-0 flex-1">
            <Search
              aria-hidden="true"
              className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground"
            />
            <Input
              type="search"
              className="pl-8"
              aria-label="Search arXiv"
              placeholder="Search arXiv…"
              defaultValue="scaling laws"
            />
          </div>
          <Button type="submit" size="sm">
            Search
          </Button>
        </div>
        <div className="relative">
          <Search
            aria-hidden="true"
            className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground"
          />
          <Input
            type="search"
            className="h-8 pl-7 text-xs"
            aria-label="Search inside your PDFs"
            placeholder="Search inside your PDFs…"
          />
        </div>
      </div>
    </Form>
  );
}

export function Invalid() {
  return (
    <Form>
      <label className="flex flex-col gap-1.5">
        <span className="text-sm font-medium">
          Type <strong>Scaling notes</strong> to confirm
        </span>
        <Input
          className="border-destructive/60"
          aria-label="Type Scaling notes to confirm deletion"
          aria-invalid
          aria-describedby="input-preview-mismatch"
          defaultValue="Scaling note"
        />
        <p
          id="input-preview-mismatch"
          role="alert"
          className="flex items-start gap-1.5 text-xs text-destructive"
        >
          <AlertCircle aria-hidden="true" className="mt-px h-3.5 w-3.5 shrink-0" />
          <span className="min-w-0 break-words">
            That does not match the folder name yet.
          </span>
        </p>
      </label>
    </Form>
  );
}

export function Disabled() {
  return (
    <Form>
      <div className="flex flex-col gap-3">
        <Field label="Folder name" hint="Locked while the folder is saving.">
          <Input defaultValue="Scaling notes" disabled />
        </Field>
        <Field label="Parent folder">
          <Input placeholder="Top level" disabled />
        </Field>
        <Field label="Storage path">
          <Input defaultValue="/library/scaling-notes" readOnly />
        </Field>
      </div>
    </Form>
  );
}

export function TypesAndSizes() {
  return (
    <Form>
      <div className="flex flex-col gap-3">
        <Field label="Document title">
          <Input
            className="h-8 max-w-sm text-xl font-semibold"
            aria-label="Document title"
            defaultValue="Transformers, revisited"
          />
        </Field>
        <Field label="Password">
          <Input type="password" autoComplete="current-password" defaultValue="hunter2hunter2" />
        </Field>
        <div className="grid grid-cols-2 gap-2">
          <label className="space-y-1 text-2xs font-medium text-muted-foreground">
            <span>Year or range</span>
            <Input className="h-8 text-xs" aria-label="Year filter" defaultValue="2020-2026" />
          </label>
          <label className="space-y-1 text-2xs font-medium text-muted-foreground">
            <span>Min citations</span>
            <Input
              type="number"
              min={0}
              step={1}
              className="h-8 text-xs"
              aria-label="Minimum citation count"
              defaultValue="250"
            />
          </label>
        </div>
      </div>
    </Form>
  );
}
