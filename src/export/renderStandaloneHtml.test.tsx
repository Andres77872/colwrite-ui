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
