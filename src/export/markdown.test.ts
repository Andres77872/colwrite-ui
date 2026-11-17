import { describe, expect, it } from 'vitest';
import type { Doc } from '@/editor/types';
import { reference } from '@/__tests__/agentSource';
import { documentToMarkdown } from './markdown';

const DOC: Doc = {
  name: 'Sparse experts',
  citationStyle: 'nlm-citation-sequence-brackets',
  sources: [
    reference('doi:10.5555/switch', {
      title: 'Switch Transformers', authors: 'William Fedus, Barret Zoph, Noam Shazeer', year: 2022, venue: 'JMLR',
      doi: '10.5555/switch', provider: 'crossref', state: 'verified',
    }),
    reference('doi:10.5555/gone', {
      title: 'Retracted routing', authors: 'Chidi Okafor', year: 2019, venue: 'JSM', doi: '10.5555/gone',
      provider: 'crossref', state: 'verified', flags: ['retracted'], notices: [{ type: 'retraction', date: '2024-03-12' }],
    }),
  ],
  blocks: [
    { id: 'h', type: 'heading', level: 2, html: 'Routing' },
    {
      id: 'p',
      type: 'paragraph',
      html: 'Each token goes to one expert <span data-child-id="c" contenteditable="false"></span>.<span data-child-id="beat" contenteditable="false"></span> Once <span data-child-id="r" contenteditable="false"></span>.',
      children: [
        { id: 'c', type: 'citation', keys: ['doi:10.5555/switch'], style: 'nlm-citation-sequence-brackets' },
        { id: 'r', type: 'citation', keys: ['doi:10.5555/gone'], style: 'nlm-citation-sequence-brackets' },
        { id: 'beat', type: 'aiBeat', message: 'expand', prompt: 'expand', output: { text: ' A drafted sentence.', sources: [] } },
      ],
      columns: 1,
    },
    { id: 'd', type: 'code', language: 'mermaid', text: 'graph LR\n  a --> b' },
  ],
};

describe('documentToMarkdown', () => {
  it('exports a durable draft citation and its reference without a live evidence store', () => {
    const record = reference('doi:10.1000/draft', { title: 'Durable draft evidence', year: 2026 });
    const doc: Doc = { blocks: [{
      id: 'p', type: 'paragraph', html: '<span data-child-id="draft"></span>',
      children: [{ id: 'draft', type: 'aiBeat', message: 'Write', prompt: '',
        output: { text: 'Supported [@doi:10.1000/draft].', sources: [record] } }],
    }] };
    const markdown = documentToMarkdown(doc, { includeTitle: false, includeReferences: true, aiBeat: 'draft-card' });
    expect(markdown).toContain('Supported [@doi:10.1000/draft].');
    expect(markdown).toContain('Durable draft evidence');
    const omitted = documentToMarkdown(doc, { includeTitle: false, includeReferences: true, aiBeat: 'omit' });
    expect(omitted).not.toContain('Durable draft evidence');
  });

  it('writes every block, with citations as Pandoc keys and diagrams as fences', () => {
    const markdown = documentToMarkdown(DOC, { includeTitle: true, includeReferences: false, aiBeat: 'omit' });

    expect(markdown).toBe(
      [
        '# Sparse experts',
        '',
        '## Routing',
        '',
        'Each token goes to one expert [@doi:10.5555/switch]. Once [@doi:10.5555/gone].',
        '',
        '```mermaid',
        'graph LR',
        '  a --> b',
        '```',
        '',
      ].join('\n'),
    );
  });

  it('keeps AI beat text only when asked, and appends the reference list', () => {
    const markdown = documentToMarkdown(DOC, { includeTitle: false, includeReferences: true, aiBeat: 'draft-card' });

    expect(markdown.startsWith('## Routing')).toBe(true);
    expect(markdown).toContain('[@doi:10.5555/switch]. A drafted sentence.');
    expect(markdown).toContain('## References');
    // In the page's CSL style, from the same renderer as the editor; a retraction is said in the entry.
    expect(markdown).toContain(
      '1. Fedus W, Zoph B, Shazeer N. Switch Transformers. JMLR. 2022. doi:10.5555/switch `@doi:10.5555/switch`',
    );
    expect(markdown).toContain(
      '2. Okafor C. Retracted routing. JSM. 2019. doi:10.5555/gone **Retracted:** Retraction published on 2024-03-12. `@doi:10.5555/gone`',
    );
  });

  it('leaves the reference list out when nothing is cited', () => {
    const markdown = documentToMarkdown(
      { name: 'Empty', blocks: [{ id: 'p', type: 'paragraph', html: 'Text.', children: [], columns: 1 }] },
      { includeTitle: false, includeReferences: true, aiBeat: 'omit' },
    );
    expect(markdown).toBe('Text.\n');
  });
});
