import { ChatMarkdown } from 'colwrite-ui';

// ChatMarkdown renders one assistant message. It is a deliberately small
// subset of markdown parsed in-process (no remark/rehype): fenced code,
// h1–h3, bullet and ordered lists, blockquotes, paragraphs; inline `code`,
// **bold**, *italic* and [links](href).
//
// HAZARD — see .design-sync/NOTES.md. `parseBlocks` matches a fence with
// /^```(\w*)\s*$/ and its paragraph loop also skips any line starting with a
// fence, so an info string that is not a single \w* run (```js title="a.js",
// ```py extra) advances no index and hangs the renderer forever. Every fixture
// below therefore uses a bare fence or a single-word language, and any new one
// must too.

function Bubble({ children }: { children: React.ReactNode }) {
  return (
    <div className="max-w-[46rem] rounded-lg border border-border/70 bg-card p-3">{children}</div>
  );
}

const ANSWER = [
  '## Where the scaling claim breaks',
  '',
  'The exponent you quote holds only when the learning-rate schedule is held',
  'fixed across budgets. Two things follow:',
  '',
  '- At matched wall-clock the curves separate after ~3B tokens.',
  '- The gap is *schedule*, not data order — reshuffling does not close it.',
  '',
  'I can add a sentence to **4. Results** making the matched-budget caveat',
  'explicit, and cite [Hoffmann et al.](https://arxiv.org/abs/2203.15556) for it.',
].join('\n');

const WITH_CODE = [
  'Re-run the sweep with the schedule pinned, then compare the two fits:',
  '',
  '```python',
  'for budget in (1e20, 3e20, 1e21):',
  '    run(budget, lr_schedule="cosine", warmup=2000)',
  '```',
  '',
  'The `warmup` term is what the original sweep varied implicitly.',
].join('\n');

const WITH_QUOTE = [
  '# Draft note',
  '',
  'You wrote, in section 1:',
  '',
  '> Self-attention replaced recurrence largely on throughput grounds',
  '> rather than sample efficiency.',
  '',
  'That is the right framing. To make it defensible I would:',
  '',
  '1. Name the throughput metric you mean.',
  '2. Say at which sequence length the crossover happens.',
  '3. Move the sample-efficiency claim to section 4, where the data is.',
].join('\n');

const INLINE = [
  'Inline formatting is the whole vocabulary: `identifiers` and short code,',
  '**emphasis that carries weight**, *lighter emphasis*, and',
  '[a link out](https://example.org/paper) — nothing else is parsed, so a stray',
  'underscore in a variable name stays literal.',
].join('\n');

export function AssistantAnswer() {
  return (
    <Bubble>
      <ChatMarkdown text={ANSWER} />
    </Bubble>
  );
}

export function WithCodeBlock() {
  return (
    <Bubble>
      <ChatMarkdown text={WITH_CODE} />
    </Bubble>
  );
}

export function HeadingQuoteAndList() {
  return (
    <Bubble>
      <ChatMarkdown text={WITH_QUOTE} />
    </Bubble>
  );
}

export function InlineFormatting() {
  return (
    <Bubble>
      <ChatMarkdown text={INLINE} />
    </Bubble>
  );
}
