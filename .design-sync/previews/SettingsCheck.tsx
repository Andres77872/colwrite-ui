import { SettingsCheck } from 'colwrite-ui';

// SettingsCheck is the checkbox row inside an inline widget's settings popover:
// a Checkbox bound to its label by `id`, with an optional hint underneath.
//
// It is fully controlled — `checked` in, `onChange` out — so each cell below
// pins a state rather than letting it toggle. The handlers are no-ops for that
// reason; in the product they write straight back to the paragraph child.
//
// Rendered on the popover's own surface (w-80 p-3), which is where it always
// appears.

function Panel({ children }: { children: React.ReactNode }) {
  return <div className="w-80 rounded-md border border-border bg-popover p-3">{children}</div>;
}

const noop = () => {};

export function Checked() {
  return (
    <Panel>
      <SettingsCheck id="show-grid" label="Show grid lines" checked onChange={noop} />
    </Panel>
  );
}

export function Unchecked() {
  return (
    <Panel>
      <SettingsCheck id="show-legend" label="Show legend" checked={false} onChange={noop} />
    </Panel>
  );
}

// There is deliberately no "with hint" cell. Unlike SettingsRow, whose hint is
// a visible paragraph, SettingsCheck passes `hint` to the label's `title`
// attribute only — a native tooltip. It is invisible in a static capture and in
// any screenshot, so a cell for it would differ from Checked by label text
// alone.

export function Disabled() {
  return (
    <Panel>
      <SettingsCheck
        id="stack-series"
        label="Stack series"
        checked={false}
        disabled
        hint="Only available for bar charts with more than one series."
        onChange={noop}
      />
    </Panel>
  );
}

export function SeveralRows() {
  return (
    <Panel>
      <SettingsCheck id="grid" label="Show grid lines" checked onChange={noop} />
      <SettingsCheck id="legend" label="Show legend" checked={false} onChange={noop} />
      <SettingsCheck id="values" label="Label each point with its value" checked={false} onChange={noop} />
    </Panel>
  );
}
