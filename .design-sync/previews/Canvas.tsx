import { Canvas, ConfirmProvider, EditorContext, ProposalsContext, ToastProvider } from 'colwrite-ui';

// Canvas is the document surface: it renders every block in order, puts the
// gutter affordances (BlockControls) beside each one, and drops any proposed
// change in place so the author judges a rewrite against the paragraph it
// would replace.
//
// ToastProvider AND ConfirmProvider are both required: Canvas itself only calls
// useToast, but the BlockControls it renders per block call useConfirm, and that
// throws outright — the whole canvas renders as an empty surface without it.
//
// It reads eighteen fields from the editor plus `sets` from proposals, so the
// literal below is the largest in this directory. It is still a literal rather
// than the real EditorProvider for the usual three reasons: Date.now()/uid()
// seeding churns render hashes, the provider fires POST /api/document/list on
// mount, and proposal state is unreachable offline. See .design-sync/NOTES.md.

type ECtx = React.ContextType<typeof EditorContext>;
type PCtx = React.ContextType<typeof ProposalsContext>;

const refs = { current: {} as Record<string, HTMLDivElement | null> };
const noop = () => {};
const newId = () => 'new-block';

const P = (id: string, html: string) => ({ id, type: 'paragraph' as const, html });
const H = (id: string, level: 1 | 2 | 3, html: string) => ({
  id,
  type: 'heading' as const,
  level,
  html,
});

const DRAFT = [
  H('h1', 1, 'Attention Is All You Need, Revisited'),
  P(
    'p1',
    'We revisit the original transformer formulation under modern training budgets and show that the reported scaling behaviour holds only once the learning-rate schedule is decoupled from the batch size.',
  ),
  H('h2', 2, '1. Introduction'),
  P(
    'p2',
    'Self-attention replaced recurrence as the dominant sequence-modelling primitive largely on throughput grounds rather than sample efficiency.',
  ),
  { id: 'd1', type: 'divider' as const },
  P('p3', 'Reported exponents are given at matched wall-clock, not matched tokens.'),
];

const EDITOR = {
  doc: { version: 4, name: 'Attention Is All You Need, Revisited', blocks: DRAFT },
  blocks: DRAFT,
  activeId: null,
  setActive: noop,
  reorderBlock: noop,
  addBlockAtStart: newId,
  addBlockAfter: newId,
  refs,
  updateHtml: noop,
  documentId: 'doc-1',
  createRemote: () => Promise.reject(new Error('not reachable from a preview')),
  setFromJSON: noop,
  toggleCollapsed: noop,
  hasAnyRemoteDocs: true,
  recentlyChanged: new Set<string>(),
  // BlockControls, rendered per block, reads these.
  openMenuBlockId: null,
  openMenuType: null,
  setBlockMenu: noop,
  moveBlock: noop,
  removeBlock: noop,
  toggleAiHidden: noop,
  toggleLocked: noop,
  setHeadingLevel: noop,
  setParagraphColumns: noop,
  addParagraphChild: newId,
  updateParagraphChild: noop,
  removeParagraphChild: noop,
  registerEditable: noop,
};

const PROPOSALS = {
  sets: [],
  pending: [],
  pendingCount: 0,
  invites: [],
  receive: () => ({ changes: 0, invited: false }),
  accept: noop,
  reject: noop,
  acceptAll: noop,
  rejectAll: noop,
  ready: () => true,
  focusChange: noop,
  focusedChangeId: null,
  dismissInvite: noop,
  error: null,
  clearError: noop,
};

function Frame({
  editor,
  proposals,
  children,
}: {
  editor?: Record<string, unknown>;
  proposals?: Record<string, unknown>;
  children: React.ReactNode;
}) {
  return (
    <ToastProvider>
      <ConfirmProvider>
        <EditorContext.Provider value={{ ...EDITOR, ...editor } as unknown as ECtx}>
          <ProposalsContext.Provider value={{ ...PROPOSALS, ...proposals } as unknown as PCtx}>
            {children}
          </ProposalsContext.Provider>
        </EditorContext.Provider>
      </ConfirmProvider>
    </ToastProvider>
  );
}

export function ADraft() {
  return (
    <Frame>
      <Canvas />
    </Frame>
  );
}

export function WithAnActiveBlock() {
  return (
    <Frame editor={{ activeId: 'p2' }}>
      <Canvas />
    </Frame>
  );
}

export function RecentlyChangedBlocks() {
  return (
    <Frame editor={{ recentlyChanged: new Set(['p2', 'p3']) }}>
      <Canvas />
    </Frame>
  );
}

export function EmptyDocument() {
  return (
    <Frame editor={{ blocks: [] }}>
      <Canvas />
    </Frame>
  );
}
