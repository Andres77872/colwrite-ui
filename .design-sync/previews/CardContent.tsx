import {
  Badge,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from 'colwrite-ui';
import { Coins, FileStack, FileText } from 'lucide-react';

// CardContent cannot mount alone — every cell is the real Card composition with
// the content region carrying the variation.

export function Canonical() {
  return (
    <Card className="w-full max-w-sm">
      <CardHeader>
        <CardTitle className="text-md">Method</CardTitle>
        <CardDescription>Section 3 · 6 blocks</CardDescription>
      </CardHeader>
      <CardContent>
        <p className="text-sm leading-relaxed text-muted-foreground">
          We train the router with a capacity-aware auxiliary loss, then measure activated
          parameters per token against the dense baseline.
        </p>
      </CardContent>
    </Card>
  );
}

export function Rows() {
  const rows = [
    { key: 'vaswani2017attention', cited: '3 citations' },
    { key: 'khattab2020colbert', cited: '1 citation' },
    { key: 'duarte2023routing', cited: 'Not cited yet' },
  ];
  return (
    <Card className="w-full max-w-sm">
      <CardHeader className="pb-3">
        <CardTitle className="text-sm">Reference list</CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        <ul className="divide-y divide-border/50 border-t border-border/50">
          {rows.map((row) => (
            <li key={row.key} className="flex items-center justify-between gap-3 px-4 py-2">
              <span className="min-w-0 truncate font-mono text-xs">{row.key}</span>
              <span className="shrink-0 text-xs text-muted-foreground">{row.cited}</span>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}

export function WithoutHeader() {
  const tiles = [
    { label: 'Documents', value: '12', icon: FileText },
    { label: 'Resources', value: '6', icon: FileStack },
    { label: 'Tokens', value: '1.4M', icon: Coins },
  ];
  return (
    <Card className="w-full max-w-sm">
      <CardContent className="grid grid-cols-3 gap-3 pt-4">
        {tiles.map((tile) => {
          const Icon = tile.icon;
          return (
            <div key={tile.label}>
              <Icon aria-hidden="true" className="h-3.5 w-3.5 text-muted-foreground" />
              <p className="mt-1.5 text-lg font-semibold tabular-nums leading-none">
                {tile.value}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">{tile.label}</p>
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}

export function Dense() {
  return (
    <Card className="w-full max-w-xs">
      <CardHeader className="p-3">
        <CardTitle className="text-sm">colpali-late-interaction.pdf</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2 p-3 pt-0">
        <Badge variant="warning">Failed</Badge>
        <p className="text-xs leading-relaxed text-muted-foreground">
          Conversion did not finish. Retrying usually works.
        </p>
      </CardContent>
    </Card>
  );
}
