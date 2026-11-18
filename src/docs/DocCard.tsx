import { ArrowRight } from 'lucide-react';
import { docHref, type Doc } from './catalog';

// Shared by the landing page and the docs' home. Rendered inside the Vite
// config process too (vite.docs.ts): relative imports only, never `@/`.

/** One docs page as a link card: its icon, title and what it covers. */
export function DocCard({ doc }: { doc: Doc }) {
  const Icon = doc.icon;
  return (
    <a
      href={docHref(doc.slug)}
      className="group flex h-full items-start gap-3 rounded-xl border border-border bg-card p-4 transition-colors hover:border-border-strong hover:bg-hover focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring"
    >
      <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-primary/10 text-link">
        <Icon aria-hidden="true" className="size-[18px]" />
      </span>
      <span className="min-w-0">
        <span className="flex items-center gap-1.5 text-sm font-semibold text-foreground">
          {doc.title}
          <ArrowRight
            aria-hidden="true"
            className="size-3.5 -translate-x-1 text-muted-foreground opacity-0 transition-all group-hover:translate-x-0 group-hover:opacity-100"
          />
        </span>
        <span className="mt-1 block text-sm leading-relaxed text-muted-foreground">{doc.summary}</span>
      </span>
    </a>
  );
}
