import { AgentToolsContext, EditorContext, ParagraphBlock, agentToolsAllEnabled } from 'colwrite-ui';

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
// `columns` is the layout axis: a paragraph can be set to render its prose in
// two columns, which is the one thing about this block that is not inherited
// from the document measure.

type Ctx = React.ContextType<typeof EditorContext>;

const refs = { current: {} as Record<string, HTMLDivElement | null> };
const noop = () => {};

const EDITOR = {
  refs,
  // CitationInline walks the document to resolve keys, and iterates this.
  blocks: [],
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
  createRemote: () => Promise.reject(new Error('not reachable from a preview')),
};

function Frame({ children }: { children: React.ReactNode }) {
  return (
    <EditorContext.Provider value={EDITOR as unknown as Ctx}>
      <AgentToolsContext.Provider value={agentToolsAllEnabled}>
        <div className="mx-auto w-full max-w-[var(--doc-measure)] px-6">{children}</div>
      </AgentToolsContext.Provider>
    </EditorContext.Provider>
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

export function WithACitation() {
  return (
    <Frame>
      <ParagraphBlock
        block={{
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
        }}
      />
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
