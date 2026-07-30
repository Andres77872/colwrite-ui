import {
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from 'colwrite-ui';
import { MoreHorizontal, RefreshCw } from 'lucide-react';

// CardHeader cannot mount alone — every cell is the real Card composition with
// the header carrying the variation.

export function Canonical() {
  return (
    <Card className="w-full max-w-sm">
      <CardHeader>
        <CardTitle className="text-md">Attention Is All You Need, Revisited</CardTitle>
        <CardDescription>Draft · 5 sections · saved 4 minutes ago</CardDescription>
      </CardHeader>
      <CardContent>
        <p className="text-sm leading-relaxed text-muted-foreground">
          Last edit added two paragraphs to Experiments.
        </p>
      </CardContent>
    </Card>
  );
}

export function WithAction() {
  return (
    <Card className="w-full max-w-sm">
      <CardHeader className="flex-row items-start justify-between space-y-0">
        <div className="min-w-0 space-y-1.5">
          <CardTitle className="text-md">colpali-late-interaction.pdf</CardTitle>
          <CardDescription>18 pages · 4.1 MB</CardDescription>
        </div>
        <Button variant="icon" size="icon-sm" aria-label="Resource actions">
          <MoreHorizontal />
        </Button>
      </CardHeader>
      <CardContent>
        <Badge variant="info">Converting</Badge>
      </CardContent>
    </Card>
  );
}

export function TitleOnly() {
  return (
    <Card className="w-full max-w-sm">
      <CardHeader>
        <CardTitle className="text-sm">References</CardTitle>
      </CardHeader>
      <CardContent>
        <ul className="space-y-1.5 text-xs text-muted-foreground">
          <li>vaswani2017attention · Vaswani et al., 2017</li>
          <li>khattab2020colbert · Khattab &amp; Zaharia, 2020</li>
          <li>duarte2023routing · Duarte &amp; Wei, 2023</li>
        </ul>
      </CardContent>
    </Card>
  );
}

export function Dense() {
  return (
    <Card className="w-full max-w-xs">
      <CardHeader className="flex-row items-center justify-between space-y-0 p-3">
        <CardTitle className="text-sm">Extraction</CardTitle>
        <Button variant="ghost" size="xs">
          <RefreshCw />
          Retry
        </Button>
      </CardHeader>
      <CardContent className="p-3 pt-0">
        <p className="text-xs leading-relaxed text-muted-foreground">
          Conversion did not finish. Retrying usually works.
        </p>
      </CardContent>
    </Card>
  );
}
