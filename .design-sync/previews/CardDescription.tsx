import { Badge, Card, CardContent, CardDescription, CardHeader, CardTitle } from 'colwrite-ui';

// CardDescription cannot mount alone — every cell is the real Card composition
// with the description carrying the variation.

export function Canonical() {
  return (
    <Card className="w-full max-w-sm">
      <CardHeader>
        <CardTitle className="text-md">Sparse Routing Without Load Imbalance</CardTitle>
        <CardDescription>
          Added to the library from arXiv. Cited once, in Related Work.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Badge variant="secondary" className="tabular-nums">
          91% match
        </Badge>
      </CardContent>
    </Card>
  );
}

export function MetaLine() {
  const meta = ['Duarte, Wei', 'arXiv:2311.08872', 'v2, Nov 2023', '4.1 MB'];
  return (
    <Card className="w-full max-w-sm">
      <CardHeader className="p-3">
        <CardTitle className="text-sm">duarte-2023-routing.pdf</CardTitle>
        <CardDescription className="text-xs">{meta.join(' · ')}</CardDescription>
      </CardHeader>
    </Card>
  );
}

export function Multiline() {
  return (
    <Card className="w-full max-w-sm">
      <CardHeader>
        <CardTitle className="text-md">Uploads</CardTitle>
        <CardDescription className="leading-relaxed">
          PDFs stay with your account, not with a single document. Each one is converted to text
          once, and every draft you write can quote from it afterwards.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <p className="text-sm text-muted-foreground tabular-nums">6 files · 18.4 MB</p>
      </CardContent>
    </Card>
  );
}
