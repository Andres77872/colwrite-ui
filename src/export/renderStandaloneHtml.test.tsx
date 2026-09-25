import { describe, expect, it } from 'vitest';
import type { Doc } from '@/editor/types';
import kitchenSinkFixture from './fixtures/kitchen-sink.json';
import legacyHtmlFixture from './fixtures/legacy-html.json';
import paginationFixture from './fixtures/pagination.json';
import unsafeFixture from './fixtures/unsafe.json';
import {
  ExportValidationError,
  renderStandaloneHtml,
} from './renderStandaloneHtml';
import { sanitizeInlineFragment } from './sanitize';
import type { DocumentExportOptions } from './types';

const options: DocumentExportOptions = {
  profile: 'paper',
  page_size: 'A4',
  orientation: 'portrait',
  include_title: false,
  ai_beat: 'omit',
  include_references: true,
};
const snapshot = { base_version: 4, local_revision: 12, dirty: true };

const canonicalFixtures = [
  kitchenSinkFixture,
  unsafeFixture,
  legacyHtmlFixture,
  paginationFixture,
] as unknown as Doc[];

function kitchenSink(): Doc {
  return {
    version: 4,
    name: 'Kitchen sink',
    blocks: [
      { id: 'h1', type: 'heading', level: 1, html: 'Results <em>and analysis</em>' },
      {
        id: 'p1',
        type: 'paragraph',
        columns: 2,
        html: [
          'Before <span data-child-id="citation"></span> ',
          '<span data-child-id="inline-equation"></span>',
          '<span data-child-id="table"></span>',
          '<span data-child-id="display-equation"></span>',
          '<span data-child-id="graph"></span>',
          '<span data-child-id="draft"></span> after.',
        ].join(''),
        children: [
          {
            id: 'citation',
            type: 'citation',
            keys: ['10.1000/example'],
            style: 'author-year',
            locator: 'p. 4',
            sources: [{
              key: '10.1000/example',
              authors: 'Doe, Jane',
              year: '2025',
              url: 'https://example.test/paper',
            }],
          },
          { id: 'inline-equation', type: 'equation', latex: 'E=mc^2' },
          {
            id: 'table',
            type: 'table',
            rows: 2,
            cols: 2,
            data: [['A', 'B'], ['1', '2']],
            header: true,
            align: ['left', 'right'],
            caption: 'Table 1',
          },
          {
            id: 'display-equation',
            type: 'equation',
            latex: '\\\\int_0^1 x dx',
            display: true,
            numbered: true,
            labelId: 'eq-integral',
          },
          {
            id: 'graph',
            type: 'graph',
            kind: 'line',
            data: {
              values: [1, 3, 2],
              labels: ['One', 'Two', 'Three'],
              colors: ['url(file:///etc/passwd)'],
            },
            title: 'Trend',
            caption: 'Figure 1',
            xLabel: 'Time',
            yLabel: 'Value',
          },
          {
            id: 'draft',
            type: 'aiBeat',
            message: 'Try another transition',
            prompt: 'private style prompt',
            output: 'Draft output',
          },
        ],
      },
      { id: 'rule', type: 'divider' },
    ],
  };
}

describe('renderStandaloneHtml', () => {
  it('materializes every publication widget with semantic, selectable output', () => {
    const html = renderStandaloneHtml(kitchenSink(), options, snapshot);

    expect(html).toContain('<table class="export-table">');
    expect(html).toContain('<thead>');
    expect(html).toContain('<caption>Table 1</caption>');
    expect(html).toContain('Doe, 2025');
    expect(html).toContain('p. 4');
    expect(html).toContain('class="katex"');
    expect(html).toContain('class="equation-number">(1)</span>');
    expect(html).toContain('<svg');
    expect(html).toContain('<figcaption>Figure 1</figcaption>');
    expect(html).not.toContain('data-child-id');
    expect(html).not.toContain('private style prompt');
    expect(html).not.toContain('Draft output');
    expect(html).not.toContain('url(file:');
  });

  it('includes AI Beat content only in the explicit draft-card profile', () => {
    const html = renderStandaloneHtml(
      kitchenSink(),
      { ...options, ai_beat: 'draft-card' },
      snapshot,
    );

    expect(html).toContain('AI Beat draft');
    expect(html).toContain('Try another transition');
    expect(html).toContain('Draft output');
    expect(html).not.toContain('private style prompt');
  });

  it('is offline and carries deterministic artifact metadata', () => {
    const html = renderStandaloneHtml(kitchenSink(), options, snapshot);

    expect(html).toContain("default-src 'none'");
    expect(html).toContain('font-src data:');
    expect(html).toContain('data:font/woff2;base64');
    expect(html).toContain('name="colwrite-document-version" content="4"');
    expect(html).toContain('name="colwrite-local-revision" content="12"');
    expect(html).toContain('name="colwrite-export-profile" content="paper"');
    expect(html).not.toMatch(/(?:src|url)\s*=\s*["']https?:/i);
    expect(html).not.toMatch(/url\(\s*["']?https?:/i);
    expect(html).not.toContain('@import');
    expect(html).not.toContain('<script');
    expect(html).not.toContain('fonts/KaTeX_');
  });

  it('rejects duplicate placeholders instead of losing or inventing content', () => {
    const doc = kitchenSink();
    const paragraph = doc.blocks[1];
    if (paragraph.type !== 'paragraph') throw new Error('fixture is invalid');
    paragraph.html += '<span data-child-id="citation"></span>';

    expect(() => renderStandaloneHtml(doc, options, snapshot)).toThrow(ExportValidationError);
  });

  it('links every citation to its reference entry, and the entry back to each usage', () => {
    const doc = kitchenSink();
    const paragraph = doc.blocks[1];
    if (paragraph.type !== 'paragraph') throw new Error('fixture is invalid');
    // A second citation of the same paper: one entry, two back-links.
    paragraph.html += '<span data-child-id="citation-again"></span>';
    paragraph.children?.push({
      id: 'citation-again',
      type: 'citation',
      keys: ['10.1000/example'],
      style: 'author-year',
      sources: [{ key: '10.1000/example' }],
    });

    const html = renderStandaloneHtml(doc, options, snapshot);

    expect(html).toContain('<section class="references"');
    expect(html).toContain('id="ref-1"');
    expect(html).toContain('href="#ref-1"');
    expect(html).toContain('id="cite-citation"');
    expect(html).toContain('href="#cite-citation"');
    expect(html).toContain('href="#cite-citation-again"');
    // The entry, not the citation, carries the outbound link.
    expect(html).toContain('https://doi.org/10.1000/example');
    // One paper cited twice is one row.
    expect(html.match(/class="reference-item"/g)).toHaveLength(1);
  });

  it('sets an author–year citation off from the word before it, as the page does', () => {
    const doc: Doc = {
      version: 1,
      name: 'Spacing',
      citationStyle: 'author-year',
      blocks: [
        {
          id: 'p',
          type: 'paragraph',
          html: 'lengths<span data-child-id="c1"></span> and (<span data-child-id="c2"></span>)',
          children: [
            { id: 'c1', type: 'citation', keys: ['k1'], sources: [{ key: 'k1', authors: 'Ashish Vaswani', year: '2017' }] },
            { id: 'c2', type: 'citation', keys: ['k1'], sources: [{ key: 'k1', authors: 'Ashish Vaswani', year: '2017' }] },
          ],
        },
      ],
    };

    const text = renderStandaloneHtml(doc, options, snapshot).replace(/<[^>]*>/g, '');

    expect(text).toContain('lengths (Vaswani');
    // Already opened by a bracket: no gap forced inside it.
    expect(text).toContain('and ((Vaswani');
  });

  it('omits the reference list, and every link into it, when asked to', () => {
    const html = renderStandaloneHtml(
      kitchenSink(),
      { ...options, include_references: false },
      snapshot,
    );

    expect(html).not.toContain('class="references"');
    expect(html).not.toContain('href="#ref-');
    expect(html).toContain('<span class="citation">');
  });

  it('uses explicit paper dimensions and editor-faithful scaling', () => {
    const letter = renderStandaloneHtml(
      kitchenSink(),
      { ...options, page_size: 'Letter', orientation: 'landscape', profile: 'editor-faithful' },
      snapshot,
    );

    expect(letter).toContain('size:Letter landscape');
    expect(letter).toContain('profile-editor-faithful');
    expect(letter).toContain('zoom:1');
  });

  it.each(canonicalFixtures.map((fixture) => [fixture.name, fixture] as const))(
    'renders canonical fixture %s without active or unresolved markup',
    (_name, fixture) => {
      const html = renderStandaloneHtml(
        fixture,
        options,
        { base_version: fixture.version, local_revision: 0, dirty: false },
      );

      expect(html).toMatch(/^<!doctype html>/);
      expect(html).not.toContain('data-child-id');
      expect(html).not.toMatch(/<(?:script|iframe|object|embed)\b/i);
      expect(html).not.toMatch(/\son[a-z]+\s*=/i);
    },
  );
});

describe('sanitizeInlineFragment', () => {
  it('accepts both quote styles while removing executable and active markup', () => {
    const result = sanitizeInlineFragment(
      "<p onclick=\"steal()\">Safe <span data-child-id='c1'><img src=\"https://evil.test\"></span>"
      + '<script>alert(1)</script><a href="javascript:alert(2)" style="color:red">link</a></p>',
    );

    expect(result.placeholderIds).toEqual(['c1']);
    expect(result.html).toContain('Safe');
    expect(result.html).toContain('<a>link</a>');
    expect(result.html).not.toContain('onclick');
    expect(result.html).not.toContain('script');
    expect(result.html).not.toContain('javascript:');
    expect(result.html).not.toContain('evil.test');
    expect(result.html).not.toContain('color:red');
  });
});

describe('structured figures', () => {
  const spec = (caption: string | null) =>
    JSON.stringify({
      ...(caption ? { caption } : {}),
      nodes: [
        { id: 'q', label: 'Q', role: 'input' },
        { id: 'attn', label: 'Attention $\\alpha$', role: 'attention' },
      ],
      edges: ['q -> attn'],
    });

  function figureDoc(): Doc {
    return {
      version: 1,
      name: 'Figures',
      blocks: [
        { id: 'f1', type: 'code', language: 'figure', text: spec('The first figure.') },
        { id: 'f2', type: 'code', language: 'figure', text: spec(null) },
        { id: 'f3', type: 'code', language: 'figure', text: spec('The second figure, $x^2$.') },
        { id: 'bad', type: 'code', language: 'figure', text: '{"nodes": [' },
      ],
    };
  }

  it('draws figures as SVG with numbered captions, and prints a broken spec as code', () => {
    const html = renderStandaloneHtml(figureDoc(), options, snapshot);
    expect(html.match(/<figure class="export-block export-figure"/g)).toHaveLength(3);
    expect(html).toContain('Figure 1.');
    expect(html).toContain('Figure 2.');
    // The uncaptioned figure is not numbered, so the third one is Figure 2.
    expect(html).not.toContain('Figure 3.');
    expect(html).toContain('The second figure,');
    expect(html).toContain('class="katex"');
    // Nothing the author wrote goes missing: the broken spec is printed.
    expect(html).toContain('<pre class="export-block export-code" data-language="figure"><code>{&quot;nodes&quot;: [</code></pre>');
    // Pattern ids are unique per figure on the page.
    expect(html).toContain('cwfig-f1');
    expect(html).toContain('cwfig-f3');
  });

  it('sizes only the figure\'s own svg, never the KaTeX glyphs drawn inside it', () => {
    const doc: Doc = {
      version: 1,
      blocks: [
        {
          id: 'f',
          type: 'code',
          language: 'figure',
          text: JSON.stringify({
            caption: 'Root $\\sqrt{d_k}$ and $\\overrightarrow{AB}$',
            nodes: [{ id: 's', label: 'Scale $\\frac{1}{\\sqrt{d_k}}$' }],
          }),
        },
      ],
    };
    for (const profile of ['paper', 'editor-faithful'] as const) {
      const page = new DOMParser().parseFromString(
        renderStandaloneHtml(doc, { ...options, profile }, snapshot),
        'text/html',
      );
      const figure = page.querySelector('figure.export-figure')!;
      const root = figure.querySelector('.figure-canvas > svg')!;
      // Radicals and over-arrows are inner <svg>s with viewBoxes like
      // 400000×1080: any `height:auto` on them collapses them to a hairline.
      const glyphs = [...figure.querySelectorAll('.katex svg')];
      expect(glyphs.length).toBeGreaterThanOrEqual(3);
      expect(figure.querySelector('figcaption .katex svg')).not.toBeNull();
      expect(figure.querySelector('foreignObject .katex svg')).not.toBeNull();
      // A parsed document has no style sheets in jsdom; the live one does.
      const style = document.createElement('style');
      style.textContent = page.querySelector('style')!.textContent;
      document.head.append(style);
      try {
        const sizing = [...style.sheet!.cssRules]
          .filter((rule): rule is CSSStyleRule => rule instanceof CSSStyleRule)
          .filter((rule) => !/\.katex/.test(rule.selectorText) && (rule.style.height || rule.style.width));
        expect(sizing.some((rule) => root.matches(rule.selectorText))).toBe(true);
        for (const glyph of glyphs) {
          expect(sizing.filter((rule) => glyph.matches(rule.selectorText)).map((rule) => rule.selectorText)).toEqual([]);
        }
      } finally {
        style.remove();
      }
    }
  });

  it('never loads a remote image, which the page\'s CSP would block anyway', () => {
    const doc: Doc = {
      version: 1,
      blocks: [
        {
          id: 'f',
          type: 'code',
          language: 'figure',
          text: JSON.stringify({
            nodes: [{ id: 'i', shape: 'image', src: 'https://example.com/a.png?leak=1', label: 'photo' }, 'b'],
            edges: ['i -> b'],
          }),
        },
      ],
    };
    const html = renderStandaloneHtml(doc, options, snapshot);
    expect(html).toContain('img-src data:;');
    expect(html).toContain('<figure class="export-block export-figure"');
    expect(html).not.toMatch(/<image\b/);
    expect(html).not.toContain('leak=1');
  });

  it('never lets markup in a label reach the page', () => {
    const doc: Doc = {
      version: 1,
      blocks: [
        {
          id: 'x',
          type: 'code',
          language: 'figure',
          text: JSON.stringify({ nodes: [{ id: 'a', label: '<img src=x onerror=alert(1)>' }] }),
        },
      ],
    };
    const html = renderStandaloneHtml(doc, options, snapshot);
    expect(html).not.toContain('<img src=x');
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;');
  });
});
