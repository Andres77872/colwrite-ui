import { Card, CardContent, CardDescription, CardHeader, CardTitle } from 'colwrite-ui';
import { FileText, Sparkles } from 'lucide-react';

// CardTitle cannot mount alone — every cell is the real Card composition with
// the title carrying the variation.

export function Canonical() {
  return (
    <Card className="w-full max-w-sm">
      <CardHeader>
        <CardTitle className="text-md">Retrieval-Augmented Generation at Scale</CardTitle>
        <CardDescription>arXiv:2402.10113 · 24 pages</CardDescription>
      </CardHeader>
      <CardContent>
        <p className="text-sm leading-relaxed text-muted-foreground">
          Cited from Section 2 and Section 5.
        </p>
      </CardContent>
    </Card>
  );
}

export function Scale() {
  const rows = [
    { size: 'text-lg', title: 'Usage this month', note: 'Section heading on the main canvas' },
    { size: 'text-md', title: 'Uploaded files', note: 'Card in a page-width column' },
    { size: 'text-sm', title: 'Assistant chats', note: 'Card inside a 380px side panel' },
  ];
  return (
    <div className="flex w-full max-w-sm flex-col gap-3">
      {rows.map((row) => (
        <Card key={row.size}>
          <CardHeader className="p-3">
            <CardTitle className={row.size}>{row.title}</CardTitle>
            <CardDescription className="text-xs">{row.note}</CardDescription>
          </CardHeader>
        </Card>
      ))}
    </div>
  );
}

export function WithIcon() {
  return (
    <Card className="w-full max-w-sm">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-md">
          <Sparkles aria-hidden="true" className="h-4 w-4 shrink-0 text-primary" />
          Proposed edits
        </CardTitle>
        <CardDescription>4 blocks changed · waiting for your approval</CardDescription>
      </CardHeader>
      <CardContent>
        <p className="text-sm leading-relaxed text-muted-foreground">
          Nothing is written to the document until you accept.
        </p>
      </CardContent>
    </Card>
  );
}

export function Truncated() {
  return (
    <Card className="w-full max-w-xs">
      <CardHeader className="p-3">
        <CardTitle className="flex items-center gap-2 text-sm">
          <FileText aria-hidden="true" className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          <span className="truncate">
            Capacity-Aware Expert Routing for Sparse Mixture-of-Experts Transformers
          </span>
        </CardTitle>
        <CardDescription className="truncate text-xs">
          Duarte, Wei · arXiv:2311.08872 · v2, Nov 2023
        </CardDescription>
      </CardHeader>
    </Card>
  );
}
