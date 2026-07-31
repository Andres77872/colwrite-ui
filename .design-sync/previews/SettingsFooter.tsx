import { Input, SettingsCheck, SettingsFooter, SettingsRow } from 'colwrite-ui';

// SettingsFooter is the one footer every inline-widget settings popover ends
// with: the destructive action on the left, the safe close on the right, above
// a hairline rule. Having exactly one of these is what keeps "Remove" in the
// same place in every widget.
//
// `removeLabel` is the only copy knob — it exists so the destructive verb can
// name what it deletes ("Remove table", "Remove figure") rather than saying
// "Remove" next to three other things that could also be removed.

function Panel({ children }: { children: React.ReactNode }) {
  return <div className="w-80 rounded-md border border-border bg-popover p-3">{children}</div>;
}

const noop = () => {};

export function Default() {
  return (
    <Panel>
      <SettingsFooter onRemove={noop} onDone={noop} />
    </Panel>
  );
}

export function NamedRemoveAction() {
  return (
    <Panel>
      <SettingsFooter removeLabel="Remove table" onRemove={noop} onDone={noop} />
    </Panel>
  );
}

export function ClosingASettingsPanel() {
  return (
    <Panel>
      <SettingsRow label="Caption" htmlFor="footer-caption">
        <Input id="footer-caption" defaultValue="Figure 3 — loss vs. compute" />
      </SettingsRow>
      <SettingsCheck id="footer-grid" label="Show grid lines" checked onChange={noop} />
      <SettingsFooter removeLabel="Remove figure" onRemove={noop} onDone={noop} />
    </Panel>
  );
}
