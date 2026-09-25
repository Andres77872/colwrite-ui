import { Canvas, ConfirmProvider, EditorContext, LiteralEditor, ProposalsContext, ToastProvider } from 'colwrite-ui';

// Canvas is the document surface: it renders every block in order, puts the
// gutter affordances (BlockControls) beside each one, and drops any proposed
// change in place so the author judges a rewrite against the paragraph it
// would replace.
//
// ToastProvider AND ConfirmProvider are both required: Canvas itself only calls
// useToast, but the ReviewBar it pins to the top calls useConfirm, and that
// throws outright — the whole canvas renders as an empty surface without it.
//
// It reads about forty editor members, through itself and what it mounts
// (BlockControls, PageTitle, the block bodies, ReviewBar, and the block
// selection, caret and Ask AI hooks), plus `sets` from proposals, so the
// literal below is the largest in this directory. It is still a literal rather
// than the real EditorProvider for the usual three reasons: Date.now()/uid()
// seeding churns render hashes, the provider fires POST /api/document/list on
// mount, and proposal state is unreachable offline. See .design-sync/NOTES.md.
//
// The two lookups, `getBlock` and `getBlockIds`, are not in the literal: Frame
// derives them from the blocks the cell actually renders, so a cell that swaps
// in its own blocks (WithADiagram) is not answered from DRAFT.

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

// The page title is the document's name, drawn by Canvas itself (PageTitle),
// so the blocks start with the text: an H1 block repeating the name would put
// the title on the page twice.
const DRAFT = [
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
  loadingDocumentId: null,
  createRemote: () => Promise.reject(new Error('not reachable from a preview')),
  ensureRemoteDocument: () => Promise.resolve('doc-1'),
  saveRemote: () => Promise.resolve(),
  switchTo: () => Promise.resolve(),
  setFromJSON: noop,
  setDocName: noop,
  toggleCollapsed: noop,
  hasAnyRemoteDocs: true,
  recentlyChanged: new Set<string>(),
  markRecentlyChanged: noop,
  // Block selection (Esc, Shift+click). Empty: no block is selected.
  selectedBlockIds: [] as string[],
  selectBlocks: noop,
  clearBlockSelection: noop,
  removeBlocks: noop,
  indentBlock: noop,
  // Inserting after the last block, from the title or the blank-page actions.
  insertBlocksAfter: (_after: string | null, blocks: Array<{ id: string }>) => blocks.map((block) => block.id),
  // BlockControls, rendered per block, reads these.
  openMenuBlockId: null,
  openMenuType: null,
  lastSavedAt: null,
  setBlockMenu: noop,
  moveBlock: noop,
  duplicateBlock: noop,
  insertBlockBeforeExact: noop,
  setBlockKind: noop,
  removeBlock: noop,
  toggleAiHidden: noop,
  toggleLocked: noop,
  setHeadingLevel: noop,
  setParagraphColumns: noop,
  // The block bodies: paragraph children, Enter/Backspace, to-dos, code.
  addParagraphChild: newId,
  updateParagraphChild: noop,
  removeParagraphChild: noop,
  splitBlock: noop,
  mergeWithPrevious: noop,
  setChecked: noop,
  updateCodeText: noop,
  // Must really register: inline widgets and the caret hooks look their host
  // up in `refs` (NOTES.md, "registerEditable must really register").
  registerEditable: (id: string, el: HTMLDivElement | null) => {
    refs.current[id] = el;
  },
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
  const blocks = (editor?.blocks ?? EDITOR.blocks) as Array<{ id: string }>;
  const lookups = {
    getBlock: (id: string) => blocks.find((block) => block.id === id),
    getBlockIds: () => blocks.map((block) => block.id),
  };
  return (
    <ToastProvider>
      <ConfirmProvider>
        <LiteralEditor value={{ ...EDITOR, ...lookups, ...editor } as unknown as ECtx}>
          <ProposalsContext.Provider value={{ ...PROPOSALS, ...proposals } as unknown as PCtx}>
            {children}
          </ProposalsContext.Provider>
        </LiteralEditor>
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

// There is no "active block" cell any more. Canvas stopped tinting the row
// with the caret (the caret is its own indicator), so a WithAnActiveBlock cell
// rendered pixel-identical to ADraft. Block selection (Esc, Shift+click, ⌘A
// twice) is the row state that does draw: one continuous wash across the
// selected rows.
export function WithSelectedBlocks() {
  return (
    <Frame editor={{ selectedBlockIds: ['h2', 'p2'] }}>
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

// A diagram is a code block with `language: "mermaid"`; Canvas draws it as a
// DiagramBlock. The drawing settles a moment after mount (Mermaid lays out
// asynchronously) from deterministic source. Left to right and four nodes, so
// the page fits the 700px capture both ways: drawn top-down the flowchart alone
// was taller than the viewport, and a fifth node made it wider than the text
// column, where the drawing scrolls sideways and the card shows it cut off.
const WITH_DIAGRAM = [
  P('p1', 'Each token is routed to one expert; tokens past an expert’s capacity are dropped.'),
  {
    id: 'fig1',
    type: 'code' as const,
    language: 'mermaid',
    text: [
      'flowchart LR',
      '  X[Token] --> R{Router}',
      '  R -- top-1 --> E[Expert]',
      '  R -. over capacity .-> D[Dropped]',
    ].join('\n'),
  },
  P('p2', 'The capacity factor sets how many tokens an expert accepts per batch.'),
];

export function WithADiagram() {
  return (
    <Frame
      editor={{
        blocks: WITH_DIAGRAM,
        doc: { version: 4, name: 'Sparse Routing for Long-Context Pretraining', blocks: WITH_DIAGRAM },
      }}
    >
      <Canvas />
    </Frame>
  );
}

// A new page: no name yet (the title shows its "Untitled" placeholder) and no
// blocks, so Canvas offers its blank-page actions.
export function EmptyDocument() {
  return (
    <Frame editor={{ blocks: [], doc: { version: 1, name: 'Untitled document', blocks: [] } }}>
      <Canvas />
    </Frame>
  );
}
