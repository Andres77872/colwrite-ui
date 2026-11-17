import { describe, expect, it } from 'vitest';
import { itemAt } from '@/lib/itemAt';
import { reference } from '@/__tests__/agentSource';
import { toEditorDoc } from '@/api/content';
import type { DocumentContentOutput } from '@/api/schema';
import { fixtureDocument } from '@/dev/fixtureDocument';
import {
  EMPTY_BIBLIOGRAPHY,
  buildBibliography,
  citationAnchorId,
  citationFingerprint,
  citationLabelText,
  entryForKey,
  formatReferences,
  isParenthetical,
  referenceAnchorId,
} from '../citations';
import { CITATION_STYLES } from '../csl/styles';
import { markupHtml, markupText } from '../csl/markup';
import type { Block, CitationChild, CitationStyle, ParagraphBlock } from '../types';

const ph = (id: string) => `<span data-child-id="${id}" contenteditable="false"></span>`;

const VASWANI = reference('arxiv:1706.03762', { title: 'Attention is all you need', authors: 'Ashish Vaswani, Noam Shazeer', year: 2017, venue: 'NeurIPS' });
const FEDUS = reference('arxiv:2101.03961', { title: 'Switch transformers', authors: 'William Fedus, Barret Zoph', year: 2021, venue: 'JMLR' });
const LEPIKHIN = reference('arxiv:2006.16668', { title: 'GShard', authors: 'Dmitry Lepikhin', year: 2020, venue: 'ICLR' });

const cite = (id: string, keys: string[], extra: Partial<CitationChild> = {}): CitationChild => ({
  id, type: 'citation', keys, sources: [VASWANI, FEDUS, LEPIKHIN].filter((record) => keys.includes(record.key)), ...extra,
});

function paragraph(id: string, children: CitationChild[]): ParagraphBlock {
  return { id, type: 'paragraph', html: `Text ${children.map((child) => ph(child.id)).join(' and ')}.`, children };
}

const labels = (blocks: Block[], style: CitationStyle | null = null) => {
  const bibliography = buildBibliography(blocks, { style });
  return blocks.flatMap((block) => (block.type === 'paragraph' ? block.children ?? [] : []))
    .filter((child): child is CitationChild => child.type === 'citation')
    .map((child) => citationLabelText(child, bibliography));
};

describe('the bibliography, rendered by the CSL processor', () => {
  it('numbers works, not citations, in the order the text first cites them', () => {
    const blocks = [paragraph('p', [cite('b', [FEDUS.key]), cite('a', [VASWANI.key]), cite('c', [FEDUS.key])])];
    const bibliography = buildBibliography(blocks);
    expect(bibliography.style).toBe('nlm-citation-sequence-brackets');
    expect(bibliography.entries.map((entry) => [entry.key, entry.number, entry.marker])).toEqual([
      [FEDUS.key, 1, '1.'],
      [VASWANI.key, 2, '2.'],
    ]);
    expect(labels(blocks)).toEqual(['[1]', '[2]', '[1]']);
    expect(itemAt(bibliography.entries, 0).usages.map((usage) => usage.ordinal)).toEqual([1, 2]);
  });

  it('reads the placeholders’ order, not the order children were added', () => {
    const block: ParagraphBlock = {
      id: 'p', type: 'paragraph', html: `First ${ph('b')} then ${ph('a')}.`,
      children: [cite('a', [VASWANI.key]), cite('b', [FEDUS.key])],
    };
    expect(buildBibliography([block]).entries.map((entry) => entry.key)).toEqual([FEDUS.key, VASWANI.key]);
  });

  it('collapses a run of works into a range, as the style does', () => {
    const blocks = [paragraph('p', [cite('a', [VASWANI.key, FEDUS.key, LEPIKHIN.key])])];
    expect(labels(blocks)).toEqual(['[1–3]']);
    expect(labels(blocks, 'ieee')).toEqual(['[1], [2], [3]']);
    expect(labels(blocks, 'apa')).toEqual(['(Fedus & Zoph, 2021; Lepikhin, 2020; Vaswani & Shazeer, 2017)']);
  });

  it('takes the library’s record over the copy a citation carries', () => {
    const corrected = reference(VASWANI.key, { title: 'Attention Is All You Need', authors: 'Ashish Vaswani', year: 2017, state: 'verified' });
    const bibliography = buildBibliography([paragraph('p', [cite('a', [VASWANI.key])])], { library: [corrected] });
    expect(itemAt(bibliography.entries, 0).record).toBe(corrected);
    expect(markupText(itemAt(bibliography.entries, 0).formatted)).toContain('Attention Is All You Need');
  });

  it('prints a key nothing describes as itself, as typed, and keeps its number', () => {
    const blocks = [paragraph('p', [cite('a', ['smith2020']), cite('b', [FEDUS.key])])];
    const bibliography = buildBibliography(blocks, { style: 'apa' });
    const entry = entryForKey(bibliography, 'smith2020');
    expect(entry?.record).toBeNull();
    expect(markupText(entry?.formatted ?? [])).toContain('smith2020');
    expect(labels(blocks)).toEqual(['[1]', '[2]']);
  });

  it('applies the prefix, then the locator and suffix', () => {
    const blocks = [paragraph('p', [cite('a', [FEDUS.key], { prefix: 'see', locator: 'p. 12', suffix: 'ch. 2' })])];
    expect(labels(blocks)).toEqual(['[see 1, p. 12, ch. 2]']);
    expect(labels(blocks, 'apa')).toEqual(['(see Fedus & Zoph, 2021, p. 12, ch. 2)']);
  });

  it('tells apart two works with one author and year, as an author-date style does', () => {
    const a = reference('k:a', { title: 'First', authors: 'Jane Smith', year: 2020 });
    const b = reference('k:b', { title: 'Second', authors: 'Jane Smith', year: 2020 });
    const blocks: Block[] = [{
      id: 'p', type: 'paragraph', html: `${ph('x')} ${ph('y')}`,
      children: [{ id: 'x', type: 'citation', keys: [a.key], sources: [a] }, { id: 'y', type: 'citation', keys: [b.key], sources: [b] }],
    }];
    expect(labels(blocks, 'apa')).toEqual(['(Smith, 2020a)', '(Smith, 2020b)']);
  });

  it('takes the page’s style from the document, else the citations’ majority, else the default', () => {
    const blocks = [paragraph('p', [cite('a', [FEDUS.key], { style: 'apa' }), cite('b', [VASWANI.key], { style: 'apa' }), cite('c', [LEPIKHIN.key], { style: 'ieee' })])];
    expect(buildBibliography(blocks).style).toBe('apa');
    expect(buildBibliography(blocks, { style: 'nature' })).toMatchObject({ style: 'nature', documentStyle: 'nature' });
    expect(buildBibliography([])).toEqual({ ...EMPTY_BIBLIOGRAPHY, style: 'nlm-citation-sequence-brackets', documentStyle: null });
  });

  it('prints [?] for a citation it does not hold, rather than a borrowed number', () => {
    const bibliography = buildBibliography([paragraph('p', [cite('a', [FEDUS.key])])]);
    expect(citationLabelText(cite('elsewhere', [VASWANI.key]), bibliography)).toBe('[?]');
    expect(citationLabelText({ id: 'empty', type: 'citation', keys: [] }, bibliography)).toBe('[?]');
  });

  it('sees a change to a citation’s prefix, locator or suffix in its fingerprint', () => {
    const before = [paragraph('p', [cite('a', [FEDUS.key])])];
    const after = [paragraph('p', [cite('a', [FEDUS.key], { locator: 'p. 3' })])];
    expect(citationFingerprint(before)).not.toBe(citationFingerprint(after));
    expect(citationFingerprint(before)).toBe(citationFingerprint([paragraph('p', [cite('a', [FEDUS.key])])]));
  });

  it('says which labels are parenthetical, for the gap before them', () => {
    const blocks = [paragraph('p', [cite('a', [FEDUS.key])])];
    const apa = buildBibliography(blocks, { style: 'apa' });
    const numbered = buildBibliography(blocks);
    expect(isParenthetical(apa.labels.get('a') ?? [])).toBe(true);
    expect(isParenthetical(numbered.labels.get('a') ?? [])).toBe(false);
  });

  it('formats a list of references as a style prints them, each once', () => {
    const formatted = formatReferences([FEDUS, VASWANI]);
    expect(markupText(formatted.get(FEDUS.key) ?? [])).toBe('Fedus W, Zoph B. Switch transformers. JMLR. 2021.');
    expect(markupText(formatted.get(VASWANI.key) ?? [])).toBe('Vaswani A, Shazeer N. Attention is all you need. NeurIPS. 2017.');
  });

  it('never lets a record’s text become markup', () => {
    const hostile = reference('k:x', { title: '<img src=x onerror=alert(1)> & co', authors: 'Eve Mallory', year: 2020, url: 'javascript:alert(1)' });
    const bibliography = buildBibliography([{ id: 'p', type: 'paragraph', html: ph('c'), children: [{ id: 'c', type: 'citation', keys: ['k:x'], sources: [hostile] }] }], { style: 'apa' });
    const html = markupHtml(itemAt(bibliography.entries, 0).formatted);
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt; &amp; co');
    expect(html).not.toContain('<img');
    // A link is to http(s) only.
    expect(html).not.toMatch(/href="(?!https?:)/);
  });

  it('builds fragment ids that are valid in a url', () => {
    expect(referenceAnchorId({ number: 3 })).toBe('ref-3');
    expect(citationAnchorId('c 1/x')).toBe('cite-c-1-x');
  });
});

/** The preview's fixture page, as the editor loads it. */
const page = toEditorDoc(structuredClone(fixtureDocument()) as unknown as DocumentContentOutput);
const pageCitations = page.blocks.flatMap((block) => (block.type === 'paragraph' ? block.children ?? [] : []))
  .filter((child): child is CitationChild => child.type === 'citation');

/**
 * What each listed style prints for the fixture page: its four citations
 * (the last cites the Transformer paper again under its arXiv DOI, a
 * duplicate an author-date style tells apart as 2017a and 2017b), and its
 * first and its retracted reference.
 */
const FIXTURE_PAGE: Record<CitationStyle, { labels: string[]; first: string; retracted: string }> = {
  'nlm-citation-sequence-brackets': {
    labels: ["[1,2]", "[3]", "[4]", "[5]"],
    first: "Fedus W, Zoph B, Shazeer N. Switch Transformers: Scaling to Trillion Parameter Models with Simple and Efficient Sparsity. Journal of Machine Learning Research [Internet]. 2022;23(120):1–39. Available from: https://jmlr.org/papers/v23/21-0998.html",
    retracted: "Okafor C, Brandt L. Learned Routing Eliminates Expert Collapse. Journal of Sparse Models. 2019 Jun;4(2):115–31. doi:10.5555/jsm.2019.042",
  },
  'nlm-citation-sequence': {
    labels: ["(1,2)", "(3)", "(4)", "(5)"],
    first: "Fedus W, Zoph B, Shazeer N. Switch Transformers: Scaling to Trillion Parameter Models with Simple and Efficient Sparsity. Journal of Machine Learning Research [Internet]. 2022;23(120):1–39. Available from: https://jmlr.org/papers/v23/21-0998.html",
    retracted: "Okafor C, Brandt L. Learned Routing Eliminates Expert Collapse. Journal of Sparse Models. 2019 Jun;4(2):115–31. doi:10.5555/jsm.2019.042",
  },
  ieee: {
    labels: ["[1], [2]", "[3]", "[4]", "[5]"],
    first: "W. Fedus, B. Zoph, and N. Shazeer, “Switch Transformers: Scaling to Trillion Parameter Models with Simple and Efficient Sparsity,” Journal of Machine Learning Research, vol. 23, no. 120, pp. 1–39, 2022, [Online]. Available: https://jmlr.org/papers/v23/21-0998.html",
    retracted: "C. Okafor and L. Brandt, “Learned Routing Eliminates Expert Collapse,” Journal of Sparse Models, vol. 4, no. 2, pp. 115–131, Jun. 2019, doi: 10.5555/jsm.2019.042.",
  },
  apa: {
    labels: ["(Fedus et al., 2022; Lepikhin et al., 2021)", "(Vaswani et al., 2017a)", "(Okafor & Brandt, 2019)", "(Vaswani et al., 2017b)"],
    first: "Fedus, W., Zoph, B., & Shazeer, N. (2022). Switch Transformers: Scaling to Trillion Parameter Models with Simple and Efficient Sparsity. Journal of Machine Learning Research, 23(120), 1–39. https://jmlr.org/papers/v23/21-0998.html",
    retracted: "Okafor, C., & Brandt, L. (2019). Learned Routing Eliminates Expert Collapse. Journal of Sparse Models, 4(2), 115–131. https://doi.org/10.5555/jsm.2019.042",
  },
  'chicago-author-date': {
    labels: ["(Fedus et al. 2022; Lepikhin et al. 2021)", "(Vaswani et al. 2017a)", "(Okafor and Brandt 2019)", "(Vaswani et al. 2017b)"],
    first: "Fedus, William, Barret Zoph, and Noam Shazeer. 2022. “Switch Transformers: Scaling to Trillion Parameter Models with Simple and Efficient Sparsity.” Journal of Machine Learning Research 23 (120): 1–39. https://jmlr.org/papers/v23/21-0998.html.",
    retracted: "Okafor, Chidi, and Lena Brandt. 2019. “Learned Routing Eliminates Expert Collapse.” Journal of Sparse Models 4 (2): 115–31. https://doi.org/10.5555/jsm.2019.042.",
  },
  'american-medical-association': {
    labels: ["1,2", "3", "4", "5"],
    first: "Fedus W, Zoph B, Shazeer N. Switch Transformers: Scaling to Trillion Parameter Models with Simple and Efficient Sparsity. Journal of Machine Learning Research. 2022;23(120):1-39. https://jmlr.org/papers/v23/21-0998.html",
    retracted: "Okafor C, Brandt L. Learned Routing Eliminates Expert Collapse. Journal of Sparse Models. 2019;4(2):115-131. doi:10.5555/jsm.2019.042",
  },
  nature: {
    labels: ["1,2", "3", "4", "5"],
    first: "Fedus, W., Zoph, B. & Shazeer, N. Switch Transformers: Scaling to Trillion Parameter Models with Simple and Efficient Sparsity. Journal of Machine Learning Research 23, 1–39 (2022).",
    retracted: "Okafor, C. & Brandt, L. Learned Routing Eliminates Expert Collapse. Journal of Sparse Models 4, 115–131 (2019).",
  },
  'association-for-computing-machinery': {
    labels: ["[1, 2]", "[4]", "[3]", "[5]"],
    first: "William Fedus, Barret Zoph, and Noam Shazeer. 2022. Switch Transformers: Scaling to Trillion Parameter Models with Simple and Efficient Sparsity. Journal of Machine Learning Research 23, 120 (2022), 1–39. Retrieved from https://jmlr.org/papers/v23/21-0998.html",
    retracted: "Chidi Okafor and Lena Brandt. 2019. Learned Routing Eliminates Expert Collapse. Journal of Sparse Models 4, 2 (June 2019), 115–131. https://doi.org/10.5555/jsm.2019.042",
  },
};

describe('the fixture page in each listed style', () => {
  it('lists exactly the API’s style ids', () => {
    expect(CITATION_STYLES.map((style) => style.id).sort()).toEqual(Object.keys(FIXTURE_PAGE).sort());
  });

  for (const { id, name } of CITATION_STYLES) {
    it(`renders in ${name}`, () => {
      const bibliography = buildBibliography(page.blocks, { library: page.sources, style: id });
      const expected = FIXTURE_PAGE[id];
      expect(pageCitations.map((child) => citationLabelText(child, bibliography))).toEqual(expected.labels);
      // Five cited entries; the one kept for later is not in the list.
      expect(bibliography.entries).toHaveLength(5);
      expect(markupText(itemAt(bibliography.entries, 0).formatted)).toBe(expected.first);
      const retracted = bibliography.entries.find((entry) => entry.key === 'doi:10.5555/jsm.2019.042');
      expect(markupText(retracted?.formatted ?? [])).toBe(expected.retracted);
      expect(retracted?.record?.flags).toContain('retracted');
    });
  }
});
