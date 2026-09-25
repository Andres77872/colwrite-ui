import { EditorContext, EquationInline, LiteralEditor } from 'colwrite-ui';

// EquationInline is the maths widget embedded in a paragraph — inline in the
// run of text, or on its own centred line when `display` is set.
//
// Typesetting is bundled: src/lib/katex.ts imports the npm katex package and
// its stylesheet and reports 'ready' synchronously, so these cards show real
// typeset maths with no network access. (An earlier revision of that file
// loaded KaTeX from a CDN <script>, and the widget then fell back to showing
// raw LaTeX in a <code> — if you ever see that here, check src/lib/katex.ts.)

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

// EquationInline calls useEditor() internally as well as taking props, so it
// throws outright without a context above it. Literal value, never the real
// provider.
const EDITOR = { blocks: [], documentId: 'doc-1', refs };

function Frame({ children }: { children: React.ReactNode }) {
  return (
    <LiteralEditor value={EDITOR as unknown as Ctx}>{children}</LiteralEditor>
  );
}

function Sentence({ children }: { children: React.ReactNode }) {
  return (
    <Frame>
      <p className="max-w-[40rem] text-sm leading-relaxed text-muted-foreground">{children}</p>
    </Frame>
  );
}

export function InlineMath() {
  return (
    <Sentence>
      Substituting{' '}
      <EquationInline
        {...wiring}
        child={{ id: 'e1', type: 'equation', latex: 'L(N) = a N^{-\\alpha}' }}
      />{' '}
      into the budget constraint gives the compute-optimal ratio directly.
    </Sentence>
  );
}

export function DisplayMath() {
  return (
    <Frame>
      <div className="max-w-[40rem]">
        <p className="text-sm leading-relaxed text-muted-foreground">
          Minimising the loss subject to a fixed compute budget gives
        </p>
        <EquationInline
          {...wiring}
          child={{
            id: 'e2',
            type: 'equation',
            latex: 'N^* = G\\left(\\frac{C}{6}\\right)^{a},\\quad D^* = G^{-1}\\left(\\frac{C}{6}\\right)^{b}',
            display: true,
          }}
        />
      </div>
    </Frame>
  );
}

export function NumberedDisplay() {
  return (
    <Frame>
      <div className="max-w-[40rem]">
      <EquationInline
        {...wiring}
        child={{
          id: 'e3',
          type: 'equation',
          latex: '\\mathrm{Attention}(Q,K,V) = \\mathrm{softmax}\\!\\left(\\frac{QK^{\\top}}{\\sqrt{d_k}}\\right)V',
          display: true,
          numbered: true,
          labelId: 'eq:attention',
        }}
      />
      </div>
    </Frame>
  );
}

export function EmptyEquation() {
  return (
    <Sentence>
      A widget inserted but not yet written reads as{' '}
      <EquationInline {...wiring} child={{ id: 'e4', type: 'equation', latex: '' }} /> until the
      author fills it in.
    </Sentence>
  );
}
