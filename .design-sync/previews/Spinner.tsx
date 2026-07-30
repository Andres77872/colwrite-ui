import { Button, Spinner } from 'colwrite-ui';

// Spinner is a 14px glyph with no wrapper, so every cell here shows it where
// the app actually puts it: inline before a label, inside a Button, and centred
// in a panel that is waiting on a request. It is styled through `className`
// only — the size classes below are the four the app uses.

const SIZES = [
  { className: 'h-3 w-3', note: 'h-3 w-3 — agent activity rows' },
  { className: '', note: 'default (h-3.5 w-3.5) — buttons, inline labels' },
  { className: 'h-4 w-4', note: 'h-4 w-4 — panel body waits' },
  { className: 'h-5 w-5', note: 'h-5 w-5 — full-page session check' },
];

export function Sizes() {
  return (
    <div className="w-full max-w-sm space-y-3 rounded-lg border border-border bg-card p-4">
      {SIZES.map((size) => (
        <div key={size.note} className="flex items-center gap-3">
          <span className="flex h-6 w-6 shrink-0 items-center justify-center text-primary">
            <Spinner className={size.className} />
          </span>
          <span className="font-mono text-xs text-muted-foreground">{size.note}</span>
        </div>
      ))}
    </div>
  );
}

export function InlineWithText() {
  return (
    <div
      aria-busy="true"
      className="w-full max-w-sm space-y-3 rounded-lg border border-border bg-card p-4"
    >
      <p className="flex items-center gap-2 text-sm text-muted-foreground">
        <Spinner />
        Preparing your workspace…
      </p>
      <p className="flex items-center gap-2 text-sm text-muted-foreground">
        <Spinner />
        Loading your profile…
      </p>
      <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <Spinner className="h-3 w-3" />
        Extracting text from attention-2017.pdf…
      </p>
      <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <Spinner className="h-3 w-3" />
        Thinking…
      </p>
    </div>
  );
}

export function InButtons() {
  return (
    <div className="flex flex-wrap items-center gap-3">
      <Button>
        <Spinner />
        Saving…
      </Button>
      <Button variant="outline">
        <Spinner />
        Uploading…
      </Button>
      <Button variant="secondary" size="sm">
        <Spinner />
        Searching…
      </Button>
      <Button variant="destructive" size="sm">
        <Spinner />
        Deleting…
      </Button>
      <Button variant="icon" size="icon-sm" aria-label="Searching">
        <Spinner />
      </Button>
    </div>
  );
}

export function CentredInAPanel() {
  return (
    <div
      aria-busy="true"
      className="flex h-48 w-full max-w-sm items-center justify-center rounded-lg border border-border bg-card"
    >
      <p className="flex items-center gap-2 text-sm text-muted-foreground">
        <Spinner className="h-4 w-4" />
        Searching arXiv…
      </p>
    </div>
  );
}
