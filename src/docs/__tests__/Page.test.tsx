import { describe, expect, it } from 'vitest';
import { DOCS, WIKI_REDIRECTS } from '../catalog';
import { docPageSlugs, renderDoc, renderRedirect, type DocPageSlug } from '../Page';

const STYLESHEETS = ['/assets/index-test.css'];

function page(slug: DocPageSlug) {
  return new DOMParser().parseFromString(renderDoc(slug, { stylesheets: STYLESHEETS }), 'text/html');
}

const hrefs = (doc: Document, selector: string) =>
  Array.from(doc.querySelectorAll<HTMLAnchorElement>(selector), (link) => link.getAttribute('href'));

describe('the feature docs', () => {
  it('share the landing page’s stylesheet and dark appearance', () => {
    const doc = page('editor');
    expect(doc.documentElement.dataset.theme).toBe('dark');
    expect(hrefs(doc, 'link[rel="stylesheet"]')).toEqual([...STYLESHEETS, '/docs/docs.css']);
  });

  it('wear the site header and footer, with Docs as the current section', () => {
    const doc = page('editor');
    const site = doc.querySelector('nav[aria-label="Site"]')!;
    expect(site.querySelector('[aria-current="page"]')?.textContent).toBe('Docs');
    expect(hrefs(doc, 'header a').includes('/#sign-in')).toBe(true);
    expect(doc.querySelector('footer nav[aria-label="Docs links"]')).not.toBeNull();
  });

  it('lay a page out with its rail, its sections and the next page', () => {
    const doc = page('editor');
    expect(doc.querySelector('h1')?.textContent).toBe('Editor and blocks');
    expect(doc.querySelector('aside nav[aria-label="Docs"] [aria-current="page"]')?.textContent).toBe('Editor and blocks');
    expect(doc.querySelectorAll('nav[aria-labelledby="toc-heading"] a').length).toBeGreaterThan(2);
    expect(doc.querySelector('nav[aria-label="More docs"]')?.textContent).toContain('Equations');
    // Phones get the same list behind a disclosure, without script.
    expect(doc.querySelector('details nav[aria-label="Docs"]')).not.toBeNull();
    expect(doc.querySelector('script')).toBeNull();
  });

  it('give every page its facts at a glance and real content', () => {
    for (const { slug } of DOCS) {
      const doc = page(slug);
      expect(doc.querySelector('article .docs-facts'), slug).not.toBeNull();
      expect(doc.querySelectorAll('article h2').length, slug).toBeGreaterThan(1);
    }
  });

  it('embed only document content, each beside the feature it shows', () => {
    const embeds = (slug: DocPageSlug) =>
      Array.from(page(slug).querySelectorAll('iframe[data-colwrite-example]'), (frame) =>
        new URL(frame.getAttribute('src')!, 'https://colwrite.test').searchParams.get('view'),
      );
    expect(embeds('equations')).toEqual(['equation']);
    expect(embeds('tables-charts')).toEqual(['table', 'chart']);
    expect(embeds('diagrams-figures')).toEqual(['diagram', 'figure']);
    expect(embeds('citations')).toEqual(['citations']);
    for (const slug of ['index', 'workspaces', 'export', 'assistant', 'library', 'history'] as const) {
      expect(embeds(slug), slug).toEqual([]);
    }
  });

  it('list every page on their home', () => {
    const listed = hrefs(page('index'), 'main a');
    for (const doc of DOCS) expect(listed).toContain(`/docs/${doc.slug}.html`);
  });

  it('link only to pages that exist', () => {
    const known = new Set(docPageSlugs.map((slug) => (slug === 'index' ? './' : `${slug}.html`)));
    for (const slug of docPageSlugs) {
      const doc = page(slug);
      const relative = hrefs(doc, 'article a, main a').filter(
        (href): href is string => !!href && !href.startsWith('/') && !href.startsWith('#') && !href.startsWith('http'),
      );
      for (const href of relative) expect(known.has(href.split('#')[0]!), `${slug}: ${href}`).toBe(true);
      for (const href of hrefs(doc, 'article a[href^="/docs/"]')) {
        const target = /^\/docs\/(?:([a-z-]+)\.html)?/.exec(href!)?.[1] ?? 'index';
        expect(docPageSlugs.includes(target as DocPageSlug), `${slug}: ${href}`).toBe(true);
      }
    }
  });

  it('point every in-page link at a section that exists', () => {
    const ids = new Map(docPageSlugs.map((slug) => [slug, new Set(Array.from(page(slug).querySelectorAll('[id]'), (el) => el.id))]));
    for (const slug of docPageSlugs) {
      for (const href of hrefs(page(slug), 'article a[href*="#"]')) {
        const [file, hash] = href!.split('#');
        const target = file ? (file.replace(/\.html$/, '').replace(/^\/docs\//, '') as DocPageSlug) : slug;
        if (file?.startsWith('/') && !file.startsWith('/docs/')) continue;
        expect(ids.get(target)?.has(hash!), `${slug}: ${href}`).toBe(true);
      }
    }
  });

  it('send each page of the old wiki on to the docs page that replaced it', () => {
    expect(WIKI_REDIRECTS['getting-started']).toBe('quick-start');
    for (const to of Object.values(WIKI_REDIRECTS)) expect(docPageSlugs).toContain(to);
    expect(renderRedirect('citations')).toContain('url=/docs/citations.html');
  });
});
