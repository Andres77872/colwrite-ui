import { BibliographyContext, ReferencesSection, buildBibliography } from 'colwrite-ui';

// ReferencesSection is the document's bibliography, rendered at the foot of the
// canvas. It takes no props at all: everything it shows — which sources exist,
// what number each one has, and every place it is cited from — is derived from
// the document's blocks, because a reference list that has to be kept in step
// by hand is a reference list that is wrong.
//
// So a preview supplies blocks, not a fixture: `buildBibliography` is the same
// function the editor calls, and the cards below are its real output. Nothing
// else is needed — unlike the editor components around it, this one reads no
// editor context and mutates nothing.

// Reference records: a CSL-JSON item with ColWrite's fields beside it. One
// is verified (quiet), one was retracted since, so the list marks it.
const KAPLAN = {
  key: 'doi:10.1000/kaplan',
  kind: 'paper' as const,
  provider: 'crossref' as const,
  state: 'verified' as const,
  flags: [],
  csl: {
    id: 'doi:10.1000/kaplan',
    type: 'article' as const,
    title: 'Scaling Laws for Neural Language Models',
    author: [{ family: 'Kaplan', given: 'Jared' }, { family: 'McCandlish', given: 'Sam' }],
    issued: { 'date-parts': [[2020]] },
    publisher: 'arXiv',
    DOI: '10.1000/kaplan',
  },
};

const HOFFMANN = {
  key: 'doi:10.1000/hoffmann',
  kind: 'paper' as const,
  provider: 'crossref' as const,
  state: 'verified' as const,
  flags: ['retracted' as const],
  notices: [{ type: 'retraction' as const, date: '2025-02-01', source: 'crossref' }],
  csl: {
    id: 'doi:10.1000/hoffmann',
    type: 'paper-conference' as const,
    title: 'Training Compute-Optimal Large Language Models',
    author: [{ family: 'Hoffmann', given: 'Jordan' }, { family: 'Borgeaud', given: 'Sebastian' }],
    issued: { 'date-parts': [[2022]] },
    'container-title': 'NeurIPS',
    DOI: '10.1000/hoffmann',
  },
};

type Blocks = Parameters<typeof buildBibliography>[0];

function Frame({ blocks }: { blocks: Blocks }) {
  return (
    <BibliographyContext.Provider value={buildBibliography(blocks)}>
      {/* The section indents itself by the canvas gutter, which does not exist
          on a card. */}
      <div className="w-full max-w-[42rem] [--doc-gutter:0px]">
        <ReferencesSection />
      </div>
    </BibliographyContext.Provider>
  );
}

/** Numbered in citation order, each row linking back to where it is used. */
export function Numbered() {
  return (
    <Frame
      blocks={[
        {
          id: 'p1',
          type: 'paragraph',
          html: '<span data-child-id="c1"></span>',
          children: [
            {
              id: 'c1',
              type: 'citation',
              keys: [KAPLAN.key, HOFFMANN.key],
              style: 'nlm-citation-sequence-brackets' as const,
              sources: [KAPLAN, HOFFMANN],
            },
          ],
        },
        // The same paper again: one row, two back-links.
        {
          id: 'p2',
          type: 'paragraph',
          html: '<span data-child-id="c2"></span>',
          children: [
            {
              id: 'c2',
              type: 'citation',
              keys: [HOFFMANN.key],
              style: 'nlm-citation-sequence-brackets' as const,
              sources: [HOFFMANN],
            },
          ],
        },
      ]}
    />
  );
}

/** An author-date style (APA) drops the number and sorts the list by author. */
export function AuthorYear() {
  return (
    <Frame
      blocks={[
        {
          id: 'p1',
          type: 'paragraph',
          html: '<span data-child-id="c1"></span>',
          children: [
            {
              id: 'c1',
              type: 'citation',
              keys: [KAPLAN.key, HOFFMANN.key],
              style: 'apa' as const,
              sources: [KAPLAN, HOFFMANN],
            },
          ],
        },
      ]}
    />
  );
}

/** A key with nothing attached is named and counted, not quietly dropped. */
export function Unresolved() {
  return (
    <Frame
      blocks={[
        {
          id: 'p1',
          type: 'paragraph',
          html: '<span data-child-id="c1"></span>',
          children: [
            {
              id: 'c1',
              type: 'citation',
              keys: [KAPLAN.key, 'smith2019'],
              style: 'nlm-citation-sequence-brackets' as const,
              sources: [KAPLAN],
            },
          ],
        },
      ]}
    />
  );
}
