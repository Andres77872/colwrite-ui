---
category: Forms
keywords: [textarea, multiline, text area, description, abstract, prompt, code editor]
---

# Textarea

The multi-line text field. Use it the moment a value can legitimately contain a
newline: an abstract, a folder description, a profile bio, an assistant prompt,
the raw document JSON. Use `Input` for anything that must stay on one line.

It shares `Input`'s surface — `border-input`, `bg-background`, `rounded-md`,
`text-sm`, the same 2px `ring-ring` focus — so the two stack in one form without
looking like different controls.

## Usage

```jsx
<label className="flex flex-col gap-1.5">
  <span className="text-sm text-muted-foreground">About</span>
  <Textarea
    rows={4}
    maxLength={1000}
    placeholder="What you are working on."
    value={bio}
    onChange={(event) => set('bio', event.target.value)}
  />
  <span className="text-2xs text-muted-foreground">{bio.length}/1000</span>
</label>
```

The JSON editor treatment, from `JsonPanel`:

```jsx
<Textarea
  className={cn(
    'min-h-32 flex-1 resize-none border-muted bg-muted/30 font-mono text-xs focus:bg-background',
    parseError && 'border-destructive/60',
  )}
  value={text}
  spellCheck={false}
  aria-label="Document JSON"
  aria-invalid={parseError !== null}
  aria-describedby={parseError ? parseErrorId : undefined}
/>
```

## Props

**The emitted `TextareaProps` shows only `className` / `id` / `style` — that is
an artefact of the type extraction, not the real contract.** `TextareaProps` is
`React.TextareaHTMLAttributes<HTMLTextAreaElement>`: **every standard
`<textarea>` attribute passes straight through.** The ones that matter here:

| Prop | Notes |
| --- | --- |
| `rows` | The app's usual sizing lever — `2` for a prompt, `4`–`5` for prose. Combines with the base `min-h-[80px]` floor. |
| `value` + `onChange` / `defaultValue` | Controlled or uncontrolled, same as `Input`. |
| `placeholder` | `text-muted-foreground`. Not a label. |
| `disabled` | `cursor-not-allowed` + 50% opacity. |
| `readOnly` | No visual change — add your own if it must read as locked. |
| `maxLength` | Always pair with a visible counter; a field that silently stops accepting characters reads as broken. |
| `spellCheck={false}` | Required for code/JSON, otherwise every identifier is underlined. |
| `wrap`, `autoFocus`, `required`, `name`, `onKeyDown` | Pass through. `onKeyDown` is how the app wires Ctrl/Cmd+Enter to submit. |
| `aria-label`, `aria-invalid`, `aria-describedby` | See below. |
| `ref` | Forwarded to the `<textarea>`. |

## Sizing and resize

- Base floor is `min-h-[80px]` and `w-full`. `rows` raises the floor; a taller
  explicit floor is a className (`min-h-32`).
- The browser's resize grip is **on** by default. Turn it off with
  `resize-none` wherever the field is inside a fixed layout (the JSON panel does
  this, and stretches with `flex-1` instead).
- There is no auto-grow. If the field must follow its content, do it in the
  consumer.

## Accessibility

- Name it: a `<label>` with visible text, or `aria-label` when the field has no
  visible label (`aria-label="Document JSON"`).
- Invalid: `aria-invalid` on the field, `aria-describedby` pointing at the error
  paragraph's `id`, and `className="border-destructive/60"`. The `aria-invalid`
  alone says the field is wrong; without `aria-describedby` the reason sits in an
  unassociated paragraph and is never read out with the field.
- The error line the app writes:

  ```jsx
  <p id={parseErrorId} role="alert" className="flex items-start gap-1.5 text-xs text-destructive">
    <AlertCircle aria-hidden="true" className="mt-px h-3.5 w-3.5 shrink-0" />
    <span className="min-w-0 break-words">{parseError}</span>
  </p>
  ```

- Clear the error as the user types, not only on re-submit — that is what
  `JsonPanel` does, and it keeps `aria-invalid` honest.
- A character counter should be a sibling `<span>` inside the same `<label>`, or
  associated via `aria-describedby`; a floating count is invisible to a screen
  reader.

## Composition

- Label above, field, then counter or error below — the app's `flex flex-col
  gap-1.5` column. Keep the error and the counter in the same slot so the form
  does not jump when a message appears.
- The mono editor variant is `border-muted bg-muted/30 font-mono text-xs` with
  `focus:bg-background`: the field reads as a quiet code surface until focused.
- The field is `w-full`; cap the surrounding column, not the textarea.
