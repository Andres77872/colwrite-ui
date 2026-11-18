import { renderToStaticMarkup } from 'react-dom/server';
import { SIGN_IN_HASH, signInClass } from '../site/links';
import { SiteFooter, SiteHeader } from '../site/SiteChrome';
import { DOCS, DOCS_HOME, docHref, type DocSlug } from './catalog';
import { DocArticle, DocsHome } from './DocLayout';

/**
 * The feature docs as standalone HTML (vite.docs.ts publishes them at
 * /docs/<slug>.html), so a shared page opens before sign-in and without
 * JavaScript. They wear the landing page's header, footer, stylesheet and
 * dark appearance: the same site.
 *
 * Rendered inside the Vite config process: relative imports only, never `@/`.
 */

export type DocPageSlug = 'index' | DocSlug;
export const docPageSlugs: readonly DocPageSlug[] = ['index', ...DOCS.map((doc) => doc.slug)];

export const docPageHref = (slug: DocPageSlug) => (slug === 'index' ? DOCS_HOME : docHref(slug));

export function renderDoc(slug: DocPageSlug, { stylesheets }: { stylesheets: readonly string[] }) {
  const doc = DOCS.find((entry) => entry.slug === slug);
  const title = doc ? `${doc.title} · ColWrite docs` : 'Docs · ColWrite';
  const description = doc?.summary ?? 'How every ColWrite feature works: writing, citing, the assistant, review, workspaces and export.';
  const html = renderToStaticMarkup(
    <html lang="en" data-theme="dark" style={{ colorScheme: 'dark' }}>
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <meta name="color-scheme" content="dark" />
        <meta name="theme-color" content="#191919" />
        <meta name="description" content={description} />
        <title>{title}</title>
        <link rel="icon" href="/favicon.svg" type="image/svg+xml" />
        {stylesheets.map((href) => (
          <link key={href} rel="stylesheet" href={href} />
        ))}
        <link rel="stylesheet" href="/docs/docs.css" />
      </head>
      <body className="min-h-dvh bg-background text-foreground antialiased">
        <a
          href="#article"
          className="sr-only focus:not-sr-only focus:fixed focus:left-2 focus:top-2 focus:z-[var(--z-floating)] focus:rounded-md focus:bg-background focus:px-3 focus:py-2"
        >
          Skip to content
        </a>
        <SiteHeader
          section="docs"
          signIn={
            <a href={`/${SIGN_IN_HASH}`} className={signInClass()}>
              Sign in
            </a>
          }
        />
        {doc ? <DocArticle doc={doc} /> : <DocsHome />}
        <SiteFooter />
      </body>
    </html>,
  );
  return `<!doctype html>\n${html}\n`;
}

/** A page of the old user wiki, sent on to the docs page that replaced it. */
export function renderRedirect(to: DocPageSlug) {
  const href = docPageHref(to);
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta http-equiv="refresh" content="0; url=${href}"><link rel="canonical" href="${href}"><title>Moved to the docs</title></head>
<body><p>This page moved to <a href="${href}">the ColWrite docs</a>.</p></body></html>
`;
}
