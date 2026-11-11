import { describe, expect, it } from 'vitest';
import type { Doc } from '@/editor/types';
import { documentToMarkdown } from './markdown';

const DOC: Doc = {
  version: 3,
  name: 'Sparse experts',
  citationStyle: 'numeric',
  sources: [
    {
      key: '10.5555/switch',
      title: 'Switch Transformers',
      authors: 'W. Fedus, B. Zoph, N. Shazeer',
      year: '2022',
      venue: 'JMLR',
      doi: '10.5555/switch',
      provider: 'crossref',
    },
  ],
  blocks: [
    { id: 'h', type: 'heading', level: 2, html: 'Routing' },
    {
      id: 'p',
      type: 'paragraph',
      html: 'Each token goes to one expert <span data-child-id="c" contenteditable="false"></span>.<span data-child-id="beat" contenteditable="false"></span>',
      children: [
        { id: 'c', type: 'citation', keys: ['10.5555/switch'], style: 'numeric' },
        { id: 'beat', type: 'aiBeat', message: 'expand', prompt: 'expand', output: ' A drafted sentence.' },
      ],
      columns: 1,
    },
    { id: 'd', type: 'code', language: 'mermaid', text: 'graph LR\n  a --> b' },
  ],
};

describe('documentToMarkdown', () => {
  it('writes every block, with citations as Pandoc keys and diagrams as fences', () => {
    const markdown = documentToMarkdown(DOC, { includeTitle: true, includeReferences: false, aiBeat: 'omit' });

    expect(markdown).toBe(
      [
        '# Sparse experts',
        '',
        '## Routing',
        '',
        'Each token goes to one expert [@10.5555/switch].',
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
    expect(markdown).toContain('[@10.5555/switch]. A drafted sentence.');
    expect(markdown).toContain('## References');
    expect(markdown).toContain(
      '- [1] W. Fedus, B. Zoph, N. Shazeer. Switch Transformers. JMLR. 2022. <https://doi.org/10.5555/switch> `@10.5555/switch`',
    );
  });

  it('leaves the reference list out when nothing is cited', () => {
    const markdown = documentToMarkdown(
      { version: 1, name: 'Empty', blocks: [{ id: 'p', type: 'paragraph', html: 'Text.', children: [], columns: 1 }] },
      { includeTitle: false, includeReferences: true, aiBeat: 'omit' },
    );
    expect(markdown).toBe('Text.\n');
  });
});
