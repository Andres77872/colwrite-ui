/**
 * The works the dev preview and the tests know, each once, as the API's
 * reference records (`ColWrite-api/docs/citations.md#the-data`): a CSL-JSON
 * item with ColWrite's fields beside it. The fixture page's library and
 * citations, the mock's paper routes, its resolver and its scripted turns'
 * `evidence` events all hand out these, so one paper reads the same from
 * every entry point.
 *
 * A paper source returns a work `unchecked` with the flags it knows
 * (`work_reference`); the citation pipeline's check gives it a state.
 */
import type { ReferenceRecordOutput } from '@/api/schema';

type Work = ReferenceRecordOutput;

const arxivPreprint = (
  id: string,
  title: string,
  authors: Array<[string, string]>,
  year: number,
  extra: Partial<Work> = {},
): Work => ({
  key: `arxiv:${id}`,
  kind: 'preprint',
  provider: 'arxiv_index',
  state: 'unchecked',
  flags: ['preprint'],
  ...extra,
  csl: {
    id: `arxiv:${id}`,
    type: 'article',
    title,
    author: authors.map(([given, family]) => ({ given, family })),
    issued: { 'date-parts': [[year]] },
    publisher: 'arXiv',
    number: `arXiv:${id}`,
    DOI: `10.48550/arxiv.${id}`,
    URL: `https://arxiv.org/abs/${id}`,
  },
});

/** Attention Is All You Need: a preprint with a published version. */
export const VASWANI: Work = arxivPreprint(
  '1706.03762',
  'Attention Is All You Need',
  [['Ashish', 'Vaswani'], ['Noam', 'Shazeer'], ['Niki', 'Parmar'], ['Jakob', 'Uszkoreit']],
  2017,
  {
    provider: 'crossref',
    state: 'verified',
    flags: ['preprint', 'has_published_version'],
    checked: '2026-09-18',
    published_doi: '10.5555/3295222.3295349',
  },
);

/**
 * Attention Is All You Need again, under its arXiv DOI: an entry added by
 * hand that is the same work as `VASWANI` (its DOI is among that record's
 * identifiers), which the fixture page cites in its results. The reference
 * audit reports the two as a duplicate.
 */
export const VASWANI_DOI: Work = {
  ...VASWANI,
  key: 'doi:10.48550/arxiv.1706.03762',
  provider: 'manual',
  state: 'unchecked',
  flags: ['preprint'],
  checked: null,
  published_doi: null,
  csl: { ...VASWANI.csl, id: 'doi:10.48550/arxiv.1706.03762' },
};

/** Switch Transformers, as JMLR published it; its sources disagree on the year (the arXiv one is 2021). */
export const FEDUS: Work = {
  key: 'arxiv:2101.03961',
  kind: 'paper',
  provider: 'openalex',
  state: 'needs_review',
  flags: [],
  checked: '2026-09-18',
  differs: ['issued'],
  csl: {
    id: 'arxiv:2101.03961',
    type: 'article-journal',
    title: 'Switch Transformers: Scaling to Trillion Parameter Models with Simple and Efficient Sparsity',
    author: [
      { given: 'William', family: 'Fedus' },
      { given: 'Barret', family: 'Zoph' },
      { given: 'Noam', family: 'Shazeer' },
    ],
    issued: { 'date-parts': [[2022]] },
    'container-title': 'Journal of Machine Learning Research',
    volume: '23',
    issue: '120',
    page: '1–39',
    URL: 'https://jmlr.org/papers/v23/21-0998.html',
  },
};

/** GShard, at ICLR. */
export const LEPIKHIN: Work = {
  key: 'arxiv:2006.16668',
  kind: 'paper',
  provider: 'openalex',
  state: 'verified',
  flags: [],
  checked: '2026-09-18',
  csl: {
    id: 'arxiv:2006.16668',
    type: 'paper-conference',
    title: 'GShard: Scaling Giant Models with Conditional Computation and Automatic Sharding',
    author: [
      { given: 'Dmitry', family: 'Lepikhin' },
      { given: 'HyoukJoong', family: 'Lee' },
      { given: 'Yuanzhong', family: 'Xu' },
    ],
    issued: { 'date-parts': [[2021]] },
    'container-title': 'International Conference on Learning Representations',
    URL: 'https://openreview.net/forum?id=qrwe7XHTmYb',
  },
};

/** Kept in the fixture page's sources for later, cited nowhere yet. */
export const SHAZEER: Work = {
  key: 'arxiv:1701.06538',
  kind: 'paper',
  provider: 'openalex',
  state: 'verified',
  flags: [],
  checked: '2026-09-18',
  csl: {
    id: 'arxiv:1701.06538',
    type: 'paper-conference',
    title: 'Outrageously Large Neural Networks: The Sparsely-Gated Mixture-of-Experts Layer',
    author: [
      { given: 'Noam', family: 'Shazeer' },
      { given: 'Azalia', family: 'Mirhoseini' },
      { given: 'Krzysztof', family: 'Maziarz' },
    ],
    issued: { 'date-parts': [[2017]] },
    'container-title': 'International Conference on Learning Representations',
    URL: 'https://openreview.net/forum?id=B1ckMDqlg',
  },
};

/** A retracted article the fixture page still cites (13 §12): the reference list marks it. */
export const OKAFOR: Work = {
  key: 'doi:10.5555/jsm.2019.042',
  kind: 'paper',
  provider: 'crossref',
  state: 'verified',
  flags: ['retracted'],
  checked: '2026-09-18',
  notices: [{ type: 'retraction', date: '2024-03-12', doi: '10.5555/jsm.2024.r07', source: 'crossref' }],
  csl: {
    id: 'doi:10.5555/jsm.2019.042',
    type: 'article-journal',
    title: 'Learned Routing Eliminates Expert Collapse',
    author: [{ given: 'Chidi', family: 'Okafor' }, { given: 'Lena', family: 'Brandt' }],
    issued: { 'date-parts': [[2019, 6]] },
    'container-title': 'Journal of Sparse Models',
    volume: '4',
    issue: '2',
    page: '115–131',
    DOI: '10.5555/jsm.2019.042',
    URL: 'https://doi.org/10.5555/jsm.2019.042',
  },
};

/** ST-MoE, which the preview's searches and its scripted turn find. */
export const ZOPH: Work = arxivPreprint(
  '2202.08906',
  'ST-MoE: Designing Stable and Transferable Sparse Expert Models',
  [['Barret', 'Zoph'], ['Irwan', 'Bello'], ['Sameer', 'Kumar'], ['Nan', 'Du']],
  2022,
);

/** GLaM, at ICML. */
export const DU: Work = {
  key: 'arxiv:2112.06905',
  kind: 'paper',
  provider: 'openalex',
  state: 'unchecked',
  flags: [],
  csl: {
    id: 'arxiv:2112.06905',
    type: 'paper-conference',
    title: 'GLaM: Efficient Scaling of Language Models with Mixture-of-Experts',
    author: [{ given: 'Nan', family: 'Du' }, { given: 'Yanping', family: 'Huang' }, { given: 'Andrew M.', family: 'Dai' }],
    issued: { 'date-parts': [[2022]] },
    'container-title': 'Proceedings of the 39th International Conference on Machine Learning',
    URL: 'https://proceedings.mlr.press/v162/du22c.html',
  },
};

/** Mixtral, a preprint. */
export const JIANG: Work = arxivPreprint(
  '2401.04088',
  'Mixtral of Experts',
  [['Albert Q.', 'Jiang'], ['Alexandre', 'Sablayrolles'], ['Antoine', 'Roux']],
  2024,
);

/** A web page the preview's web search returns. */
export const HF_MOE_BLOG: Work = {
  key: 'url:https://huggingface.co/blog/moe',
  kind: 'web',
  provider: 'web',
  state: 'unchecked',
  flags: [],
  csl: {
    id: 'url:https://huggingface.co/blog/moe',
    type: 'webpage',
    title: 'Mixture of Experts Explained',
    'container-title': 'Hugging Face',
    URL: 'https://huggingface.co/blog/moe',
    accessed: { 'date-parts': [[2026, 9, 18]] },
  },
};

/** Another web page the preview's web search returns. */
export const GOOGLE_STMOE_BLOG: Work = {
  key: 'url:https://research.google/blog/st-moe',
  kind: 'web',
  provider: 'web',
  state: 'unchecked',
  flags: [],
  csl: {
    id: 'url:https://research.google/blog/st-moe',
    type: 'webpage',
    title: 'Stable and transferable sparse experts',
    'container-title': 'Google Research',
    URL: 'https://research.google/blog/st-moe',
    accessed: { 'date-parts': [[2026, 9, 18]] },
  },
};

/** A work as a paper source returns it: its record `unchecked`, with the flags the source knows. */
export function asFound(work: Work): Work {
  const {
    checked: _checked,
    differs: _differs,
    notices: _notices,
    ...found
  } = structuredClone(work);
  return { ...found, state: 'unchecked' };
}
