import { BlockControls, EditorContext, LiteralEditor, ToastProvider } from 'colwrite-ui';

// BlockControls is the gutter beside one block: `+` (add a line below and open
// the "/" menu on it), the `⋮⋮` handle (drag to move, click for the block
// menu), and the author's marks — locked, hidden from the assistant,
// collapsed — which stay visible while the controls are not.
//
// The component takes the block and its menu state as props (`block`,
// `isFirst`, `isLast`, `menuOpen`), which is what makes the menu previewable:
// the menu is a controlled Radix menu, so `menuOpen` renders it open. There is
// no separate "add" menu any more — `+` inserts a line and opens the "/" menu,
// which is SlashMenu's card — so the old AddMenuOpen cell is gone.
//
// Placement comes from globals.css: the controls sit outside a `.block-row`
// on its left, in the page padding of `.document-container`, revealed on
// hover, focus or while the menu is open. So each cell renders that real
// container and row, exactly as Canvas does — which is also where the block's
// type size comes from. `useToast` (Copy link, Copy as Markdown) throws
// without ToastProvider.
//
// Because an open menu portals to document.body, these cells are one-per-card
// (cardMode "single" in .design-sync/config.json) — otherwise every open menu
// in a grid lands on the same body and they paint over each other.

type Ctx = React.ContextType<typeof EditorContext>;
type Block = React.ComponentProps<typeof BlockControls>['block'];

const refs = { current: {} as Record<string, HTMLDivElement | null> };
const noop = () => {};

const HEADING = { id: 'h1', type: 'heading', level: 2, html: '3. Method' } as Block;
const PARAGRAPH = {
  id: 'p1',
  type: 'paragraph',
  html: 'We decouple the learning-rate schedule from the batch size and re-run the original sweep at three compute budgets.',
  children: [],
  columns: 1,
} as Block;

const EDITOR = {
  refs,
  // The menu footer's "Page edited …" line is relative to now; null leaves it
  // out, so the card does not change from one sync to the next.
  lastSavedAt: null,
  duplicateBlock: noop,
  insertBlocksAfter: (_after: string, blocks: Array<{ id: string }>) => blocks.map((block) => block.id),
  insertBlockBeforeExact: noop,
  moveBlock: noop,
  removeBlock: noop,
  selectBlocks: noop,
  setBlockKind: noop,
  setBlockMenu: noop,
  setHeadingLevel: noop,
  setParagraphColumns: noop,
  toggleAiHidden: noop,
  toggleCollapsed: noop,
  toggleLocked: noop,
};

function Row({
  block,
  menuOpen = false,
  isFirst = false,
  isLast = false,
  children,
}: {
  block: Block;
  menuOpen?: boolean;
  isFirst?: boolean;
  isLast?: boolean;
  children: React.ReactNode;
}) {
  return (
    <ToastProvider>
      <LiteralEditor value={EDITOR as unknown as Ctx}>
        <div className="min-h-[16rem] w-[40rem] py-4">
          <div className="document-container">
            <div
              className="block-row group"
              data-kind={block.type === 'heading' ? `h${block.level}` : 'text'}
              data-block-id={block.id}
            >
              <BlockControls block={block} isFirst={isFirst} isLast={isLast} menuOpen={menuOpen} />
              <div className="block-content w-full">{children}</div>
            </div>
          </div>
        </div>
      </LiteralEditor>
    </ToastProvider>
  );
}

// There is deliberately no plain "resting" cell: the controls are opacity-0
// until the row is hovered or the menu is open, so a resting block with no
// marks renders nothing of this component. A block with marks does.
export function MarksOnALockedHiddenBlock() {
  return (
    <Row block={{ ...PARAGRAPH, locked: true, aiHidden: true } as Block}>
      <p>
        We decouple the learning-rate schedule from the batch size and re-run the original sweep at
        three compute budgets.
      </p>
    </Row>
  );
}

export function OptionsMenuOnAParagraph() {
  return (
    <Row block={PARAGRAPH} menuOpen isLast>
      <p>
        We decouple the learning-rate schedule from the batch size and re-run the original sweep at
        three compute budgets.
      </p>
    </Row>
  );
}

export function OptionsMenuOnAHeading() {
  return (
    <Row block={HEADING} menuOpen isFirst>
      <h2>3. Method</h2>
    </Row>
  );
}
