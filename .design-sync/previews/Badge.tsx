import { Badge, Card } from 'colwrite-ui';
import { AlertCircle, CheckCircle2, Clock, Loader2, ScanLine } from 'lucide-react';

export function Variants() {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Badge>Cited</Badge>
      <Badge variant="secondary">Open access</Badge>
      <Badge variant="outline">Preprint</Badge>
      <Badge variant="success">Supported</Badge>
      <Badge variant="warning">Mixed evidence</Badge>
      <Badge variant="info">Converting</Badge>
      <Badge variant="destructive">Contradicted</Badge>
    </div>
  );
}

export function WithIcon() {
  const states = [
    { label: 'Ready', variant: 'success' as const, icon: CheckCircle2, spin: false },
    { label: 'Converting', variant: 'info' as const, icon: Loader2, spin: true },
    { label: 'Queued', variant: 'secondary' as const, icon: Clock, spin: false },
    { label: 'Failed', variant: 'warning' as const, icon: AlertCircle, spin: false },
    { label: 'No text', variant: 'destructive' as const, icon: ScanLine, spin: false },
  ];
  return (
    <div className="flex flex-wrap items-center gap-2">
      {states.map((state) => {
        const Icon = state.icon;
        return (
          <Badge
            key={state.label}
            variant={state.variant}
            className="gap-1 px-1.5 py-0 text-2xs font-medium"
          >
            <Icon
              aria-hidden="true"
              className={state.spin ? 'h-3 w-3 animate-spin' : 'h-3 w-3'}
            />
            {state.label}
          </Badge>
        );
      })}
    </div>
  );
}

export function InCard() {
  return (
    <Card asChild className="w-full max-w-sm p-3">
      <article>
        <div className="mb-1.5 flex items-center justify-between gap-2">
          <span className="text-xs tabular-nums text-muted-foreground">#3</span>
          <div className="flex flex-wrap justify-end gap-1">
            <Badge variant="secondary">Open access</Badge>
            <Badge variant="secondary" className="tabular-nums">
              1,284 cited
            </Badge>
          </div>
        </div>
        <h3 className="text-sm font-medium leading-snug">
          Sparse Routing Without Load Imbalance
        </h3>
        <p className="mt-1 text-xs text-muted-foreground">Duarte, Wei · arXiv:2311.08872</p>
      </article>
    </Card>
  );
}

export function Dense() {
  const results = [
    { title: 'Attention Is All You Need', source: 'arXiv', authors: 'Vaswani et al. · 2017' },
    { title: 'ColBERT: Late Interaction', source: 'Crossref', authors: 'Khattab, Zaharia · 2020' },
    { title: 'Sparse Routing Without Load Imbalance', source: 'arXiv', authors: 'Duarte, Wei · 2023' },
  ];
  return (
    <div className="w-80 rounded-lg border border-border bg-popover p-2 shadow-lg">
      <p className="px-2 pb-1.5 pt-0.5 text-2xs font-medium text-muted-foreground">
        Attach a reference
      </p>
      <ul className="space-y-1">
        {results.map((result) => (
          <li
            key={result.title}
            className="flex items-start gap-2 rounded-md px-2 py-1.5 hover:bg-accent/50"
          >
            <span className="min-w-0 flex-1">
              <span className="flex items-center gap-1">
                <span className="min-w-0 flex-1 truncate text-xs">{result.title}</span>
                <Badge variant="secondary" className="h-4 shrink-0 px-1 text-2xs">
                  {result.source}
                </Badge>
              </span>
              <span className="block truncate text-xs text-muted-foreground">
                {result.authors}
              </span>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
