import { describe, expect, it } from 'vitest';
import { buildBibliography, citationLabel } from '../citations';
import { parseBibtex, toBibtex, bibtexKey } from '../bibtex';
import type { Block, CitationChild, ParagraphBlock } from '../types';

const cite = (id: string, key: string, extra: Partial<CitationChild> = {}): CitationChild => ({
  id,
  type: 'citation',
  keys: [key],
  ...extra,
});

function paragraph(html: string, children: CitationChild[]): ParagraphBlock {
  return { id: 'p', type: 'paragraph', html, children };
}

describe('bibliography from the text and the library', () => {
  it('numbers in the order citations appear in the text, not the order they were added', () => {
    // `b` was inserted after `a` but sits before it in the sentence.
    const blocks: Block[] = [
      paragraph(
        'First <span data-child-id="b" contenteditable="false"></span> then <span data-child-id="a" contenteditable="false"></span>.',
        [cite('a', '10.1234/alpha'), cite('b', '10.1234/beta')],
      ),
    ];
    const bibliography = buildBibliography(blocks);
    expect(bibliography.entries.map((entry) => [entry.key, entry.number])).toEqual([
      ['10.1234/beta', 1],
      ['10.1234/alpha', 2],
    ]);
  });

  it('takes metadata from the library before the copy a citation carries', () => {
    const blocks: Block[] = [
      paragraph('x <span data-child-id="a" contenteditable="false"></span>', [
        cite('a', '10.1234/ALPHA', { sources: [{ key: '10.1234/ALPHA', title: 'Old title', provider: 'manual' }] }),
      ]),
    ];
    const bibliography = buildBibliography(blocks, {
      library: [{ key: 'https://doi.org/10.1234/alpha', title: 'Corrected title', provider: 'crossref' }],
    });
    const [entry] = bibliography.entries;
    expect(entry.source.title).toBe('Corrected title');
    expect(entry.verified).toBe(true);
  });

  it('marks typed sources as unverified', () => {
    const blocks: Block[] = [
      paragraph('x <span data-child-id="a" contenteditable="false"></span>', [
        cite('a', 'Smith2020', { sources: [{ key: 'Smith2020', title: 'Typed', provider: 'manual' }] }),
      ]),
    ];
    expect(buildBibliography(blocks).entries[0].verified).toBe(false);
  });

  it('relabels every citation when the document chooses a style', () => {
    const child = cite('a', '10.1234/alpha', {
      style: 'numeric',
      sources: [{ key: '10.1234/alpha', title: 'T', authors: 'Ada Lovelace', year: '1843' }],
    });
    const blocks: Block[] = [paragraph('x <span data-child-id="a" contenteditable="false"></span>', [child])];
    expect(citationLabel(child, buildBibliography(blocks))).toBe('[1]');
    expect(citationLabel(child, buildBibliography(blocks, { style: 'author-year' }))).toBe('(Lovelace, 1843)');
  });
});

describe('BibTeX', () => {
  const source = {
    key: '10.5555/3295222.3295349',
    title: 'Attention Is All You Need',
    authors: 'Ashish Vaswani, Noam Shazeer',
    year: '2017',
    venue: 'Advances in Neural Information Processing Systems',
    kind: 'conference' as const,
    doi: '10.5555/3295222.3295349',
  };

  it('writes readable keys and the fields a LaTeX workflow needs', () => {
    expect(bibtexKey(source)).toBe('vaswani2017attention');
    const bib = toBibtex([source, { ...source, key: 'other' }]);
    expect(bib).toContain('@inproceedings{vaswani2017attention,');
    expect(bib).toContain('title = {{Attention Is All You Need}}');
    expect(bib).toContain('author = {Ashish Vaswani and Noam Shazeer}');
    expect(bib).toContain('booktitle = {Advances in Neural Information Processing Systems}');
    expect(bib).toContain('doi = {10.5555/3295222.3295349}');
    // Duplicate keys are disambiguated.
    expect(bib).toContain('@inproceedings{vaswani2017attentionb,');
  });

  it('escapes BibTeX specials', () => {
    expect(toBibtex([{ key: 'k', title: 'Cost & 50% of $x_1$ {braces}' }])).toContain(
      'title = {{Cost \\& 50\\% of \\$x\\_1\\$ \\{braces\\}}}',
    );
  });

  it('reads entries from reference managers as unverified sources', () => {
    const { sources, skipped } = parseBibtex(`
      @article{smith2020,
        title = {A {Study} of Things},
        author = {Smith, John and Doe, Jane and others},
        journal = "Journal of Stuff",
        year = 2020,
        doi = {10.1234/ABC.def}
      }
      @misc{nokey, author = {Nobody}}
      @inproceedings{vaswani, title={Attention}, eprint={1706.03762v5}, archiveprefix={arXiv}, booktitle={NeurIPS}}
    `);
    expect(skipped).toBe(1);
    expect(sources).toEqual([
      {
        key: '10.1234/abc.def',
        title: 'A Study of Things',
        authors: 'John Smith, Jane Doe, et al.',
        year: '2020',
        venue: 'Journal of Stuff',
        doi: '10.1234/abc.def',
        kind: 'article',
        provider: 'manual',
      },
      {
        key: '1706.03762',
        title: 'Attention',
        venue: 'NeurIPS',
        externalIds: { ArXiv: '1706.03762' },
        kind: 'conference',
        provider: 'manual',
      },
    ]);
  });

  it('round-trips through its own export', () => {
    const [parsed] = parseBibtex(toBibtex([source])).sources;
    expect(parsed).toMatchObject({
      key: '10.5555/3295222.3295349',
      title: 'Attention Is All You Need',
      authors: 'Ashish Vaswani, Noam Shazeer',
      year: '2017',
      venue: 'Advances in Neural Information Processing Systems',
    });
  });
});
