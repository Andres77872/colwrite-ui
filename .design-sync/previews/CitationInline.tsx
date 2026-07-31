import { AgentToolsContext, CitationInline, EditorContext, agentToolsAllEnabled } from 'colwrite-ui';

// CitationInline is the citation widget embedded in a paragraph. It is a
// type-guard wrapper: it renders nothing unless `child.type === 'citation'`,
// which is why every cell passes a real CitationChild rather than a stub.
//
// The six InlineWidgetProps fields are the widget's whole contract — the
// paragraph hands down its id, the child, and the three mutators plus the refs
// map. The mutators are no-ops because a static card has nothing to write back
// to.
//
// It ALSO calls useEditor() internally (to resolve keys against the document),
// so props alone are not enough — without an EditorContext above it the widget
// throws outright. A literal value is supplied, never the real provider.
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

const EDITOR = { blocks: [], documentId: 'doc-1', refs };

function Sentence({ children }: { children: React.ReactNode }) {
  return (
    <EditorContext.Provider value={EDITOR as unknown as Ctx}>
      <AgentToolsContext.Provider value={agentToolsAllEnabled}>
        <p className="max-w-[40rem] text-sm leading-relaxed text-muted-foreground">{children}</p>
      </AgentToolsContext.Provider>
    </EditorContext.Provider>
  );
}

export function Resolved() {
  return (
    <Sentence>
      The reported exponent holds within error at every budget{' '}
      <CitationInline
        {...wiring}
        child={{
          id: 'c1',
          type: 'citation',
          keys: ['hoffmann2022'],
          style: 'author-year',
          sources: [
            {
              key: 'hoffmann2022',
              title: 'Training Compute-Optimal Large Language Models',
              authors: 'Hoffmann, J., Borgeaud, S., Mensch, A.',
              year: '2022',
              venue: 'NeurIPS',
              provider: 'arxiv',
            },
          ],
        }}
      />{' '}
      once the schedule is decoupled from batch size.
    </Sentence>
  );
}

export function MultipleKeys() {
  return (
    <Sentence>
      Both of the original scaling studies{' '}
      <CitationInline
        {...wiring}
        child={{
          id: 'c2',
          type: 'citation',
          keys: ['kaplan2020', 'hoffmann2022'],
          style: 'numeric',
          sources: [
            { key: 'kaplan2020', title: 'Scaling Laws for Neural Language Models', authors: 'Kaplan, J., McCandlish, S.', year: '2020' },
            { key: 'hoffmann2022', title: 'Training Compute-Optimal Large Language Models', authors: 'Hoffmann, J., Borgeaud, S., Mensch, A.', year: '2022' },
          ],
        }}
      />{' '}
      fixed the schedule implicitly.
    </Sentence>
  );
}

export function WithPrefixAndLocator() {
  return (
    <Sentence>
      The derivation is given in full{' '}
      <CitationInline
        {...wiring}
        child={{
          id: 'c3',
          type: 'citation',
          keys: ['vaswani2017'],
          style: 'author-year',
          prefix: 'see',
          locator: 'ch. 3',
          sources: [
            { key: 'vaswani2017', title: 'Attention Is All You Need', authors: 'Vaswani, A., Shazeer, N.', year: '2017', venue: 'NeurIPS' },
          ],
        }}
      />
      .
    </Sentence>
  );
}

export function Unresolved() {
  return (
    <Sentence>
      We follow the matched-budget protocol{' '}
      <CitationInline
        {...wiring}
        child={{ id: 'c4', type: 'citation', keys: ['kaplan2020a'], style: 'author-year' }}
      />{' '}
      throughout — the key has no bibliography entry yet.
    </Sentence>
  );
}
