import { BrandLockup, Button } from 'colwrite-ui';

// Mark plus wordmark, with the tagline as the only variation. Ported from
// LandingPage, which uses `sm` bare in the header and `sm showTagline` in the
// footer.

const SIZES = ['sm', 'md', 'lg', 'xl'] as const;

export function Sizes() {
  return (
    <div className="flex flex-col gap-5">
      {SIZES.map((size) => (
        <div key={size} className="flex items-center gap-4">
          <span className="w-6 shrink-0 font-mono text-2xs text-muted-foreground">{size}</span>
          <BrandLockup size={size} />
        </div>
      ))}
    </div>
  );
}

export function WithTagline() {
  return (
    <div className="flex flex-col gap-5">
      {SIZES.map((size) => (
        <div key={size} className="flex items-center gap-4">
          <span className="w-6 shrink-0 font-mono text-2xs text-muted-foreground">{size}</span>
          <BrandLockup size={size} showTagline />
        </div>
      ))}
    </div>
  );
}

export function InALandingHeader() {
  return (
    <div className="w-full max-w-xl space-y-3">
      <div className="flex items-center justify-between gap-3 rounded-xl border border-border/60 bg-card px-4 py-3">
        <BrandLockup size="sm" />
        <Button size="sm">Sign in</Button>
      </div>
      <div className="flex items-center justify-between gap-3 rounded-xl border border-border/60 bg-card px-4 py-3">
        <BrandLockup size="sm" showTagline />
        <span className="shrink-0 text-2xs text-muted-foreground">v0.4.2</span>
      </div>
    </div>
  );
}

export function Constrained() {
  return (
    <div className="w-64 rounded-xl border border-border/60 bg-card p-3">
      <BrandLockup size="md" showTagline />
      <p className="mt-3 text-xs text-muted-foreground">
        In a narrow container the tagline truncates and the wordmark holds its size — the lockup
        never wraps to two lines.
      </p>
    </div>
  );
}
