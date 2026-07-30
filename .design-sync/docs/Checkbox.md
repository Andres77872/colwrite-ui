---
category: Forms
keywords: [checkbox, check, toggle, tick box, multi-select, include, indeterminate]
---

# Checkbox

A single on/off choice, on Radix Checkbox. Use it for independent options that
can each be on or off — "Open-access papers only", "Show caption", "Number this
equation", "Include in export".

Use radio-style controls (a `DropdownMenuRadioGroup`) when the options are
mutually exclusive, and `Tabs` when the choice switches a view rather than
setting a value.

It renders a `<button role="checkbox">`, not an `<input type="checkbox">`. Two
consequences: the change handler is `onCheckedChange`, not `onChange`; and it
carries no `name`/`value` for native form submission — read the state from React.

## Usage

Explicit association, as `InlineShell` writes it (preferred):

```jsx
<label htmlFor={id} className="flex cursor-pointer items-center gap-2 text-sm">
  <Checkbox
    id={id}
    checked={checked}
    disabled={disabled}
    onCheckedChange={(value) => onChange(value === true)}
  />
  Show caption
</label>
```

Wrapping label with an explicit name, as the Semantic Scholar filters do:

```jsx
<label className="flex cursor-pointer items-center gap-2 text-xs">
  <Checkbox
    checked={openAccessOnly}
    onCheckedChange={(checked) => setOpenAccessOnly(checked === true)}
    aria-label="Open-access papers only"
  />
  Open-access papers only
</label>
```

## Props that matter

| Prop | Notes |
| --- | --- |
| `checked` | `true` \| `false` \| `"indeterminate"`. Controlled. |
| `defaultChecked` | Uncontrolled initial state. |
| `onCheckedChange` | `(checked: boolean \| "indeterminate") => void`. **Always narrow it** — `checked === true` — or `"indeterminate"` leaks into your boolean state. |
| `disabled` | `cursor-not-allowed` + 50% opacity on the box; style the label row to match. |
| `required` | Sets `aria-required`; there is no native form validation behind it. |
| `id` | Pair with the label's `htmlFor`. |
| `name`, `value` | Accepted by Radix for a hidden native input, but the app reads state from React. |
| `className` | Merged last — how the invalid border is applied. |

## States

| State | How it renders |
| --- | --- |
| Unchecked | 16px box, `border-primary`, transparent fill |
| Checked | `bg-primary` with a `primary-foreground` check glyph |
| Indeterminate | shows the same check glyph but **keeps the unfilled box** — the fill is keyed to `data-[state=checked]` only, and there is no minus glyph. Distinguishable, but weaker than checked; do not rely on it alone to mean "some selected" without a label that says so. |
| Disabled | 50% opacity, no pointer events |
| Focus-visible | 2px `ring-ring` with a 2px offset |

## Accessibility

- The control has no built-in label. Give it one of:
  `<label htmlFor>` + matching `id` (best — the label text is clickable and
  announced), or `aria-label` when the visible text is supplied some other way.
  A wrapping `<label>` also works because the rendered element is a `<button>`,
  but the explicit pairing is what the app standardised on.
- Space toggles. Enter does **not** — that is the checkbox pattern, not a bug.
- For a group, wrap in `<fieldset>` with a `<legend>` ("Include in export") so
  the options are announced as one set.
- Invalid: put `aria-invalid` and `aria-describedby` on the control(s) — or
  `aria-describedby` on the `fieldset` for a group rule — tint with
  `className="border-destructive"`, and write the message as the app's error
  line:

  ```jsx
  <p id={errId} role="alert" className="flex items-start gap-1.5 text-xs text-destructive">
    <AlertCircle aria-hidden="true" className="mt-px h-3.5 w-3.5 shrink-0" />
    <span className="min-w-0 break-words">Select at least one section to export.</span>
  </p>
  ```

## Layout notes

- The box is a fixed 16px with `shrink-0`; do not resize it — the check glyph is
  16px and will not scale with it.
- Row recipe: `flex items-center gap-2` with `cursor-pointer`, and
  `cursor-not-allowed opacity-50` on the whole row when disabled, so the label
  dims with the box.
- Stack rows with `gap-2.5`; anything tighter puts the 2px focus ring of one row
  on top of its neighbour.
