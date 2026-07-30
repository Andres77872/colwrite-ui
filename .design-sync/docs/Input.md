---
category: Forms
keywords: [input, text field, search, form control, textbox, password, number]
---

# Input

The single-line text field. Every typed value in Colwrite goes through it — the
document title, profile fields, folder names, the search boxes over arXiv,
Semantic Scholar and your own PDFs. There are no bare `<input>` elements in the
app; adding one means re-deriving the border, focus ring, disabled treatment and
placeholder colour this already has.

Use `Textarea` instead as soon as the value can contain a newline (an abstract,
a description, a prompt, JSON).

## Usage

```jsx
<label className="flex flex-col gap-1.5">
  <span className="text-sm text-muted-foreground">Display name</span>
  <Input defaultValue={profile.display_name} maxLength={120} onChange={…} />
</label>
```

Search row, as `panels/shared/SearchForm` writes it:

```jsx
<div className="relative flex-1">
  <Search aria-hidden="true" className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
  <Input type="search" className="pl-8" placeholder="Search arXiv…" aria-label="Search arXiv" value={query} onChange={…} />
</div>
```

## Props

**The emitted `InputProps` shows only `className` / `id` / `style` — that is an
artefact of the type extraction, not the real contract.** `InputProps` is
`React.InputHTMLAttributes<HTMLInputElement>`: **every standard `<input>`
attribute passes straight through to the DOM node.** The ones that matter here:

| Prop | Notes |
| --- | --- |
| `type` | `text` (default), `search`, `password`, `number`, `email`, `url`, `file`. |
| `value` + `onChange` | Controlled — the app's default. |
| `defaultValue` | Uncontrolled; what the document-title field uses so typing does not fight a re-render. |
| `placeholder` | Renders in `text-muted-foreground`. Not a label. |
| `disabled` | `cursor-not-allowed` + 50% opacity. |
| `readOnly` | Value is selectable but not editable; **no** visual change — add your own if it must read as locked. |
| `required`, `maxLength`, `min`, `max`, `step`, `pattern` | Native validation and limits. The app pairs `maxLength` with a visible counter. |
| `autoComplete`, `autoFocus`, `spellCheck`, `inputMode` | Pass through. |
| `aria-label`, `aria-invalid`, `aria-describedby` | See below. |
| `ref` | Forwarded to the `<input>` (the app focuses and `select()`s it). |

`className` is merged last, so a utility there wins over the base class.

## Sizes

One built-in height: `h-9` (36px) at `text-sm` (13px). The compact panel size is
a className, not a variant: `className="h-8 text-xs"` — used by every control
inside a 320px tool panel. The document title uses
`className="h-8 max-w-sm text-xl font-semibold"` so the field matches the
heading it replaces.

## Accessibility

- **Every input needs a name.** Either wrap it in a `<label>` with visible text
  (the app's `flex flex-col gap-1.5` pattern), or pass `aria-label` when the
  placeholder is the only affordance — the search boxes do the latter and keep
  the label string in sync with the placeholder, so the announced name and the
  visible hint cannot describe two different searches.
- Placeholders are not labels: they disappear on focus and fail contrast as a
  name.
- Invalid: set `aria-invalid`, point `aria-describedby` at the message's `id`,
  and tint the border with `className="border-destructive/60"`. Without
  `aria-describedby` the reason sits in an unassociated paragraph and is never
  read out with the field.
- The error line the app writes:

  ```jsx
  <p id={errId} role="alert" className="flex items-start gap-1.5 text-xs text-destructive">
    <AlertCircle aria-hidden="true" className="mt-px h-3.5 w-3.5 shrink-0" />
    <span className="min-w-0 break-words">That does not match the folder name yet.</span>
  </p>
  ```

- Do not disable an input while a request is in flight if the user might still
  be refining what they typed — the search boxes stay enabled on purpose and let
  the submit `Button` guard re-entry.

## Composition

- Leading icon: wrap in `relative`, absolutely position the icon at
  `left-2 top-1/2 -translate-y-1/2` with `pointer-events-none`, and pad the field
  (`pl-8` at `h-9`, `pl-7` at `h-8`).
- Trailing controls (a `Button`, a native `select`) go in a `flex items-center
  gap-2` row beside the field, not inside it.
- The field is `w-full` by default — it fills whatever column you give it. Cap
  the column (`max-w-sm`), not the input.
- Focus is a 2px `ring-ring` with a 1px offset; do not add a second outline.
