import { InlineSettings, Input, SettingsCheck, SettingsRow } from 'colwrite-ui';

// InlineSettings is the gear button a block-level widget opens its settings
// from — an InlinePopover with the icon trigger and the w-80 panel already
// supplied, so a widget passes only rows. Radix portals the panel out of the
// paragraph, which is what fixed the long-standing clipping: the hand-rolled
// absolute panels were children of an overflow-x-auto table wrapper and were
// simply cut off near an edge.
//
// CAPTURE NOTE: like InlinePopover, `open` is internal with no prop to force
// it, so these cards show the trigger at rest. In the product this button lives
// in InlineFigureShell's header, which is itself hover-revealed — so it is
// shown here on a plain bar instead, where it is actually visible.

const noop = () => {};

function Bar({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex w-[22rem] items-center gap-1 rounded-md border border-border/60 bg-muted/40 px-2 py-1">
      <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </span>
      <span className="ml-auto flex items-center gap-0.5">{children}</span>
    </div>
  );
}

export function TableSettings() {
  return (
    <Bar label="Table">
      <InlineSettings label="Table settings">
        <SettingsRow label="Header row">
          <SettingsCheck
            id="inline-settings-header"
            label="Treat the first row as column headings"
            checked
            onChange={noop}
          />
        </SettingsRow>
        <SettingsRow label="Caption" htmlFor="inline-settings-caption">
          <Input id="inline-settings-caption" defaultValue="Table 2 — matched-budget results" />
        </SettingsRow>
      </InlineSettings>
    </Bar>
  );
}

export function FigureSettings() {
  return (
    <Bar label="Figure">
      <InlineSettings label="Figure settings" align="end">
        <SettingsRow label="Chart type" htmlFor="inline-settings-kind">
          <Input id="inline-settings-kind" defaultValue="line" />
        </SettingsRow>
        <SettingsCheck id="inline-settings-grid" label="Show grid lines" checked onChange={noop} />
      </InlineSettings>
    </Bar>
  );
}

// There is deliberately no bare, unhosted cell: the closed trigger is a 14px
// icon button, so on its own it is an all-but-empty card (it is what tripped
// [RENDER_BLANK] on the floor card). Both cells above host it on the widget bar
// where it actually lives.
