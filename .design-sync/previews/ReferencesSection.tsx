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

const KAPLAN = {
  key: '10.1000/kaplan',
  title: 'Scaling Laws for Neural Language Models',
  authors: 'Kaplan, J., McCandlish, S.',
  year: '2020',
  venue: 'arXiv',
  doi: '10.1000/kaplan',
};

const HOFFMANN = {
  key: '10.1000/hoffmann',
  title: 'Training Compute-Optimal Large Language Models',
  authors: 'Hoffmann, J., Borgeaud, S.',
  year: '2022',
  venue: 'NeurIPS',
  doi: '10.1000/hoffmann',
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
              style: 'numeric',
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
              style: 'numeric',
              sources: [HOFFMANN],
            },
          ],
        },
      ]}
    />
  );
}

/** Author–year drops the number and sorts the list alphabetically instead. */
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
              style: 'author-year',
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
              style: 'numeric',
              sources: [KAPLAN],
            },
          ],
        },
      ]}
    />
  );
}
