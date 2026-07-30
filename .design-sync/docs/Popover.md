---
category: Overlays
keywords: [popover, floating panel, anchored, dropdown panel, inline editor, radix]
---

# Popover

The root of the anchored floating panel, on Radix Popover. Use it when a control
needs to open a small **interactive** surface next to itself — a citation
picker, a filters panel, export options, the settings panel for an inline
widget. It is the overlay Colwrite's editor uses most: every inline widget
(citation, equation, table, figure) edits through one.

`Popover` renders no DOM of its own. It is state plus context for
`PopoverTrigger`, `PopoverContent` and the optional `PopoverAnchor`.

## Usage

```jsx
const [open, setOpen] = useState(false);

<Popover open={open} onOpenChange={setOpen}>
  <PopoverTrigger asChild>
    <Button variant="ghost" size="sm">
      <Quote />
      Cite
    </Button>
  </PopoverTrigger>
  <PopoverContent align="start" className="w-80 p-3">
    <Input defaultValue={query} />
    <ReferenceList onPick={() => setOpen(false)} />
  </PopoverContent>
</Popover>
```

Uncontrolled is fine when nothing inside needs to dismiss it:

```jsx
<Popover>
  <PopoverTrigger asChild><Button variant="ghost" size="icon-sm"><Settings2 /></Button></PopoverTrigger>
  <PopoverContent className="w-80 p-3">…</PopoverContent>
</Popover>
```

## Props

| Prop | Notes |
| --- | --- |
| `open` | Controlled open state. Nothing renders when it is `false` — there is no hidden DOM to style. |
| `defaultOpen` | Uncontrolled initial state. |
| `onOpenChange(open)` | Fires on trigger click, outside click, and Escape. **Absent from the emitted `Popover.d.ts`** — handler props are filtered out of the generated contract, but it exists and you need it whenever you pass `open`. |
| `modal` | Defaults to `false`. `true` adds a focus trap and marks the rest of the page inert. Leave it false: a popover in the editor must not steal the caret. |

## The parts

| Part | Role |
| --- | --- |
| `Popover` | Root. State + context; renders nothing. |
| `PopoverTrigger` | The control that toggles it, and the default positioning reference. |
| `PopoverContent` | The panel. Renders its own portal to `document.body`. |
| `PopoverAnchor` | Optional. Moves the positioning reference off the trigger. |

## Notes

- `PopoverContent` portals out of the trigger's subtree, which is what keeps a
  panel opened from inside an `overflow-x-auto` table wrapper or a scrolling
  canvas from being clipped.
- `z-[var(--z-popover)]` = 300 — above dropdowns (50) and modals (250), below
  toasts (350) and tooltips (400).
- If the trigger sits inside a `contenteditable` region, pass
  `onOpenAutoFocus={(e) => e.preventDefault()}` on `PopoverContent` so Radix
  leaves the caret in the document, and stop the editor from seeing the panel's
  events. That is exactly what the editor's `InlinePopover` wrapper does.

## Choosing an overlay

| Reach for | When |
| --- | --- |
| `Tooltip` | Naming a control. Text only, no controls inside, hover/focus only. |
| `Popover` | A small **interactive** panel anchored to a control: fields, checkboxes, a search list. |
| `DropdownMenu` | A list of **commands**, with menu keyboard semantics (typeahead, arrow keys, `role="menu"`). |
| `Dialog` | A decision or a form that must be resolved before continuing — centred, modal. |
| `Sheet` | An edge-anchored panel of navigation or tools, mostly on narrow viewports. |

See `PopoverTrigger`, `PopoverContent`, `PopoverAnchor`.
