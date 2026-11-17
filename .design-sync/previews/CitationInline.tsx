import {
  AssistantCatalogContext,
  BibliographyContext,
  CitationInline,
  EditorContext,
  LiteralEditor,
  assistantCatalogAllOn,
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
// It ALSO calls useEditor() internally (for the page's citation style, which
// its picker sets), so props alone are not enough — without an EditorContext
// above it the widget throws outright. A literal value is supplied, never the
// real provider.
//
// And it reads useBibliography(): the number a citation prints is its source's
// position in the document's reference list, which no single widget can know.
// Every cell therefore declares the paragraph it belongs to and derives the
// bibliography from it with the same `buildBibliography` the editor uses — so
// the numbering on the card is the numbering in a document.
//
// Same for the assistant catalog, which gates its paper search: the real
// provider fails closed offline, so the all-enabled literal is what shows the
// widget's full surface.

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
        <AssistantCatalogContext.Provider value={assistantCatalogAllOn}>
          <p className="max-w-[40rem] text-sm leading-relaxed text-muted-foreground">{children}</p>
        </AssistantCatalogContext.Provider>
      </BibliographyContext.Provider>
    </LiteralEditor>
  );
}

/** A reference record: a CSL-JSON item with ColWrite's fields beside it. */
const record = (key: string, title: string, author: Array<[string, string]>, year: number, venue?: string) => ({
  key,
  kind: 'paper' as const,
  provider: 'openalex' as const,
  state: 'verified' as const,
  flags: [] as never[],
  csl: {
    id: key,
    type: 'paper-conference' as const,
    title,
    author: author.map(([family, given]) => ({ family, given })),
    issued: { 'date-parts': [[year]] },
    ...(venue ? { 'container-title': venue } : {}),
  },
});

const HOFFMANN = record('hoffmann2022', 'Training Compute-Optimal Large Language Models', [['Hoffmann', 'Jordan'], ['Borgeaud', 'Sebastian'], ['Mensch', 'Arthur']], 2022, 'NeurIPS');
const KAPLAN = record('kaplan2020', 'Scaling Laws for Neural Language Models', [['Kaplan', 'Jared'], ['McCandlish', 'Sam']], 2020);
const VASWANI = record('vaswani2017', 'Attention Is All You Need', [['Vaswani', 'Ashish'], ['Shazeer', 'Noam']], 2017, 'NeurIPS');

export function Resolved() {
  const child: Child = {
    id: 'c1',
    type: 'citation',
    keys: ['hoffmann2022'],
    style: 'apa',
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
    style: 'nlm-citation-sequence-brackets',
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
    style: 'nlm-citation-sequence-brackets',
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
    style: 'apa',
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
  const child: Child = { id: 'c4', type: 'citation', keys: [], style: 'nlm-citation-sequence-brackets' };
  return (
    <Sentence cites={[child]}>
      We follow the matched-budget protocol <CitationInline {...wiring} child={child} /> throughout
      — no source has been attached yet.
    </Sentence>
  );
}
