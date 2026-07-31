import { InlinePill } from 'colwrite-ui';

// InlinePill is the in-flow trigger every text-level widget shares — a real
// <button> that sits inside a sentence without breaking the line box. It is
// what a citation or an inline equation renders as before you click it.
//
// It takes ordinary button attributes plus `tone`. Only two tones exist on
// purpose: the app reserves `primary` for interactive constructs and
// destructive for errors, so a widget must not tint itself with a chart or
// block-lock colour to signal a category.

function Sentence({ children }: { children: React.ReactNode }) {
  return (
    <p className="max-w-[40rem] text-sm leading-relaxed text-muted-foreground">{children}</p>
  );
}

export function InRunningText() {
  return (
    <Sentence>
      The reported exponent holds within error at every budget{' '}
      <InlinePill>[Hoffmann 2022]</InlinePill> once the schedule is decoupled from batch
      size, which the original sweep never tested{' '}
      <InlinePill>[Kaplan 2020]</InlinePill>.
    </Sentence>
  );
}

export function ErrorTone() {
  return (
    <Sentence>
      We follow the matched-budget protocol{' '}
      <InlinePill tone="error">[unresolved citation]</InlinePill> throughout, and report
      wall-clock rather than tokens seen.
    </Sentence>
  );
}

export function BothTones() {
  return (
    <div className="flex items-center gap-3">
      <InlinePill>[Vaswani 2017]</InlinePill>
      <InlinePill tone="error">[missing key]</InlinePill>
    </div>
  );
}

export function AsAnEquationTrigger() {
  return (
    <Sentence>
      Substituting <InlinePill className="font-mono">L = a·N^-α</InlinePill> into the budget
      constraint gives the compute-optimal ratio directly.
    </Sentence>
  );
}
