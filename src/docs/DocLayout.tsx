import { isValidElement, type ReactNode } from 'react';
import { ArrowLeft, ArrowRight, ArrowUpRight, BookOpen, ChevronDown, FileText, type LucideIcon } from 'lucide-react';
import { SAMPLE_PAPER_HREF } from '../site/links';
import { buttonVariants } from '../components/ui/buttonVariants';
import { cn } from '../lib/utils';
import { DOC_GROUPS, DOCS, DOCS_HOME, docHref, docsIn, type Doc, type DocSlug } from './catalog';
import { docContent } from './content';

// The docs' two layouts: a page with its rail, article and contents, and the
// docs' home. Rendered inside the Vite config process (vite.docs.ts):
// relative imports only, never `@/`.

type DocPageSlug = 'index' | DocSlug;

const groupLabel = (doc: Doc) => DOC_GROUPS.find((group) => group.id === doc.group)?.label;

type Heading = { id: string; text: string };

function textOf(node: ReactNode): string {
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(textOf).join('');
  if (isValidElement<{ children?: ReactNode }>(node)) return textOf(node.props.children);
  return '';
}

/** The article's sections, for "On this page". */
function headingsOf(node: ReactNode, found: Heading[] = []): Heading[] {
  if (Array.isArray(node)) node.forEach((child) => headingsOf(child, found));
  else if (isValidElement<{ id?: string; children?: ReactNode }>(node)) {
    if (node.type === 'h2' && node.props.id) found.push({ id: node.props.id, text: textOf(node.props.children) });
    else headingsOf(node.props.children, found);
  }
  return found;
}

const railLink =
  'flex items-center gap-2.5 rounded-md px-2.5 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-hover hover:text-foreground aria-[current=page]:bg-active aria-[current=page]:font-medium aria-[current=page]:text-foreground';

function DocsRail({ current }: { current: DocPageSlug }) {
  return (
    <div className="space-y-6">
      <a href={DOCS_HOME} aria-current={current === 'index' ? 'page' : undefined} className={railLink}>
        <BookOpen aria-hidden="true" className="size-4 shrink-0" />
        All docs
      </a>
      {DOC_GROUPS.map((group) => (
        <div key={group.id}>
          <p className="px-2.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground/80">{group.label}</p>
          <ul className="mt-2 space-y-0.5">
            {docsIn(group.id).map((doc) => (
              <li key={doc.slug}>
                <a href={docHref(doc.slug)} aria-current={current === doc.slug ? 'page' : undefined} className={railLink}>
                  <doc.icon aria-hidden="true" className="size-4 shrink-0" />
                  {doc.title}
                </a>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}

/** Below the rail's breakpoint, the same list behind a disclosure: no script needed. */
function MobileDocsMenu({ current }: { current: DocPageSlug }) {
  return (
    <details className="group mb-8 rounded-xl border border-border bg-card lg:hidden print:hidden">
      <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2 px-4 text-sm font-medium [&::-webkit-details-marker]:hidden">
        <BookOpen aria-hidden="true" className="size-4 text-muted-foreground" />
        Browse the docs
        <ChevronDown aria-hidden="true" className="ml-auto size-4 text-muted-foreground transition-transform group-open:rotate-180" />
      </summary>
      <nav aria-label="Docs" className="border-t border-border p-2 pb-3">
        <DocsRail current={current} />
      </nav>
    </details>
  );
}

function Pager({ doc }: { doc: Doc }) {
  const index = DOCS.findIndex((entry) => entry.slug === doc.slug);
  const previous = index > 0 ? DOCS[index - 1] : undefined;
  const next = DOCS[index + 1];
  const card =
    'group flex min-h-16 flex-col justify-center rounded-xl border border-border px-4 py-3 transition-colors hover:border-border-strong hover:bg-hover';
  return (
    <nav aria-label="More docs" className="mt-14 grid gap-3 border-t border-border pt-8 sm:grid-cols-2 print:hidden">
      {previous ? (
        <a href={docHref(previous.slug)} className={card}>
          <span className="flex items-center gap-1 text-xs text-muted-foreground">
            <ArrowLeft aria-hidden="true" className="size-3.5" /> Previous
          </span>
          <span className="mt-0.5 text-sm font-medium text-foreground">{previous.title}</span>
        </a>
      ) : (
        <a href={DOCS_HOME} className={card}>
          <span className="flex items-center gap-1 text-xs text-muted-foreground">
            <ArrowLeft aria-hidden="true" className="size-3.5" /> Back
          </span>
          <span className="mt-0.5 text-sm font-medium text-foreground">All docs</span>
        </a>
      )}
      {next && (
        <a href={docHref(next.slug)} className={cn(card, 'sm:items-end sm:text-right')}>
          <span className="flex items-center gap-1 text-xs text-muted-foreground">
            Next <ArrowRight aria-hidden="true" className="size-3.5" />
          </span>
          <span className="mt-0.5 text-sm font-medium text-foreground">{next.title}</span>
        </a>
      )}
    </nav>
  );
}

export function DocArticle({ doc }: { doc: Doc }) {
  const content = docContent[doc.slug];
  const headings = headingsOf(content);
  return (
    <div className="mx-auto max-w-6xl px-4 sm:px-6">
      <div className="gap-10 py-10 lg:grid lg:grid-cols-[13.5rem_minmax(0,1fr)] lg:py-14 xl:grid-cols-[13.5rem_minmax(0,1fr)_11rem] xl:gap-12">
        <aside className="hidden lg:block print:hidden">
          <nav aria-label="Docs" className="sticky top-20 max-h-[calc(100dvh-6rem)] overflow-y-auto pb-6">
            <DocsRail current={doc.slug} />
          </nav>
        </aside>

        <main id="article" tabIndex={-1} className="min-w-0 focus:outline-hidden">
          <MobileDocsMenu current={doc.slug} />
          <p className="mb-3 flex items-center gap-1.5 text-sm text-muted-foreground print:hidden">
            <a href={DOCS_HOME} className="hover:text-foreground">
              Docs
            </a>
            <span aria-hidden="true">/</span>
            <span>{groupLabel(doc)}</span>
          </p>
          <article aria-labelledby="doc-title" className="docs-prose max-w-[46rem]">
            <h1 id="doc-title">{doc.title}</h1>
            {content}
          </article>
          <div className="max-w-[46rem]">
            <Pager doc={doc} />
          </div>
        </main>

        {headings.length > 0 && (
          <aside className="hidden xl:block print:hidden">
            <nav aria-labelledby="toc-heading" className="sticky top-20">
              <p id="toc-heading" className="text-xs font-semibold uppercase tracking-wider text-muted-foreground/80">
                On this page
              </p>
              <ul className="mt-3 space-y-2 border-l border-border">
                {headings.map((heading) => (
                  <li key={heading.id}>
                    <a
                      href={`#${heading.id}`}
                      className="-ml-px block border-l border-transparent pl-3 text-sm leading-snug text-muted-foreground transition-colors hover:border-foreground/40 hover:text-foreground"
                    >
                      {heading.text}
                    </a>
                  </li>
                ))}
              </ul>
            </nav>
          </aside>
        )}
      </div>
    </div>
  );
}

function PanelLink({ href, icon: Icon, title, summary }: { href: string; icon: LucideIcon; title: string; summary: string }) {
  return (
    <a
      href={href}
      className="group flex items-start gap-3 rounded-xl p-3 transition-colors hover:bg-hover focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring"
    >
      <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-primary/10 text-link">
        <Icon aria-hidden="true" className="size-[18px]" />
      </span>
      <span className="min-w-0">
        <span className="flex items-center gap-1.5 text-sm font-semibold text-foreground">
          {title}
          <ArrowRight
            aria-hidden="true"
            className="size-3.5 -translate-x-1 text-muted-foreground opacity-0 transition-all group-hover:translate-x-0 group-hover:opacity-100"
          />
        </span>
        <span className="mt-0.5 block text-sm leading-relaxed text-muted-foreground">{summary}</span>
      </span>
    </a>
  );
}

export function DocsHome() {
  return (
    <main id="article" tabIndex={-1} className="focus:outline-hidden">
      <section className="relative overflow-hidden border-b border-border">
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-x-0 top-0 h-[420px] bg-[radial-gradient(50%_60%_at_50%_0%,var(--color-primary)_0%,transparent_75%)] opacity-[0.12]"
        />
        <div className="relative mx-auto max-w-6xl px-4 py-16 sm:px-6 sm:py-20">
          <p className="text-sm font-medium text-link">Documentation</p>
          <h1 className="mt-2 max-w-2xl text-balance text-4xl font-semibold tracking-tight text-white sm:text-5xl">
            ColWrite docs
          </h1>
          <p className="mt-4 max-w-2xl text-lg leading-relaxed text-muted-foreground">
            Every feature, one page each: what it does, how to use it, its options, and who in a workspace can use it.
          </p>
          <div className="mt-7 flex flex-wrap items-center gap-3">
            <a href={docHref('quick-start')} className={buttonVariants({ size: 'lg' })}>
              Quick start <ArrowRight aria-hidden="true" />
            </a>
            <a href={SAMPLE_PAPER_HREF} className={buttonVariants({ size: 'lg', variant: 'outline' })}>
              Read the sample paper <ArrowUpRight aria-hidden="true" />
            </a>
          </div>
        </div>
      </section>

      <div className="mx-auto grid max-w-6xl gap-4 px-4 py-14 sm:grid-cols-2 sm:px-6 lg:grid-cols-3">
        {DOC_GROUPS.map((group) => (
          <section key={group.id} aria-labelledby={`group-${group.id}`} className="rounded-2xl border border-border bg-card/60 p-2">
            <h2 id={`group-${group.id}`} className="px-3 pb-1 pt-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              {group.label}
            </h2>
            <ul>
              {docsIn(group.id).map((doc) => (
                <li key={doc.slug}>
                  <PanelLink href={docHref(doc.slug)} icon={doc.icon} title={doc.title} summary={doc.summary} />
                </li>
              ))}
              {group.id === 'start' && (
                <li>
                  <PanelLink
                    href={SAMPLE_PAPER_HREF}
                    icon={FileText}
                    title="The sample paper"
                    summary="A finished practice manuscript, as the HTML export writes it."
                  />
                </li>
              )}
            </ul>
          </section>
        ))}
      </div>
    </main>
  );
}
