import { ChangeCard, EditorContext, ProposalsContext } from 'colwrite-ui';

// ChangeCard is one proposed change, rendered where it would land in the
// document. The accept and reject controls live here rather than in the chat
// panel on purpose: an author cannot judge a rewrite from a summary, only from
// seeing it against the paragraph it replaces.
//
// It reads `blocks` from the editor (to show the text being replaced) and
// accept/reject/ready/focusedChangeId from proposals. Both contexts are literal
// values: proposal state has no entry point except `receive(action)` fed by a
// live tool_action stream, so the real provider cannot be driven to a populated
// state offline at all. See .design-sync/NOTES.md.

type ECtx = React.ContextType<typeof EditorContext>;
type PCtx = React.ContextType<typeof ProposalsContext>;

const noop = () => {};

const BLOCKS = [
  {
    id: 'p2',
    type: 'paragraph' as const,
    html: 'Self-attention replaced recurrence as the dominant sequence-modelling primitive largely on throughput grounds rather than sample efficiency.',
  },
  {
    id: 'p3',
    type: 'paragraph' as const,
    html: 'We report exponents at matched wall-clock.',
  },
];

const PROPOSALS = {
  accept: noop,
  reject: noop,
  ready: () => true,
  focusedChangeId: null,
};

function Frame({
  proposals,
  children,
}: {
  proposals?: Record<string, unknown>;
  children: React.ReactNode;
}) {
  return (
    <EditorContext.Provider value={{ blocks: BLOCKS } as unknown as ECtx}>
      <ProposalsContext.Provider
        value={{ ...PROPOSALS, ...proposals } as unknown as PCtx}
      >
        <div className="mx-auto w-full max-w-[var(--doc-measure)] px-6">{children}</div>
      </ProposalsContext.Provider>
    </EditorContext.Provider>
  );
}

const REPLACE = {
  id: 'ch1',
  order: 0,
  kind: 'replace' as const,
  op: {
    op: 'replace_block' as const,
    blockId: 'p2',
    block: {
      id: 'p2',
      type: 'paragraph',
      html: 'Self-attention displaced recurrence primarily on throughput grounds; the sample-efficiency case was made later and on thinner evidence.',
    },
  },
  anchorBlockId: 'p2',
  placement: null,
  producesBlockId: null,
  dependsOn: [],
  status: 'pending' as const,
};

export function ReplacingAParagraph() {
  return (
    <Frame>
      <ChangeCard change={REPLACE} />
    </Frame>
  );
}

export function Focused() {
  return (
    <Frame proposals={{ focusedChangeId: 'ch1' }}>
      <ChangeCard change={REPLACE} />
    </Frame>
  );
}

export function InsertingAfterABlock() {
  return (
    <Frame>
      <ChangeCard
        change={{
          id: 'ch2',
          order: 1,
          kind: 'insert',
          op: {
            op: 'insert_block_after',
            referenceId: 'p3',
            block: {
              id: 'p4',
              type: 'paragraph',
              html: 'Matched-token comparisons invert the ordering past roughly three billion tokens, which is why we do not report them.',
            },
          },
          anchorBlockId: 'p3',
          placement: 'after',
          producesBlockId: 'p4',
          dependsOn: [],
          status: 'pending',
        }}
      />
    </Frame>
  );
}

export function BlockedByADependency() {
  return (
    <Frame proposals={{ ready: () => false }}>
      <ChangeCard
        change={{
          id: 'ch3',
          order: 2,
          kind: 'replace',
          op: {
            op: 'replace_block',
            blockId: 'p3',
            block: { id: 'p3', type: 'paragraph', html: 'We report exponents at matched wall-clock and, in Appendix B, at matched tokens.' },
          },
          anchorBlockId: 'p3',
          placement: null,
          producesBlockId: null,
          dependsOn: ['ch1'],
          status: 'pending',
        }}
      />
    </Frame>
  );
}

export function DeletingABlock() {
  return (
    <Frame>
      <ChangeCard
        change={{
          id: 'ch4',
          order: 3,
          kind: 'delete',
          op: { op: 'delete_block', blockId: 'p3' },
          anchorBlockId: 'p3',
          placement: null,
          producesBlockId: null,
          dependsOn: [],
          status: 'pending',
        }}
      />
    </Frame>
  );
}
