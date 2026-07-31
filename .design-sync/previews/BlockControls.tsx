import { BlockControls, EditorContext } from 'colwrite-ui';

// BlockControls is the gutter affordance beside one block: an "add block" menu
// and an options menu (move, lock, hide from the assistant, change level or
// columns, delete).
//
// Both menus were hand-built portals once — no menu semantics, no arrow-key
// navigation, no focus return, and a z-[9999] that put them above modal
// dialogs. They are Radix menus now, which is also what makes them previewable:
// open state lives in the EDITOR context (`openMenuBlockId` + `openMenuType`),
// not inside the component, so a card can render either menu open by setting
// those two fields.
//
// Because an open menu portals to document.body, these cells are one-per-card
// (cardMode "single" in .design-sync/config.json) — otherwise every open menu
// in a grid lands on the same body and they paint over each other.

type Ctx = React.ContextType<typeof EditorContext>;

const refs = { current: {} as Record<string, HTMLDivElement | null> };
const noop = () => {};
const newId = () => 'new-block';

const BLOCKS = [
  { id: 'h1', type: 'heading' as const, level: 2, html: '3. Method' },
  {
    id: 'p1',
    type: 'paragraph' as const,
    html: 'We decouple the learning-rate schedule from the batch size and re-run the original sweep at three compute budgets.',
  },
];

const BASE = {
  blocks: BLOCKS,
  refs,
  addBlockAfter: newId,
  removeBlock: noop,
  toggleAiHidden: noop,
  toggleLocked: noop,
  toggleCollapsed: noop,
  setParagraphColumns: noop,
  setHeadingLevel: noop,
  setBlockMenu: noop,
  openMenuBlockId: null,
  openMenuType: null,
};

function Frame({ value, children }: { value?: Record<string, unknown>; children: React.ReactNode }) {
  return (
    <EditorContext.Provider value={{ ...BASE, ...value } as unknown as Ctx}>
      <div className="flex min-h-[16rem] items-start gap-2 p-4">{children}</div>
    </EditorContext.Provider>
  );
}

// There is deliberately no "resting" cell. The gutter affordances are
// opacity-0 until the block row is hovered or a menu is open, so a resting cell
// renders the paragraph and nothing of this component at all — an empty card
// that looks broken rather than one that documents the quiet default.

export function AddMenuOpen() {
  return (
    <Frame value={{ openMenuBlockId: 'p1', openMenuType: 'add' }}>
      <BlockControls id="p1" />
      <p className="max-w-[32rem] text-sm leading-relaxed text-muted-foreground">
        We decouple the learning-rate schedule from the batch size.
      </p>
    </Frame>
  );
}

export function OptionsMenuOnAParagraph() {
  return (
    <Frame value={{ openMenuBlockId: 'p1', openMenuType: 'options' }}>
      <BlockControls id="p1" />
      <p className="max-w-[32rem] text-sm leading-relaxed text-muted-foreground">
        We decouple the learning-rate schedule from the batch size.
      </p>
    </Frame>
  );
}

export function OptionsMenuOnAHeading() {
  return (
    <Frame value={{ openMenuBlockId: 'h1', openMenuType: 'options' }}>
      <BlockControls id="h1" />
      <h2 className="text-lg font-semibold">3. Method</h2>
    </Frame>
  );
}
