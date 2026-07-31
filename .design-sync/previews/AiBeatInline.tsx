import { AiBeatInline } from 'colwrite-ui';

// AiBeatInline is the "AI passage" widget: a prompt the author keeps in the
// document, plus the text the assistant generated from it. Unlike the other
// inline widgets it is primary-tinted rather than neutral, because it marks a
// span of the document that is machine-written and re-runnable.
//
// It takes AiBeatWidgetProps — the six shared InlineWidgetProps fields plus
// `documentId` and `createRemote`, which it needs to be able to generate into a
// document that does not exist yet. `createRemote` is never called in a static
// card; it is wired to a rejected promise rather than a no-op so that an
// accidental call would surface rather than hang.
//
// `output` is the only field the widget also keeps locally, because it arrives
// token by token while generating. These cells pin it, so they show settled
// states: generated, not yet generated, and collapsed.

const refs = { current: {} as Record<string, HTMLDivElement | null> };
const noop = () => {};

const wiring = {
  blockId: 'block-1',
  updateParagraphChild: noop,
  removeParagraphChild: noop,
  updateHtml: noop,
  refs,
  documentId: 'doc-1',
  createRemote: () => Promise.reject(new Error('not reachable from a preview')),
};

export function Generated() {
  return (
    <div className="max-w-[38rem]">
      <AiBeatInline
        {...wiring}
        child={{
          id: 'a1',
          type: 'aiBeat',
          message: 'Summarise the matched-budget result in two sentences for the abstract.',
          prompt: 'Write in the past tense, no hedging, no citations.',
          output:
            'Holding the learning-rate schedule fixed, the scaling exponent was stable across all three compute budgets. The apparent budget dependence reported earlier is an artefact of co-varying the schedule with batch size.',
        }}
      />
    </div>
  );
}

export function NotYetGenerated() {
  return (
    <div className="max-w-[38rem]">
      <AiBeatInline
        {...wiring}
        child={{
          id: 'a2',
          type: 'aiBeat',
          message: 'Draft a limitations paragraph covering the single-seed runs.',
          prompt: 'Three sentences, plain prose, acknowledge the cost constraint.',
          output: '',
        }}
      />
    </div>
  );
}

export function Collapsed() {
  return (
    <div className="max-w-[38rem]">
      <AiBeatInline
        {...wiring}
        child={{
          id: 'a3',
          type: 'aiBeat',
          message: 'Summarise the matched-budget result in two sentences for the abstract.',
          prompt: 'Write in the past tense, no hedging, no citations.',
          output:
            'Holding the learning-rate schedule fixed, the scaling exponent was stable across all three compute budgets.',
          collapsed: true,
        }}
      />
    </div>
  );
}
