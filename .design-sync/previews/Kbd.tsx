import { Card, Kbd } from 'colwrite-ui';

export function MenuFooter() {
  return (
    <div className="w-80 overflow-hidden rounded-lg border border-border bg-popover shadow-lg">
      <ul className="p-1">
        {['Heading 2', 'Bullet list', 'Equation block', 'Citation'].map((item, i) => (
          <li
            key={item}
            className={
              i === 0
                ? 'rounded-md bg-accent px-2 py-1.5 text-sm text-accent-foreground'
                : 'rounded-md px-2 py-1.5 text-sm'
            }
          >
            {item}
          </li>
        ))}
      </ul>
      <div className="flex items-center gap-3 border-t border-border bg-card/30 px-3 py-2 text-2xs text-muted-foreground">
        <span>
          <Kbd>↑↓</Kbd> Navigate
        </span>
        <span>
          <Kbd>↵</Kbd> Select
        </span>
        <span>
          <Kbd>Esc</Kbd> Close
        </span>
      </div>
    </div>
  );
}

export function ComposerHint() {
  return (
    <div className="w-full max-w-sm rounded-lg border border-border bg-card p-2">
      <div className="rounded-md border border-input bg-background px-3 py-2 text-sm text-muted-foreground">
        Ask about the draft, or reference a section with #
      </div>
      <div className="flex items-center gap-2 px-2 pb-1.5 pt-1.5">
        <p className="min-w-0 flex-1 text-2xs text-muted-foreground">
          <Kbd>Enter</Kbd> to send · <Kbd>Shift</Kbd>+<Kbd>Enter</Kbd> for a new line ·{' '}
          <Kbd>#</Kbd> to reference
        </p>
        <span className="shrink-0 text-2xs tabular-nums text-muted-foreground">128/4000</span>
      </div>
    </div>
  );
}

export function ShortcutList() {
  const rows = [
    { label: 'Show or hide the tools panel', keys: ['Ctrl', '\\'] },
    { label: 'Collapse or expand the sidebar', keys: ['Ctrl', 'Shift', '\\'] },
    { label: 'Show or hide the assistant', keys: ['Ctrl', 'J'] },
    { label: 'Save now', keys: ['Ctrl', 'S'] },
    { label: 'Show keyboard shortcuts', keys: ['Ctrl', '/'] },
  ];
  return (
    <Card className="w-full max-w-md p-4">
      <ul className="divide-y divide-border/50">
        {rows.map((row) => (
          <li key={row.label} className="flex items-center justify-between gap-4 py-2">
            <span className="min-w-0 text-sm">{row.label}</span>
            <span className="flex shrink-0 items-center gap-1">
              {row.keys.map((part) => (
                <Kbd key={part}>{part}</Kbd>
              ))}
            </span>
          </li>
        ))}
      </ul>
    </Card>
  );
}

export function KeycapWidths() {
  return (
    <div className="flex w-full max-w-sm flex-col gap-3 rounded-lg border border-border bg-card p-4">
      <p className="flex items-center gap-1 text-2xs text-muted-foreground">
        Single keys:
        <Kbd>#</Kbd>
        <Kbd>/</Kbd>
        <Kbd>S</Kbd>
        <Kbd>↵</Kbd>
        <Kbd>⌘</Kbd>
      </p>
      <p className="flex items-center gap-1 text-2xs text-muted-foreground">
        Named keys:
        <Kbd>Esc</Kbd>
        <Kbd>Shift</Kbd>
        <Kbd>Enter</Kbd>
        <Kbd>Ctrl</Kbd>
      </p>
      <p className="flex items-center gap-1 text-2xs text-muted-foreground">
        Chords are separate caps:
        <Kbd>Ctrl</Kbd>
        <Kbd>Shift</Kbd>
        <Kbd>\</Kbd>
      </p>
    </div>
  );
}
