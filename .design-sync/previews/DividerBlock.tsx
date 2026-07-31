import { DividerBlock } from 'colwrite-ui';

// DividerBlock takes no props and reads no context — it is the thematic break
// block, a full-width hairline with vertical breathing room. On its own it is a
// single 1px rule, so every cell renders it where it actually appears: between
// two runs of document prose, at the canvas measure.

function Prose({ children }: { children: React.ReactNode }) {
  return <p className="text-sm leading-relaxed text-muted-foreground">{children}</p>;
}

export function BetweenSections() {
  return (
    <div className="mx-auto w-full max-w-[var(--doc-measure)] px-6">
      <h2 className="text-lg font-semibold">3. Method</h2>
      <Prose>
        We decouple the learning-rate schedule from the batch size and re-run the
        original sweep at three compute budgets.
      </Prose>
      <DividerBlock />
      <h2 className="text-lg font-semibold">4. Results</h2>
      <Prose>
        The reported scaling exponent holds within error at every budget once the
        schedule is held fixed.
      </Prose>
    </div>
  );
}

export function BetweenParagraphs() {
  return (
    <div className="mx-auto w-full max-w-[var(--doc-measure)] px-6">
      <Prose>
        Self-attention replaced recurrence as the dominant sequence-modelling
        primitive largely on throughput grounds rather than sample efficiency.
      </Prose>
      <DividerBlock />
      <Prose>
        That distinction matters here: the budgets below are matched on wall-clock,
        not on tokens seen.
      </Prose>
    </div>
  );
}

// There is deliberately no bare cell. Alone the block is a single 1px rule on
// an otherwise empty card — it is what made the floor card trip [RENDER_BLANK].
// Both cells above show it doing its job, between real content.
