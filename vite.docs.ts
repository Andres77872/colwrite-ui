import type { Plugin } from 'vite';
import { WIKI_REDIRECTS } from './src/docs/catalog';
import { docPageHref, docPageSlugs, renderDoc, renderRedirect, type DocPageSlug } from './src/docs/Page';

/**
 * In development the docs link the same stylesheets src/main.tsx imports
 * (Vite serves a CSS file requested by a `<link>` as CSS). Keep in step with
 * main.tsx.
 */
const DEV_STYLESHEETS = [
  '/node_modules/@fontsource/inter/latin-400.css',
  '/node_modules/@fontsource/inter/latin-500.css',
  '/node_modules/@fontsource/inter/latin-600.css',
  '/node_modules/@fontsource/inter/latin-700.css',
  '/src/styles/globals.css',
];

/** The stylesheets the built landing page links, so the docs share its CSS file and its cache. */
function landingStylesheets(html: string) {
  const links = [...html.matchAll(/<link\b[^>]*\brel="stylesheet"[^>]*>/g)];
  return links.map(([tag]) => /\bhref="([^"]+)"/.exec(tag)?.[1]).filter((href): href is string => !!href);
}

/** `undefined` when the path is not under the prefix; `null` for a page that does not exist. */
function slugUnder(prefix: 'docs' | 'wiki', path: string | undefined) {
  const match = new RegExp(`^/${prefix}/(?:([a-z-]+)\\.html)?$`).exec(path ?? '');
  if (!match) return undefined;
  return match[1] ?? 'index';
}

const docPageOf = (slug: string): DocPageSlug | null => docPageSlugs.find((entry) => entry === slug) ?? null;

/** Publish the feature docs as standalone HTML at their shared URLs, and send the old wiki's links on. */
export function docsPlugin(): Plugin {
  return {
    name: 'colwrite-docs',
    // After Vite's HTML plugin, so the built index.html (and its CSS links) is in the bundle.
    enforce: 'post',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const path = req.url?.split('?')[0];
        if (path === '/docs' || path === '/wiki') {
          res.writeHead(308, { Location: `${path === '/docs' ? '/docs/' : docPageHref('index')}` }).end();
          return;
        }
        const old = slugUnder('wiki', path);
        if (old !== undefined) {
          const to = WIKI_REDIRECTS[old];
          res.writeHead(308, { Location: docPageHref(to ?? 'index') }).end();
          return;
        }
        const slug = slugUnder('docs', path);
        if (slug === undefined) return next();
        const page = docPageOf(slug);
        if (page === null) {
          res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('Page not found.');
          return;
        }
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(req.method === 'HEAD' ? undefined : renderDoc(page, { stylesheets: DEV_STYLESHEETS }));
      });
    },
    generateBundle(_options, bundle) {
      const landing = bundle['index.html'];
      const stylesheets = landing?.type === 'asset' ? landingStylesheets(String(landing.source)) : [];
      if (stylesheets.length === 0) this.error('The docs found no stylesheet in the built index.html.');
      for (const slug of docPageSlugs) {
        this.emitFile({ type: 'asset', fileName: `docs/${slug}.html`, source: renderDoc(slug, { stylesheets }) });
      }
      for (const [old, to] of Object.entries(WIKI_REDIRECTS)) {
        this.emitFile({ type: 'asset', fileName: `wiki/${old}.html`, source: renderRedirect(to) });
      }
    },
  };
}
