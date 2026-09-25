import { EditorContext, HeadingBlock, LiteralEditor } from 'colwrite-ui';

// HeadingBlock renders one heading block of the document.
//
// `level` (1–3) is the variant axis: the document outline is deliberately three
// levels deep, and each level is a distinct type scale rather than a browser
// default. `html` is the block's inline content, so it may carry the same
// inline markup a paragraph does.
//
// It declares no useEditor() of its own, but the `Editable` it renders does —
// registerEditable in particular — so it still needs an EditorContext above it.
// A literal value, never the real provider (which seeds state with
// Date.now()/uid() and hits the network on mount; see .design-sync/NOTES.md).

type Ctx = React.ContextType<typeof EditorContext>;

const refs = { current: {} as Record<string, HTMLDivElement | null> };
const noop = () => {};

const EDITOR = {
  refs,
  blocks: [],
  documentId: 'doc-1',
  registerEditable: (id: string, el: HTMLDivElement | null) => {
    refs.current[id] = el;
  },
  updateHtml: noop,
  setHeadingLevel: noop,
};

function Frame({ children }: { children: React.ReactNode }) {
  return (
    <LiteralEditor value={EDITOR as unknown as Ctx}>
      <div className="mx-auto w-full max-w-[var(--doc-measure)] px-6">{children}</div>
    </LiteralEditor>
  );
}

export function LevelOne() {
  return (
    <Frame>
      <HeadingBlock
        block={{ id: 'h1', type: 'heading', level: 1, html: 'Attention Is All You Need, Revisited' }}
      />
    </Frame>
  );
}

export function LevelTwo() {
  return (
    <Frame>
      <HeadingBlock block={{ id: 'h2', type: 'heading', level: 2, html: '3. Method' }} />
    </Frame>
  );
}

export function LevelThree() {
  return (
    <Frame>
      <HeadingBlock
        block={{ id: 'h3', type: 'heading', level: 3, html: '3.2 Matched-budget protocol' }}
      />
    </Frame>
  );
}

export function AllThreeLevels() {
  return (
    <Frame>
      <HeadingBlock
        block={{ id: 'o1', type: 'heading', level: 1, html: 'Attention Is All You Need, Revisited' }}
      />
      <HeadingBlock block={{ id: 'o2', type: 'heading', level: 2, html: '3. Method' }} />
      <HeadingBlock
        block={{ id: 'o3', type: 'heading', level: 3, html: '3.2 Matched-budget protocol' }}
      />
    </Frame>
  );
}

export function WithInlineMarkup() {
  return (
    <Frame>
      <HeadingBlock
        block={{
          id: 'h4',
          type: 'heading',
          level: 2,
          html: '4. Results for <em>matched</em> wall-clock',
        }}
      />
    </Frame>
  );
}
