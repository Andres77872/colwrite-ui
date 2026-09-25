import {
  AgentToolsContext,
  BibliographyContext,
  CitationInline,
  EditorContext,
  LiteralEditor,
  agentToolsAllEnabled,
  buildBibliography,
} from 'colwrite-ui';

// CitationInline is the citation widget embedded in a paragraph. It is a
// type-guard wrapper: it renders nothing unless `child.type === 'citation'`,
// which is why every cell passes a real CitationChild rather than a stub.
//
// The six InlineWidgetProps fields are the widget's whole contract — the
// paragraph hands down its id, the child, and the three mutators plus the refs
// map. The mutators are no-ops because a static card has nothing to write back
// to.
//
// It ALSO calls useEditor() internally (for the document-wide "apply this style
// everywhere" action), so props alone are not enough — without an EditorContext
// above it the widget throws outright. A literal value is supplied, never the
// real provider.
//
// And it reads useBibliography(): the number a citation prints is its source's
// position in the document's reference list, which no single widget can know.
// Every cell therefore declares the paragraph it belongs to and derives the
// bibliography from it with the same `buildBibliography` the editor uses — so
// the numbering on the card is the numbering in a document.
//
// Same for useAgentTools(), which gates its arXiv and Semantic Scholar lookup
// affordances: the real provider fails closed offline, so the all-enabled
// literal is what shows the widget's full surface.

const refs = { current: {} as Record<string, HTMLDivElement | null> };
const noop = () => {};

const wiring = {
  blockId: 'block-1',
  updateParagraphChild: noop,
  removeParagraphChild: noop,
  updateHtml: noop,
  refs,
};

type Ctx = React.ContextType<typeof EditorContext>;
type Child = React.ComponentProps<typeof CitationInline>['child'];

/** One paragraph holding the cell's citations, plus the bibliography it implies. */
function Sentence({ children, cites }: { children: React.ReactNode; cites: Child[] }) {
  const blocks = [
    {
      id: 'block-1',
      type: 'paragraph' as const,
      html: cites.map((child) => `<span data-child-id="${child.id}"></span>`).join(''),
      children: cites,
    },
  ];

  return (
    <LiteralEditor value={{ blocks, documentId: 'doc-1', refs } as unknown as Ctx}>
      <BibliographyContext.Provider value={buildBibliography(blocks)}>
        <AgentToolsContext.Provider value={agentToolsAllEnabled}>
          <p className="max-w-[40rem] text-sm leading-relaxed text-muted-foreground">{children}</p>
        </AgentToolsContext.Provider>
      </BibliographyContext.Provider>
    </LiteralEditor>
  );
}

const HOFFMANN = {
  key: 'hoffmann2022',
  title: 'Training Compute-Optimal Large Language Models',
  authors: 'Hoffmann, J., Borgeaud, S., Mensch, A.',
  year: '2022',
  venue: 'NeurIPS',
  provider: 'arxiv' as const,
};

const KAPLAN = {
  key: 'kaplan2020',
  title: 'Scaling Laws for Neural Language Models',
  authors: 'Kaplan, J., McCandlish, S.',
  year: '2020',
};

const VASWANI = {
  key: 'vaswani2017',
  title: 'Attention Is All You Need',
  authors: 'Vaswani, A., Shazeer, N.',
  year: '2017',
  venue: 'NeurIPS',
};

export function Resolved() {
  const child: Child = {
    id: 'c1',
    type: 'citation',
    keys: ['hoffmann2022'],
    style: 'author-year',
    sources: [HOFFMANN],
  };
  return (
    <Sentence cites={[child]}>
      The reported exponent holds within error at every budget{' '}
      <CitationInline {...wiring} child={child} /> once the schedule is decoupled from batch size.
    </Sentence>
  );
}

export function MultipleKeys() {
  const child: Child = {
    id: 'c2',
    type: 'citation',
    keys: ['kaplan2020', 'hoffmann2022'],
    style: 'numeric',
    sources: [KAPLAN, HOFFMANN],
  };
  return (
    <Sentence cites={[child]}>
      Both of the original scaling studies <CitationInline {...wiring} child={child} /> fixed the
      schedule implicitly.
    </Sentence>
  );
}

/**
 * The same source cited twice. Numbering counts sources, not citations, so both
 * pills read `[1]` — the thing a reader needs in order to tell that these are
 * one paper and not two.
 */
export function RepeatedSource() {
  const first: Child = {
    id: 'c5',
    type: 'citation',
    keys: ['kaplan2020'],
    style: 'numeric',
    sources: [KAPLAN],
  };
  const second: Child = { ...first, id: 'c6', locator: 'p. 8' };
  return (
    <Sentence cites={[first, second]}>
      The original fit <CitationInline {...wiring} child={first} /> is reproduced at every scale we
      tested, and its appendix <CitationInline {...wiring} child={second} /> gives the exact
      schedule.
    </Sentence>
  );
}

export function WithPrefixAndLocator() {
  const child: Child = {
    id: 'c3',
    type: 'citation',
    keys: ['vaswani2017'],
    style: 'author-year',
    prefix: 'see',
    locator: 'ch. 3',
    sources: [VASWANI],
  };
  return (
    <Sentence cites={[child]}>
      The derivation is given in full <CitationInline {...wiring} child={child} />.
    </Sentence>
  );
}

/** No source attached: `[?]`, in the destructive tone, rather than a number. */
export function Unresolved() {
  const child: Child = { id: 'c4', type: 'citation', keys: [], style: 'numeric' };
  return (
    <Sentence cites={[child]}>
      We follow the matched-budget protocol <CitationInline {...wiring} child={child} /> throughout
      — no source has been attached yet.
    </Sentence>
  );
}
