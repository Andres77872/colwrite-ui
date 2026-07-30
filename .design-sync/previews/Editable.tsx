import { Editable, EditorProvider } from 'colwrite-ui';

// Editable reads the editor store through useEditor(), so every cell wraps it
// in the real EditorProvider — the same module instance the bundled component
// reads from (exported via .design-sync/preview-providers.ts).
//
// It renders from the `html` prop, so a static capture is faithful. The slash
// menu, the floating format toolbar and the caret/selection behaviour are
// interaction-only and deliberately absent here.

function Canvas({ children }: { children: React.ReactNode }) {
  return (
    <div className="w-full max-w-sm rounded-lg border border-border bg-card px-4 py-3">
      {children}
    </div>
  );
}

export function ParagraphText() {
  return (
    <EditorProvider>
      <Canvas>
        <Editable
          id="preview-paragraph"
          slashEnabled
          className="text-md leading-relaxed"
          placeholder="Type something, or press '/' for commands…"
          html="We revisit the original transformer formulation under modern training budgets and show that the reported scaling behaviour holds only once the learning-rate schedule is decoupled from the batch size."
        />
      </Canvas>
    </EditorProvider>
  );
}

export function HeadingAndParagraph() {
  return (
    <EditorProvider>
      <Canvas>
        <Editable
          id="preview-heading"
          className="mb-1.5 text-2xl font-semibold leading-tight tracking-tight"
          placeholder="Heading"
          html="1. Introduction"
        />
        <Editable
          id="preview-body"
          slashEnabled
          className="text-md leading-relaxed"
          placeholder="Type something, or press '/' for commands…"
          html="Self-attention replaced recurrence as the dominant sequence-modelling primitive largely on throughput grounds rather than sample efficiency."
        />
      </Canvas>
    </EditorProvider>
  );
}

export function EmptyWithPlaceholder() {
  return (
    <EditorProvider>
      <Canvas>
        <Editable
          id="preview-empty"
          slashEnabled
          className="text-md leading-relaxed"
          placeholder="Type something, or press '/' for commands…"
          html=""
        />
      </Canvas>
    </EditorProvider>
  );
}

export function InlineFormatting() {
  return (
    <EditorProvider>
      <Canvas>
        <Editable
          id="preview-inline"
          slashEnabled
          className="text-md leading-relaxed"
          placeholder="Type something, or press '/' for commands…"
          html={
            'The <strong>learning-rate schedule</strong> matters more than the <em>batch size</em>, ' +
            'a result the <span class="ai-suggest"><span class="ai-generated">Chinchilla budget analysis</span></span> ' +
            'later confirmed at scale.'
          }
        />
      </Canvas>
    </EditorProvider>
  );
}

export function MultiColumnBlock() {
  return (
    <EditorProvider>
      <Canvas>
        <Editable
          id="preview-columns"
          slashEnabled
          className="text-sm leading-relaxed"
          placeholder="Type something, or press '/' for commands…"
          style={{
            columnCount: 2,
            columnGap: '2rem',
            columnRule: '1px solid var(--color-border)',
          }}
          html="Sequence length dominates the attention cost, so a two-column body is how the camera-ready template lays out dense derivations. The block keeps one contenteditable host and lets CSS columns do the flow."
        />
      </Canvas>
    </EditorProvider>
  );
}
