import { ConfirmProvider, EditorContext, ProposalsContext, ReviewBar } from 'colwrite-ui';

// ReviewBar is the sticky summary of everything the assistant is waiting on.
// Individual changes are reviewed in place (see ChangeCard), but a batch can
// span the whole document — without a count and a way to step through them, an
// author has no idea whether they have seen all of it.
//
// It returns null unless there is something to review: no pending changes, no
// invites and no error means no bar. That is a real state and not worth a card
// of its own, so every cell below has something pending.
//
// Both contexts are literal values — proposal state is only reachable through a
// live tool_action stream, so the real provider cannot be populated offline.
// ConfirmProvider is the real one; `useConfirm` throws without it.

type ECtx = React.ContextType<typeof EditorContext>;
type PCtx = React.ContextType<typeof ProposalsContext>;

const noop = () => {};

const BLOCKS = [
  { id: 'p1', type: 'paragraph' as const, html: 'We revisit the original transformer formulation.' },
  { id: 'p2', type: 'paragraph' as const, html: 'Self-attention replaced recurrence.' },
  { id: 'p3', type: 'paragraph' as const, html: 'We report exponents at matched wall-clock.' },
];

const change = (id: string, order: number, blockId: string) => ({
  id,
  order,
  kind: 'replace' as const,
  op: { op: 'replace_block' as const, blockId, block: { id: blockId, type: 'paragraph', html: 'Revised.' } },
  anchorBlockId: blockId,
  placement: null,
  producesBlockId: null,
  dependsOn: [],
  status: 'pending' as const,
});

const PENDING = [change('ch1', 0, 'p1'), change('ch2', 1, 'p2'), change('ch3', 2, 'p3')];

const BASE = {
  pending: PENDING,
  pendingCount: PENDING.length,
  sets: [],
  invites: [],
  acceptAll: noop,
  rejectAll: noop,
  focusChange: noop,
  focusedChangeId: null,
  dismissInvite: noop,
  error: null,
  clearError: noop,
};

function Frame({ proposals, children }: { proposals?: Record<string, unknown>; children: React.ReactNode }) {
  return (
    <ConfirmProvider>
      <EditorContext.Provider
        value={{ blocks: BLOCKS, switchTo: () => Promise.resolve() } as unknown as ECtx}
      >
        <ProposalsContext.Provider value={{ ...BASE, ...proposals } as unknown as PCtx}>
          <div className="w-[46rem]">{children}</div>
        </ProposalsContext.Provider>
      </EditorContext.Provider>
    </ConfirmProvider>
  );
}

export function PendingChanges() {
  return (
    <Frame>
      <ReviewBar />
    </Frame>
  );
}

export function ASingleChange() {
  return (
    <Frame proposals={{ pending: [PENDING[0]], pendingCount: 1 }}>
      <ReviewBar />
    </Frame>
  );
}

// There is deliberately no "stepping through a batch" cell: `focusedChangeId`
// changes which ChangeCard in the DOCUMENT is highlighted, not anything in the
// bar, so such a cell renders pixel-identical to PendingChanges. The list
// popover is internal state with no prop, so it cannot be shown either.

export function WithADocumentInvite() {
  return (
    <Frame
      proposals={{
        pending: [],
        pendingCount: 0,
        // Fixed epoch — a relative formatter here would churn the render hash.
        invites: [{ id: 'inv1', documentId: 'doc-7', receivedAt: 1710408360000 }],
      }}
    >
      <ReviewBar />
    </Frame>
  );
}

export function WithAnError() {
  return (
    <Frame
      proposals={{
        pending: [],
        pendingCount: 0,
        error: 'The document changed on the server — reload before applying these edits.',
      }}
    >
      <ReviewBar />
    </Frame>
  );
}
