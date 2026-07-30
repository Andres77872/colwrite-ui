---
category: Overlays
keywords: [shortcuts dialog, keyboard shortcuts, help, key reference, kbd, mod key]
---

# ShortcutsDialog

The app's keyboard-shortcut reference, reachable with `Mod+/`. Unlike the other
parts in this group it is a whole screen, not a piece: it renders its own
`Dialog` + `DialogContent` and fills them with the app's `SHORTCUTS` table, so
there is exactly one list of bindings and it cannot drift from the handler that
matches them.

## Usage

```jsx
const [showShortcuts, setShowShortcuts] = useState(false);

useAppShortcuts({ onHelp: () => setShowShortcuts(true) });

<ShortcutsDialog open={showShortcuts} onOpenChange={setShowShortcuts} />
```

Mount it once, at the shell level, and let `useAppShortcuts` open it. It is a
controlled component with no internal state and no trigger of its own — pair it
with a "Keyboard shortcuts" item in the help menu if you want a pointer path too.

## Props

| Prop | Meaning |
| --- | --- |
| `open` | Required. `false` renders nothing at all. |
| `onOpenChange` | Required. Called with `false` on Escape, on the corner close button, and on an outside click. Wire it to the same state setter. |

There is nothing else — no `children`, no `className`. The content is not
configurable on purpose: a second, hand-maintained shortcut list is how the
reference stops matching the app.

## What it renders

A `max-w-md` dialog, titled "Keyboard shortcuts", described as "Switch tools with
the arrow keys once the tools rail has focus." Under it, one row per entry in
`SHORTCUTS` — label on the left, keycaps on the right as `Kbd` elements, rows
separated by `divide-y divide-border/50`.

Every binding carries the platform modifier, rendered by `modifierLabel()`: `⌘`
on Apple platforms, `Ctrl` everywhere else. The document surface is
contenteditable from edge to edge, so a bare-key shortcut would type into the
document instead of firing — and `Mod+B`/`I`/`U` and `Mod+1`…`Mod+9` are
deliberately left to contenteditable and the browser.

## See also

`Dialog` / `DialogContent` (what it is built from) · `Kbd` (the keycaps) ·
`useAppShortcuts` and `SHORTCUTS` (the matching handler and the single source of
the bindings).
