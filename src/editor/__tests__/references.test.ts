import { describe, expect, it } from 'vitest';
import { reference } from '@/__tests__/agentSource';
import { parseBibtex, toBibtex, bibtexKey } from '../bibtex';
import {
  canonicalArxivId,
  canonicalDoi,
  identifierKey,
  libraryEntry,
  manualRecord,
  referenceAuthors,
  referenceByline,
  referenceLink,
  referenceMarks,
} from '../referenceRecords';
import type { ReferenceRecord } from '../types';

describe('identifiers', () => {
  it('reduces a DOI to its bare, lower-cased form, and rejects anything else', () => {
    expect(canonicalDoi('https://doi.org/10.1234/ABC.def')).toBe('10.1234/abc.def');
    expect(canonicalDoi('doi: 10.1234/x.')).toBe('10.1234/x');
    expect(canonicalDoi('not a doi')).toBeUndefined();
  });

  it('strips host, version and extension from an arXiv id, in either scheme', () => {
    expect(canonicalArxivId('https://arxiv.org/pdf/2101.03961v3.pdf')).toBe('2101.03961');
    expect(canonicalArxivId('arXiv:hep-th/9901001v2')).toBe('hep-th/9901001');
    expect(canonicalArxivId('Smith2020v2')).toBeUndefined();
  });

  it('turns a pasted identifier into a key with its scheme, and leaves a typed key alone', () => {
    expect(identifierKey('10.1234/ABC')).toBe('doi:10.1234/abc');
    expect(identifierKey('2101.03961v2')).toBe('arxiv:2101.03961');
    expect(identifierKey('PMID: 123456')).toBe('pmid:123456');
    expect(identifierKey('OpenAlex:W123')).toBe('openalex:W123');
    expect(identifierKey('smith2020')).toBeNull();
  });
});

describe('one record from every entry point', () => {
  it('is the library entry as it came, its CSL id its key', () => {
    const record = reference('doi:10.1/a', { title: 'A', state: 'verified' });
    expect(libraryEntry(record)).toBe(record);
    expect(libraryEntry({ ...record, key: 'doi:10.1/b' }).csl.id).toBe('doi:10.1/b');
  });

  it('makes an entry the author typed `manual` and unchecked', () => {
    expect(manualRecord('smith2020', { type: 'book', title: 'Typed' }, 'book')).toEqual({
      key: 'smith2020', kind: 'book', provider: 'manual', state: 'unchecked', flags: [],
      csl: { id: 'smith2020', type: 'book', title: 'Typed' },
    });
  });

  it('reads the byline and the link from the CSL item', () => {
    const record = reference('arxiv:2101.03961', { title: 'Switch', authors: 'William Fedus, Barret Zoph, Noam Shazeer, Jeff Dean', year: 2021, venue: 'JMLR' });
    expect(referenceAuthors(record)).toBe('William Fedus, Barret Zoph, Noam Shazeer et al.');
    expect(referenceByline(record)).toBe('William Fedus, Barret Zoph, Noam Shazeer et al. · 2021 · JMLR');
    expect(referenceLink(record)).toEqual({ href: 'https://arxiv.org/abs/2101.03961', label: 'arXiv:2101.03961' });
    expect(referenceLink(reference('k', { doi: '10.1234/X' }))?.href).toBe('https://doi.org/10.1234/x');
    expect(referenceLink(reference('k', { url: 'javascript:alert(1)' }))).toBeNull();
  });
});

describe('reference states and flags (09 §5)', () => {
  const marks = (record: ReferenceRecord) => referenceMarks(record).map((mark) => [mark.kind, mark.label, mark.detail, mark.href ?? null]);

  it('is quiet for a verified work and for one never checked', () => {
    expect(referenceMarks(reference('k', { state: 'verified' }))).toEqual([]);
    expect(referenceMarks(reference('k', { state: 'unchecked' }))).toEqual([]);
    expect(referenceMarks(null)).toEqual([]);
  });

  it('names what differs on a work to review, and says when one registry has it', () => {
    expect(marks(reference('k', { state: 'needs_review', differs: ['issued', 'container-title'] }))).toEqual([
      ['needs_review', 'Needs review', 'Sources disagree on its year and venue. Check the details against the work.', null],
    ]);
    expect(marks(reference('k', { state: 'needs_review' }))[0]?.[2]).toBe('Only one registry has this work. Check the details against the work.');
    expect(marks(reference('k', { state: 'not_found' }))[0]?.[1]).toBe('Not found');
  });

  it('marks a retraction with its notice, first', () => {
    const retracted = reference('k', {
      state: 'needs_review', flags: ['retracted'],
      notices: [{ type: 'retraction', date: '2024-03-12', doi: '10.5555/R1', source: 'crossref' }],
    });
    expect(marks(retracted)[0]).toEqual([
      'retracted', 'Retracted', 'Retraction published on 2024-03-12 (reported by Crossref).', 'https://doi.org/10.5555/r1',
    ]);
    expect(marks(reference('k', { flags: ['retracted'], notices: [{ type: 'withdrawal' }] }))[0]?.[1]).toBe('Withdrawn');
  });

  it('points a preprint to its published version', () => {
    expect(marks(reference('k', { flags: ['preprint', 'has_published_version'], published_doi: '10.1234/pub' }))).toEqual([
      ['published_version', 'Published version', 'A preprint. Its published version is doi:10.1234/pub.', 'https://doi.org/10.1234/pub'],
    ]);
    expect(marks(reference('k', { flags: ['preprint'] }))).toEqual([['preprint', 'Preprint', 'A preprint, not peer reviewed.', null]]);
  });
});

describe('BibTeX', () => {
  const record = reference('doi:10.5555/3295222.3295349', {
    title: 'Attention Is All You Need', authors: 'Ashish Vaswani, Noam Shazeer', year: 2017,
    venue: 'Advances in Neural Information Processing Systems', doi: '10.5555/3295222.3295349',
    csl: { type: 'paper-conference' },
  });

  it('writes readable keys and the fields a LaTeX workflow needs', () => {
    expect(bibtexKey(record)).toBe('vaswani2017attention');
    const bib = toBibtex([record, { ...record, key: 'other' }]);
    expect(bib).toContain('@inproceedings{vaswani2017attention,');
    expect(bib).toContain('title = {{Attention Is All You Need}}');
    expect(bib).toContain('author = {Vaswani, Ashish and Shazeer, Noam}');
    expect(bib).toContain('booktitle = {Advances in Neural Information Processing Systems}');
    expect(bib).toContain('doi = {10.5555/3295222.3295349}');
    // Duplicate keys are disambiguated.
    expect(bib).toContain('@inproceedings{vaswani2017attentionb,');
  });

  it('escapes BibTeX specials, and braces an organisation', () => {
    expect(toBibtex([reference('k', { title: 'Cost & 50% of $x_1$ {braces}' })])).toContain(
      'title = {{Cost \\& 50\\% of \\$x\\_1\\$ \\{braces\\}}}',
    );
    expect(toBibtex([reference('k', { title: 'T', csl: { author: [{ literal: 'World Health Organization' }] } })])).toContain(
      'author = {{World Health Organization}}',
    );
  });

  it('reads entries from reference managers as records entered by hand, unchecked', () => {
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
        key: 'doi:10.1234/abc.def', kind: 'paper', provider: 'manual', state: 'unchecked', flags: [],
        csl: {
          id: 'doi:10.1234/abc.def', type: 'article-journal', title: 'A Study of Things',
          author: [{ family: 'Smith', given: 'John' }, { family: 'Doe', given: 'Jane' }],
          issued: { 'date-parts': [[2020]] }, 'container-title': 'Journal of Stuff', DOI: '10.1234/abc.def',
        },
      },
      {
        key: 'arxiv:1706.03762', kind: 'paper', provider: 'manual', state: 'unchecked', flags: [],
        csl: { id: 'arxiv:1706.03762', type: 'paper-conference', title: 'Attention', 'container-title': 'NeurIPS', number: 'arXiv:1706.03762' },
      },
    ]);
  });

  it('round-trips through its own export', () => {
    const [parsed] = parseBibtex(toBibtex([record])).sources;
    expect(parsed?.key).toBe(record.key);
    expect(parsed?.csl).toMatchObject({
      type: 'paper-conference',
      title: 'Attention Is All You Need',
      author: [{ family: 'Vaswani', given: 'Ashish' }, { family: 'Shazeer', given: 'Noam' }],
      issued: { 'date-parts': [[2017]] },
      'container-title': 'Advances in Neural Information Processing Systems',
    });
  });
});
