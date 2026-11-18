import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Marked } from 'marked';
import type { Plugin } from 'vite';
import { examples, exampleUrl, isExampleId } from './src/examples/catalog';

const directory = fileURLToPath(new URL('./docs/wiki/', import.meta.url));

function escapeHtml(text: string) {
  return text
    .replaceAll('&', '&amp;')
    .replaceAll('"', '&quot;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');
}

// Only repository-authored Markdown reaches this renderer. Relative links also
// work when reading the same guides directly in the repository.
const markdown = new Marked({
  walkTokens(token) {
    if (token.type !== 'link' && token.type !== 'image') return;
    if (token.href.startsWith('../../examples/index.html?'))
      token.href = token.href.replace('../../examples/index.html', '/examples/');
    else if (token.type === 'link') token.href = token.href.replace(/^([a-z-]+)\.md(?=#|$)/, '$1.html');
  },
  renderer: {
    html({ text }) {
      const id = /^<!-- example:([a-z-]+) -->$/.exec(text.trim())?.[1];
      if (!id) return text;
      if (!isExampleId(id)) throw new Error(`Unknown wiki example: ${id}`);
      const example = examples[id];
      const url = exampleUrl(id);
      return `<figure class="wiki-example"><iframe data-colwrite-example src="${url}" title="${escapeHtml(example.title)}" height="${example.height}" loading="lazy"></iframe><figcaption>${escapeHtml(example.action)} <a href="${url}" target="_blank" rel="noreferrer">Open example <span aria-hidden="true">↗</span><span class="sr-only"> (opens in a new tab)</span></a></figcaption></figure>`;
    },
    heading({ depth, text, tokens }) {
      const id = text
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '');
      return `<h${depth} id="${id}">${this.parser.parseInline(tokens)}</h${depth}>\n`;
    },
  },
});

function readPage(slug: string) {
  const source = readFileSync(`${directory}${slug === 'index' ? 'README' : slug}.md`, 'utf8');
  const title = /^# (.+)$/m.exec(source)?.[1];
  if (!title) throw new Error(`Missing wiki title in ${slug}`);
  return { slug, title: escapeHtml(title), source };
}

function readPages() {
  const index = readPage('index');
  // The links in the wiki home are also the published guide order.
  const slugs = new Set<string>();
  markdown.walkTokens(markdown.lexer(index.source), (token) => {
    if (token.type === 'link' && /^[a-z-]+\.md$/.test(token.href)) slugs.add(token.href.slice(0, -3));
  });
  return [index, ...Array.from(slugs, readPage)];
}

type Page = ReturnType<typeof readPage>;
const href = (page: Page) => (page.slug === 'index' ? './' : `./${page.slug}.html`);

function renderPage(page: Page, pages: Page[]) {
  const links = pages
    .map(
      (entry) =>
        `<li><a href="${href(entry)}"${page === entry ? ' aria-current="page"' : ''}>${entry.slug === 'index' ? 'All guides' : entry.title}</a></li>`,
    )
    .join('');
  return `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light dark"><title>${page.title}${page.slug === 'index' ? '' : ' · ColWrite user wiki'}</title>
<link rel="icon" href="/favicon.svg" type="image/svg+xml"><link rel="stylesheet" href="/wiki/guide.css">
</head><body>
<a class="skip" href="#article">Skip to article</a>
<header><div class="bar"><a class="brand" href="./"><img src="/favicon.svg" alt="" width="28" height="28">ColWrite <span>User wiki</span></a><a class="open" href="/">Open ColWrite <span aria-hidden="true">↗</span></a></div></header>
<div class="layout"><nav class="rail" aria-label="Wiki guides"><p>Guides</p><ul>${links}</ul></nav>
<main id="article" tabindex="-1">${page.slug === 'index' ? '' : '<a class="back" href="./">← All guides</a>'}
<article>${markdown.parse(page.source, { async: false })}</article>
</main></div></body></html>\n`;
}

/** Publish standalone pages so a shared guide works ahead of sign-in and without JavaScript. */
export function wikiPlugin(): Plugin {
  return {
    name: 'colwrite-user-wiki',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const path = req.url?.split('?')[0];
        const match = /^\/wiki\/(?:([a-z-]+)\.html)?$/.exec(path ?? '');
        if (path === '/wiki') {
          res.writeHead(308, { Location: '/wiki/' }).end();
          return;
        }
        if (!match) return next();
        const pages = readPages();
        const page = pages.find((entry) => entry.slug === (match[1] ?? 'index'));
        if (!page) {
          res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('Guide not found.');
          return;
        }
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(req.method === 'HEAD' ? undefined : renderPage(page, pages));
      });
    },
    generateBundle() {
      const pages = readPages();
      for (const page of pages) {
        this.emitFile({ type: 'asset', fileName: `wiki/${page.slug}.html`, source: renderPage(page, pages) });
      }
    },
  };
}
