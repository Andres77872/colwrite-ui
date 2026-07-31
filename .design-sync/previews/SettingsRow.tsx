import { Input, SettingsRow } from 'colwrite-ui';

// SettingsRow is one labelled row inside an inline widget's settings popover:
// an uppercase caption, the control, and an optional hint under it.
//
// The `htmlFor` distinction is the whole point of the component and is not
// cosmetic. WITH htmlFor the caption is a real <label> bound to one control.
// WITHOUT it the row wraps several controls (or none) and becomes a named
// group instead — role="group" + aria-labelledby — because a <label> pointing
// at nothing associates with nothing.
//
// Rendered here on the popover's own surface (w-80 p-3) so the spacing reads
// the way it does in the product.

function Panel({ children }: { children: React.ReactNode }) {
  return <div className="w-80 rounded-md border border-border bg-popover p-3">{children}</div>;
}

export function LabelledControl() {
  return (
    <Panel>
      <SettingsRow label="Caption" htmlFor="figure-caption">
        <Input id="figure-caption" defaultValue="Loss vs. compute at matched wall-clock" />
      </SettingsRow>
    </Panel>
  );
}

export function WithHint() {
  return (
    <Panel>
      <SettingsRow
        label="Citation key"
        htmlFor="citation-key"
        hint="Must match an entry in the bibliography — unresolved keys render in the error tone."
      >
        <Input id="citation-key" defaultValue="hoffmann2022" />
      </SettingsRow>
    </Panel>
  );
}

export function AsAGroup() {
  return (
    <Panel>
      <SettingsRow label="Axis labels" hint="Left blank, the axes are drawn without titles.">
        <div className="flex gap-2">
          <Input aria-label="X axis" placeholder="X — compute (FLOPs)" />
          <Input aria-label="Y axis" placeholder="Y — loss" />
        </div>
      </SettingsRow>
    </Panel>
  );
}

export function StackedRows() {
  return (
    <Panel>
      <SettingsRow label="Caption" htmlFor="stacked-caption">
        <Input id="stacked-caption" defaultValue="Table 2 — matched-budget results" />
      </SettingsRow>
      <SettingsRow label="Columns" htmlFor="stacked-columns">
        <Input id="stacked-columns" defaultValue="4" />
      </SettingsRow>
    </Panel>
  );
}
