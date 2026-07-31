import { Input, InlinePill, InlinePopover, SettingsFooter, SettingsRow } from 'colwrite-ui';

// InlinePopover is the popover every inline widget edits through. It wires the
// three things each widget used to do by hand: stop the surrounding
// contenteditable from seeing popover events, keep Radix from pulling focus off
// the caret, and hand `children` a `close` for the Done button — which is why
// `children` is a function, not a node.
//
// CAPTURE NOTE: `open` is internal state (useState(false)) with no prop to
// force it, so these cards show the RESTING state — the trigger as it sits in
// the paragraph. Clicking it opens the panel; a static screenshot cannot. The
// panel body each cell would show is rendered on its own in the SettingsRow,
// SettingsCheck and SettingsFooter cards.

const noop = () => {};

function Sentence({ children }: { children: React.ReactNode }) {
  return <p className="max-w-[40rem] text-sm leading-relaxed text-muted-foreground">{children}</p>;
}

export function CitationTrigger() {
  return (
    <Sentence>
      The exponent holds within error at every budget{' '}
      <InlinePopover
        trigger={<InlinePill>[Hoffmann 2022]</InlinePill>}
        contentClassName="w-80 p-3"
      >
        {(close) => (
          <>
            <SettingsRow label="Citation key" htmlFor="popover-key">
              <Input id="popover-key" defaultValue="hoffmann2022" />
            </SettingsRow>
            <SettingsFooter onRemove={noop} onDone={close} />
          </>
        )}
      </InlinePopover>{' '}
      once the schedule is decoupled from batch size.
    </Sentence>
  );
}

export function EquationTrigger() {
  return (
    <Sentence>
      Substituting{' '}
      <InlinePopover
        align="center"
        trigger={<InlinePill className="font-mono">L = a·N^-α</InlinePill>}
        contentClassName="w-80 p-3"
      >
        {(close) => (
          <>
            <SettingsRow label="LaTeX" htmlFor="popover-tex">
              <Input id="popover-tex" defaultValue="L = a N^{-\\alpha}" />
            </SettingsRow>
            <SettingsFooter removeLabel="Remove equation" onRemove={noop} onDone={close} />
          </>
        )}
      </InlinePopover>{' '}
      into the budget constraint gives the compute-optimal ratio.
    </Sentence>
  );
}

export function UnresolvedTrigger() {
  return (
    <Sentence>
      We follow the matched-budget protocol{' '}
      <InlinePopover
        trigger={<InlinePill tone="error">[unresolved citation]</InlinePill>}
        contentClassName="w-80 p-3"
      >
        {(close) => (
          <>
            <SettingsRow
              label="Citation key"
              htmlFor="popover-unresolved"
              hint="No bibliography entry matches this key."
            >
              <Input id="popover-unresolved" defaultValue="kaplan2020a" />
            </SettingsRow>
            <SettingsFooter onRemove={noop} onDone={close} />
          </>
        )}
      </InlinePopover>{' '}
      throughout.
    </Sentence>
  );
}
