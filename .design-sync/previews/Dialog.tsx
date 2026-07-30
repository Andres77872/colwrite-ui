import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Kbd,
} from 'colwrite-ui';

// `open` is forced on: the closed state renders nothing, and the point of the
// card is the open panel. DialogContent brings its own overlay (fixed inset-0),
// so this component is card-mode "single" in .design-sync/config.json.

export function Confirm() {
  return (
    <Dialog open>
      <DialogContent showCloseButton={false}>
        <DialogHeader>
          <DialogTitle>Discard this draft?</DialogTitle>
          <DialogDescription>
            The section and its four blocks will be removed. This cannot be undone.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter className="mt-6">
          <Button variant="ghost">Keep editing</Button>
          <Button variant="destructive">Discard draft</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function ShortcutReference() {
  const rows = [
    { label: 'Command palette', keys: ['Ctrl', 'K'] },
    { label: 'Save document', keys: ['Ctrl', 'S'] },
    { label: 'Toggle assistant', keys: ['Ctrl', 'J'] },
    { label: 'Keyboard shortcuts', keys: ['Ctrl', '/'] },
  ];
  return (
    <Dialog open>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Keyboard shortcuts</DialogTitle>
          <DialogDescription>
            Switch tools with the arrow keys once the tools rail has focus.
          </DialogDescription>
        </DialogHeader>
        <ul className="mt-4 divide-y divide-border/50">
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
      </DialogContent>
    </Dialog>
  );
}

export function WithForm() {
  return (
    <Dialog open>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Rename document</DialogTitle>
          <DialogDescription>
            Shown in the documents menu and used for the export filename.
          </DialogDescription>
        </DialogHeader>
        <div className="mt-4">
          <label className="mb-1.5 block text-xs font-medium text-muted-foreground" htmlFor="ds-doc-title">
            Title
          </label>
          <input
            id="ds-doc-title"
            className="flex h-9 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            defaultValue="Attention Is All You Need, Revisited"
          />
        </div>
        <DialogFooter className="mt-6">
          <Button variant="ghost">Cancel</Button>
          <Button>Save title</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
