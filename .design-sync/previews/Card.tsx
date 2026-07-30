import {
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from 'colwrite-ui';
import { ExternalLink, FileDown, MessageSquare, ScanText } from 'lucide-react';

export function Canonical() {
  return (
    <Card className="w-full max-w-sm">
      <CardHeader>
        <CardTitle className="text-md">vaswani-2017-attention.pdf</CardTitle>
        <CardDescription>Uploaded 12 Mar · 2.4 MB · 15 pages</CardDescription>
      </CardHeader>
      <CardContent>
        <p className="text-sm leading-relaxed text-muted-foreground">
          Converted to text, so the assistant can quote this paper directly while you draft
          Related Work.
        </p>
        <div className="mt-3">
          <Badge variant="success">Ready</Badge>
        </div>
      </CardContent>
      <CardFooter className="justify-end gap-2">
        <Button variant="ghost" size="sm">
          Remove
        </Button>
        <Button size="sm">Attach to document</Button>
      </CardFooter>
    </Card>
  );
}

export function SearchResult() {
  return (
    <Card asChild className="w-full max-w-sm p-3 transition-colors hover:border-border/80">
      <article>
        <div className="mb-1.5 flex items-center justify-between gap-2">
          <span className="text-xs tabular-nums text-muted-foreground">#3</span>
          <Badge variant="secondary" className="tabular-nums">
            91% match
          </Badge>
        </div>
        <h3 className="text-sm font-medium leading-snug">
          <a className="rounded-sm text-primary hover:underline" href="#result">
            Sparse Routing Without Load Imbalance
          </a>
        </h3>
        <p className="mt-1 text-xs text-muted-foreground">
          Duarte, Wei · arXiv:2311.08872 · v2, Nov 2023
        </p>
        <p className="mt-2 text-xs leading-relaxed text-foreground/80">
          Expert routing degrades once token assignment saturates a single expert. We add a
          capacity-aware auxiliary loss and recover dense-model quality at a third of the
          activated parameters.
        </p>
        <div className="mt-2.5 flex flex-wrap items-center gap-3 text-xs">
          <a
            className="inline-flex items-center gap-1 rounded-sm text-muted-foreground transition-colors hover:text-foreground"
            href="#arxiv"
          >
            <ExternalLink aria-hidden="true" className="h-3 w-3" />
            arXiv
          </a>
          <a
            className="inline-flex items-center gap-1 rounded-sm text-muted-foreground transition-colors hover:text-foreground"
            href="#pdf"
          >
            <FileDown aria-hidden="true" className="h-3 w-3" />
            PDF
          </a>
        </div>
      </article>
    </Card>
  );
}

export function FeatureTile() {
  return (
    <Card className="w-full max-w-sm p-4">
      <div className="flex items-center gap-3">
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-md bg-primary/10 text-primary">
          <ScanText aria-hidden="true" className="h-4 w-4" />
        </span>
        <h3 className="text-sm font-medium">Citations that stay resolved</h3>
      </div>
      <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
        Every inline citation keeps its BibTeX key, so the reference list rebuilds itself as the
        draft moves.
      </p>
    </Card>
  );
}

export function RowList() {
  const chats = [
    { title: 'Tighten the abstract', meta: '12 messages · 2h ago' },
    { title: 'Prior work on late interaction', meta: '31 messages · yesterday' },
    { title: 'Rewrite Section 4 for the rebuttal', meta: '8 messages · 3 Mar' },
  ];
  return (
    <Card className="w-full max-w-sm">
      <CardHeader className="pb-3">
        <CardTitle className="text-sm">Assistant chats</CardTitle>
        <CardDescription>Attention Is All You Need, Revisited</CardDescription>
      </CardHeader>
      <CardContent className="p-0">
        <ul className="divide-y divide-border/50 border-t border-border/50">
          {chats.map((chat) => (
            <li key={chat.title} className="flex items-start gap-2 px-4 py-2.5">
              <MessageSquare
                aria-hidden="true"
                className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground"
              />
              <span className="min-w-0">
                <span className="block truncate text-sm">{chat.title}</span>
                <span className="block text-xs text-muted-foreground">{chat.meta}</span>
              </span>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}
