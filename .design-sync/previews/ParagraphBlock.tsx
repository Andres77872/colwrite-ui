import {
  AgentToolsContext,
  BibliographyContext,
  EditorContext,
  LiteralEditor,
  ParagraphBlock,
  agentToolsAllEnabled,
  buildBibliography,
} from 'colwrite-ui';

// ParagraphBlock is the workhorse block: contenteditable prose in `html`, plus
// an optional `children` array of inline widgets (citation, equation, graph,
// table, AI passage) that are rendered into placeholders in that html.
//
// It reads six things from the editor and nothing else, so a literal context
// value covers it — never the real EditorProvider, which is non-deterministic
// and hits the network on mount (see .design-sync/NOTES.md).
//
// The citation cell mounts CitationInline, which calls useAgentTools(), so the
// frame supplies that literal too — without it the paragraph still renders but
// throws on the widget, and the citation never appears.
//
// CitationInline also reads useBibliography(): a citation's printed label is
// derived from the document's reference list, not from the child alone. With no
// BibliographyContext above it the lookup misses and the widget falls back to
// printing the raw bibtex key — "(hoffmann2022)" instead of "(Hoffmann, 2022)".
// So the frame takes the blocks it wraps and derives the bibliography with the
// same `buildBibliography` the editor uses.
//
// `columns` is the layout axis: a paragraph can be set to render its prose in
// two columns, which is the one thing about this block that is not inherited
// from the document measure.

type Ctx = React.ContextType<typeof EditorContext>;

const refs = { current: {} as Record<string, HTMLDivElement | null> };
const noop = () => {};

const editorValue = (blocks: unknown[]) => ({
  refs,
  // The reference list is derived from the blocks on every render, so the
  // document a citation belongs to has to be visible here.
  blocks,
  // Must actually populate `refs`, not just exist: the effect that mounts inline
  // children looks the host up as refs.current[block.id], so a no-op here leaves
  // every [data-child-id] placeholder empty and the widgets never appear.
  registerEditable: (id: string, el: HTMLDivElement | null) => {
    refs.current[id] = el;
  },
  updateParagraphChild: noop,
  removeParagraphChild: noop,
  updateHtml: noop,
  documentId: 'doc-1',
  ensureRemoteDocument: () => Promise.reject(new Error('not reachable from a preview')),
});

function Frame({ children, blocks = [] }: { children: React.ReactNode; blocks?: unknown[] }) {
  return (
    <LiteralEditor value={editorValue(blocks) as unknown as Ctx}>
      <BibliographyContext.Provider value={buildBibliography(blocks as never)}>
        <AgentToolsContext.Provider value={agentToolsAllEnabled}>
          <div className="mx-auto w-full max-w-[var(--doc-measure)] px-6">{children}</div>
        </AgentToolsContext.Provider>
      </BibliographyContext.Provider>
    </LiteralEditor>
  );
}

export function Prose() {
  return (
    <Frame>
      <ParagraphBlock
        block={{
          id: 'p1',
          type: 'paragraph',
          html: 'We revisit the original transformer formulation under modern training budgets and show that the reported scaling behaviour holds only once the learning-rate schedule is decoupled from the batch size.',
        }}
      />
    </Frame>
  );
}

export function WithInlineMarkup() {
  return (
    <Frame>
      <ParagraphBlock
        block={{
          id: 'p2',
          type: 'paragraph',
          html: 'Reported exponents are given at <strong>matched wall-clock</strong>, not matched tokens — a distinction the original sweep <em>never tested</em>.',
        }}
      />
    </Frame>
  );
}

// Declared once and handed to both the frame and the block: the bibliography is
// built from the same object the paragraph renders, which is what makes the
// printed label agree with the reference list.
const citationBlock = {
  id: 'p3',
  type: 'paragraph',
  // A child is mounted into a [data-child-id] placeholder in the html —
  // the array alone is not enough, the paragraph has to say where it goes.
  html: 'The exponent holds within error at every budget <span data-child-id="c1"></span> once the schedule is fixed.',
  children: [
    {
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
        },
      ],
    },
  ],
};

export function WithACitation() {
  return (
    <Frame blocks={[citationBlock]}>
      <ParagraphBlock block={citationBlock as never} />
    </Frame>
  );
}

export function WithAFigure() {
  return (
    <Frame>
      <ParagraphBlock
        block={{
          id: 'p4',
          type: 'paragraph',
          html: 'Loss falls smoothly across the three budgets we could afford to run.<span data-child-id="g1"></span>',
          children: [
            {
              id: 'g1',
              type: 'graph',
              kind: 'bar',
              data: { values: [2.84, 2.61, 2.39], labels: ['1e20', '3e20', '1e21'] },
              title: 'Final loss by compute budget',
              caption: 'Figure 3 — matched wall-clock.',
            },
          ],
        }}
      />
    </Frame>
  );
}

export function TwoColumns() {
  return (
    <Frame>
      <ParagraphBlock
        block={{
          id: 'p5',
          type: 'paragraph',
          columns: 2,
          html: 'Self-attention replaced recurrence as the dominant sequence-modelling primitive largely on throughput grounds rather than sample efficiency. That distinction matters here: the budgets below are matched on wall-clock, not on tokens seen, and the two orderings disagree past roughly three billion tokens.',
        }}
      />
    </Frame>
  );
}
