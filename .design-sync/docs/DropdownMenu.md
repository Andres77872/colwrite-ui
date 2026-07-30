---
category: Overlays
keywords: [dropdown, menu, context menu, actions menu, overflow menu, popup, radix]
---

# DropdownMenu

The root of the menu compound, on Radix DropdownMenu. Every "⋯" overflow menu in
Colwrite is this: the document actions menu, the collection folder header, the
block gutter menus, the topbar account menu and the AI actions menu on the
floating toolbar. It renders no DOM of its own — it holds the open state and
wires the trigger to the content.

Reach for it when a control needs to offer **a list of actions**. For choosing a
value that stays on screen, or for anything with fields in it, use `Popover`; for
a decision that must be resolved before continuing, use `Dialog`.

## Usage

```jsx
<DropdownMenu>
  <DropdownMenuTrigger asChild>
    <Button variant="ghost" size="icon-sm" aria-label="Document actions">
      <MoreHorizontal />
    </Button>
  </DropdownMenuTrigger>
  <DropdownMenuContent align="end" className="w-56">
    <DropdownMenuItem onSelect={rename}>
      <Pencil /> Rename
    </DropdownMenuItem>
    <DropdownMenuItem onSelect={duplicate}>
      <Copy /> Duplicate
    </DropdownMenuItem>
    <DropdownMenuItem onSelect={exportLatex}>
      <FileDown /> Export as LaTeX
    </DropdownMenuItem>
    <DropdownMenuSeparator />
    <DropdownMenuItem
      className="text-destructive focus:text-destructive"
      onSelect={remove}
    >
      <Trash2 /> Delete document
    </DropdownMenuItem>
  </DropdownMenuContent>
</DropdownMenu>
```

## The parts

| Part | Role |
| --- | --- |
| `DropdownMenu` | Root. Holds open state; renders no element. |
| `DropdownMenuTrigger` | The control that opens it. `asChild` to wrap a `Button`. |
| `DropdownMenuContent` | The menu panel. Brings its own portal — you never write one for it. |
| `DropdownMenuItem` | An action row. `inset`, `disabled`, `onSelect`. |
| `DropdownMenuLabel` | A non-interactive caption for a section. |
| `DropdownMenuSeparator` | A 1px rule between sections. |
| `DropdownMenuGroup` | `role="group"` wrapper — semantics for a labelled section. |
| `DropdownMenuSub` | Nesting root for one submenu, with its own open state. |
| `DropdownMenuSubTrigger` | The item that opens a submenu. Add your own `ChevronRight`. |
| `DropdownMenuSubContent` | The submenu panel. Not portalled by default — wrap it in `DropdownMenuPortal` if you need it out of the parent's DOM. |
| `DropdownMenuRadioGroup` | Value-scoped group for a single-choice section. |
| `DropdownMenuPortal` | Explicit portal target, mainly for `DropdownMenuSubContent`. |

Radix's `CheckboxItem` and `RadioItem` are **not** re-exported by this DS. Draw a
selected row as an `inset` item with an absolutely positioned `Check` — see
`DropdownMenuRadioGroup`.

## Props

| Prop | Type | Notes |
| --- | --- | --- |
| `open` | `boolean` | Controlled open state. |
| `defaultOpen` | `boolean` | Uncontrolled initial state. |
| `onOpenChange` | `(open: boolean) => void` | Fires on trigger click, Escape, outside press and item select. Filtered out of the emitted `.d.ts` — it exists. |
| `modal` | `boolean` | Default `true`. |
| `dir` | `'ltr' \| 'rtl'` | Inherited from `DirectionProvider` when unset. |

Uncontrolled is the default in the app; go controlled when a component owns
several menus and only one may be open — the block gutter keeps a single
`'add' \| 'options' \| null` state and passes `open={which === 'add'}` so
opening one closes the other.

## Notes

- **`modal` defaults to `true`**, which locks body scroll and sets
  `pointer-events: none` on the body while the menu is open. That is right for a
  full-page menu and wrong inside another overlay — pass `modal={false}` for a
  menu opened from a `Dialog`, `Sheet` or a scroll container that must keep
  scrolling.
- A **closed menu renders nothing at all** — no hidden DOM. Nothing inside
  `DropdownMenuContent` is mounted until it opens, so an item's side effects and
  measurements only run while open.
- The panel portals to `document.body` at `z-[var(--z-dropdown)]`, so it is never
  clipped by a panel's `overflow`, and it sits under `Dialog`/`Sheet` overlays by
  design.
- Keyboard is Radix's: Enter/Space/ArrowDown to open, arrows to move, typeahead
  jumps by first letters (`textValue` on an item overrides what is matched),
  ArrowRight/ArrowLeft into and out of a submenu, Escape closes and returns focus
  to the trigger.
- Enter and exit animate opacity and scale, sliding 8px from the trigger's side.

## See also

`DropdownMenuTrigger` · `DropdownMenuContent` · `DropdownMenuItem` ·
`DropdownMenuLabel` · `DropdownMenuSeparator` · `DropdownMenuGroup` ·
`DropdownMenuSub` · `DropdownMenuSubTrigger` · `DropdownMenuSubContent` ·
`DropdownMenuRadioGroup` · `DropdownMenuPortal` · `Popover` · `Dialog`
