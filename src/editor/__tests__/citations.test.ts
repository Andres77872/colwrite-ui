import { describe, expect, it } from 'vitest';
import type { Block, CitationChild, CitationSource } from '../types';
import {
  buildBibliography,
  canonicalArxivId,
  canonicalDoi,
  citationAnchorId,
  citationLabel,
  firstAuthorSurname,
  formatReference,
  referenceAnchorId,
  referenceMarker,
} from '../citations';

// ── Fixtures ──

const cite = (id: string, over: Partial<CitationChild> = {}): CitationChild => ({
  id,
  type: 'citation',
  keys: ['k1'],
  style: 'numeric',
  ...over,
});

const para = (id: string, children: CitationChild[]): Block => ({
  id,
  type: 'paragraph',
  html: children.map((child) => `<span data-child-id="${child.id}"></span>`).join(''),
  children,
});

const source = (key: string, over: Partial<CitationSource> = {}): CitationSource => ({
  key,
  title: `Title ${key}`,
  authors: 'J. Smith',
  year: '2020',
  ...over,
});

describe('firstAuthorSurname', () => {
  it.each([
    ['Smith, John', 'Smith'],
    ['J. Smith, A. Doe', 'Smith'],
    ['John Smith', 'Smith'],
    ['John Smith and Jane Doe', 'Smith'],
    ['Doe, Jane; Roe, Richard', 'Doe'],
    ['Hoffmann, J., Borgeaud, S., Mensch, A.', 'Hoffmann'],
    ['van der Berg, Jan', 'van der Berg'],
    ['Jan van der Berg', 'van der Berg'],
    ['Vaswani, A. & Shazeer, N.', 'Vaswani'],
  ])('reads %s as %s', (authors, expected) => {
    expect(firstAuthorSurname(authors)).toBe(expected);
  });

  it('has nothing to report for an empty author list', () => {
    expect(firstAuthorSurname(undefined)).toBeUndefined();
    expect(firstAuthorSurname('  ')).toBeUndefined();
  });
});

describe('canonicalDoi / canonicalArxivId', () => {
  it.each([
    'https://doi.org/10.1000/Example',
    'https://dx.doi.org/10.1000/Example',
    'doi: 10.1000/Example',
    '10.1000/Example.',
  ])('reduces %s to its bare lower-cased form', (raw) => {
    expect(canonicalDoi(raw)).toBe('10.1000/example');
  });

  it('rejects anything that is not a DOI', () => {
    expect(canonicalDoi('2103.00020')).toBeUndefined();
    expect(canonicalDoi('')).toBeUndefined();
  });

  it('strips host, version and extension from an arXiv id', () => {
    expect(canonicalArxivId('https://arxiv.org/abs/2103.00020v3')).toBe('2103.00020');
    expect(canonicalArxivId('https://arxiv.org/pdf/2103.00020.pdf')).toBe('2103.00020');
    expect(canonicalArxivId('arXiv: 2103.00020')).toBe('2103.00020');
  });
});

describe('buildBibliography', () => {
  it('numbers sources, not citations', () => {
    const blocks = [
      para('p1', [cite('c1'), cite('c2', { keys: ['k2'] })]),
      para('p2', [cite('c3'), cite('c4', { keys: ['k2'] })]),
    ];
    const bibliography = buildBibliography(blocks);

    expect(bibliography.entries.map((entry) => [entry.key, entry.number])).toEqual([
      ['k1', 1],
      ['k2', 2],
    ]);
    // Citing k1 twice is one entry with two usages, not two entries.
    expect(bibliography.byKey.get('k1')?.usages).toEqual([
      { blockId: 'p1', childId: 'c1', ordinal: 1 },
      { blockId: 'p2', childId: 'c3', ordinal: 2 },
    ]);
  });

  it('counts one citation listing the same key twice as a single usage', () => {
    const bibliography = buildBibliography([para('p1', [cite('c1', { keys: ['k1', 'k1'] })])]);
    expect(bibliography.byKey.get('k1')?.usages).toHaveLength(1);
  });

  it('ignores blank keys and trims the rest', () => {
    const bibliography = buildBibliography([
      para('p1', [cite('c1', { keys: ['  ', ' k1 '] })]),
    ]);
    expect(bibliography.entries.map((entry) => entry.key)).toEqual(['k1']);
  });

  it('fills a bare key from a richer copy of the same source elsewhere', () => {
    const blocks = [
      para('p1', [cite('c1', { sources: [{ key: 'k1', provider: 'manual' }] })]),
      para('p2', [cite('c2', { sources: [source('k1', { venue: 'NeurIPS' })] })]),
    ];
    const entry = buildBibliography(blocks).byKey.get('k1');

    expect(entry?.source).toMatchObject({
      key: 'k1',
      provider: 'manual',
      title: 'Title k1',
      venue: 'NeurIPS',
    });
    expect(entry?.unresolved).toBe(false);
  });

  it('flags an entry that never got more than a key', () => {
    const entry = buildBibliography([para('p1', [cite('c1')])]).byKey.get('k1');
    expect(entry?.unresolved).toBe(true);
  });

  it('sorts an author–year document alphabetically and keeps numeric in citation order', () => {
    const children = [
      cite('c1', { keys: ['zed'], sources: [source('zed', { authors: 'Z. Zed' })] }),
      cite('c2', { keys: ['abel'], sources: [source('abel', { authors: 'A. Abel' })] }),
    ];
    expect(buildBibliography([para('p1', children)]).entries.map((e) => e.key)).toEqual([
      'zed',
      'abel',
    ]);

    const byAuthor = children.map((child) => ({ ...child, style: 'author-year' as const }));
    expect(buildBibliography([para('p1', byAuthor)]).entries.map((e) => e.key)).toEqual([
      'abel',
      'zed',
    ]);
  });

  it('sorts entries with no author after the ones that have one', () => {
    const children = [
      cite('c1', {
        style: 'author-year',
        keys: ['anon'],
        sources: [{ key: 'anon', title: 'Anonymous' }],
      }),
      cite('c2', {
        style: 'author-year',
        keys: ['named'],
        sources: [source('named', { authors: 'Z. Zed' })],
      }),
    ];
    expect(buildBibliography([para('p1', children)]).entries.map((e) => e.key)).toEqual([
      'named',
      'anon',
    ]);
  });

  it('takes the document style from the majority, breaking ties with the first', () => {
    const majority = [
      cite('c1', { style: 'numeric' }),
      cite('c2', { style: 'author-year', keys: ['k2'] }),
      cite('c3', { style: 'author-year', keys: ['k3'] }),
    ];
    expect(buildBibliography([para('p1', majority)]).style).toBe('author-year');

    const tied = [cite('c1', { style: 'ieee' }), cite('c2', { style: 'numeric', keys: ['k2'] })];
    expect(buildBibliography([para('p1', tied)]).style).toBe('ieee');
  });

  it('defaults to numeric for a document with no citations', () => {
    expect(buildBibliography([]).style).toBe('numeric');
    expect(buildBibliography([]).entries).toEqual([]);
  });
});

describe('citationLabel', () => {
  const bibliographyFor = (children: CitationChild[]) =>
    buildBibliography([para('p1', children)]);

  it('collapses a run of three into a range and leaves a pair alone', () => {
    const three = cite('c1', { keys: ['k1', 'k2', 'k3'] });
    const two = cite('c2', { keys: ['k1', 'k2'] });
    const bibliography = bibliographyFor([three, two]);

    expect(citationLabel(three, bibliography)).toBe('[1–3]');
    expect(citationLabel(two, bibliography)).toBe('[1, 2]');
  });

  it('splits a non-contiguous set at the gap', () => {
    const child = cite('c4', { keys: ['k1', 'k3'] });
    const bibliography = bibliographyFor([
      cite('c1', { keys: ['k1'] }),
      cite('c2', { keys: ['k2'] }),
      cite('c3', { keys: ['k3'] }),
      child,
    ]);
    expect(citationLabel(child, bibliography)).toBe('[1, 3]');
    expect(citationLabel({ ...child, style: 'ieee' }, bibliography)).toBe('[1], [3]');
  });

  it('brackets every number separately in IEEE style', () => {
    const child = cite('c1', { style: 'ieee', keys: ['k1', 'k2', 'k3'] });
    const bibliography = bibliographyFor([child]);
    expect(citationLabel(child, bibliography)).toBe('[1]–[3]');
  });

  it('sorts the numbers a citation prints regardless of key order', () => {
    const child = cite('c1', { keys: ['k3', 'k1'] });
    const bibliography = bibliographyFor([cite('c0', { keys: ['k1'] }), cite('c9', { keys: ['k3'] }), child]);
    expect(citationLabel(child, bibliography)).toBe('[1, 2]');
  });

  it('applies prefix, locator and suffix', () => {
    const child = cite('c1', { prefix: 'see', locator: 'p. 12', suffix: 'ch. 2' });
    expect(citationLabel(child, bibliographyFor([child]))).toBe('see [1], p. 12, ch. 2');
  });

  it('puts an author–year signal phrase inside the parentheses', () => {
    const child = cite('c1', {
      style: 'author-year',
      prefix: 'see',
      locator: 'p. 12',
      sources: [source('k1')],
    });
    expect(citationLabel(child, bibliographyFor([child]))).toBe('(see Smith, 2020, p. 12)');
  });

  it('disambiguates two sources sharing an author and year', () => {
    const first = cite('c1', {
      style: 'author-year',
      keys: ['a'],
      sources: [source('a', { title: 'Alpha' })],
    });
    const second = cite('c2', {
      style: 'author-year',
      keys: ['b'],
      sources: [source('b', { title: 'Beta' })],
    });
    const bibliography = bibliographyFor([first, second]);

    expect(citationLabel(first, bibliography)).toBe('(Smith, 2020a)');
    expect(citationLabel(second, bibliography)).toBe('(Smith, 2020b)');
  });

  it('falls back to the raw key when the source has no author or year', () => {
    const child = cite('c1', { style: 'author-year', keys: ['k1', 'k2'], sources: [source('k1')] });
    expect(citationLabel(child, bibliographyFor([child]))).toBe('(Smith, 2020; k2)');
  });

  it('marks a citation with no keys rather than claiming an entry', () => {
    const child = cite('c1', { keys: [] });
    expect(citationLabel(child, bibliographyFor([child]))).toBe('[?]');
    expect(citationLabel({ ...child, style: 'author-year' }, bibliographyFor([child]))).toBe(
      '(citation)',
    );
  });

  it('does not borrow a number for a key the document does not contain', () => {
    const child = cite('c1', { keys: ['unknown'] });
    // Rendered against a bibliography built from a different document.
    expect(citationLabel(child, bibliographyFor([cite('c2', { keys: ['k1'] })]))).toBe('[?]');
  });
});

describe('formatReference', () => {
  const entryFor = (over: Partial<CitationSource>, style: CitationChild['style'] = 'numeric') =>
    buildBibliography([
      para('p1', [cite('c1', { style, sources: [{ key: 'k1', ...over }] })]),
    ]).byKey.get('k1')!;

  it('formats IEEE with the title quoted', () => {
    const entry = entryFor({ title: 'Attention', authors: 'A. Vaswani', venue: 'NeurIPS', year: '2017' }, 'ieee');
    expect(formatReference(entry, 'ieee').text).toBe('A. Vaswani, “Attention”, NeurIPS, 2017.');
  });

  it('formats numeric as sentence-separated fields', () => {
    const entry = entryFor({ title: 'Attention', authors: 'A. Vaswani', venue: 'NeurIPS', year: '2017' });
    expect(formatReference(entry, 'numeric').text).toBe('A. Vaswani. Attention. NeurIPS. 2017.');
  });

  it('formats author–year with the year beside the author', () => {
    const entry = entryFor(
      { title: 'Attention', authors: 'A. Vaswani', venue: 'NeurIPS', year: '2017' },
      'author-year',
    );
    expect(formatReference(entry, 'author-year').text).toBe(
      'A. Vaswani (2017). Attention. NeurIPS.',
    );
  });

  it('does not repeat the title as its own author', () => {
    const entry = entryFor({ title: 'Anonymous report', year: '2017' }, 'author-year');
    expect(formatReference(entry, 'author-year').text).toBe('Anonymous report (2017).');
  });

  it('names the key when nothing was ever attached', () => {
    const entry = entryFor({});
    expect(formatReference(entry, 'numeric').text).toBe('k1');
  });

  it('prefers a DOI link, then a URL', () => {
    expect(formatReference(entryFor({ doi: '10.1000/example', url: 'https://example.test/a' }), 'numeric'))
      .toMatchObject({ href: 'https://doi.org/10.1000/example', linkLabel: 'doi.org/10.1000/example' });
    expect(formatReference(entryFor({ url: 'https://example.test/a' }), 'numeric'))
      .toMatchObject({ href: 'https://example.test/a' });
  });

  it('never turns a non-http url into a link', () => {
    expect(formatReference(entryFor({ url: 'javascript:alert(1)' }), 'numeric').href).toBeUndefined();
  });

  it('reconstructs an arXiv link from provider provenance alone', () => {
    const entry = entryFor({ provider: 'arxiv', providerId: '2103.00020v2' });
    expect(formatReference(entry, 'numeric')).toMatchObject({
      href: 'https://arxiv.org/abs/2103.00020',
      linkLabel: 'arXiv:2103.00020',
    });
  });
});

describe('markers and anchors', () => {
  const entry = { number: 3 } as never;

  it('numbers a numbered style and leaves author–year unmarked', () => {
    expect(referenceMarker(entry, 'numeric')).toBe('[3]');
    expect(referenceMarker(entry, 'ieee')).toBe('[3]');
    expect(referenceMarker(entry, 'author-year')).toBe('');
  });

  it('builds fragment ids that are valid in a url', () => {
    expect(referenceAnchorId({ number: 3 })).toBe('ref-3');
    expect(citationAnchorId('a b/c')).toBe('cite-a-b-c');
  });
});
