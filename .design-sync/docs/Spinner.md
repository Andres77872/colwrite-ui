---
category: Feedback
keywords: [spinner, loading, busy, progress, loader, in flight, pending]
---

# Spinner

One busy indicator for the whole app: a `lucide-react` `Loader2` with
`animate-spin`. It is a bare 14px glyph with no wrapper, no label and no
background — whatever it sits next to supplies those.

Use it when **an action is in flight and the layout should not move**: inside a
button that was just pressed, before a short status line, or centred in a region
that is fetching. Use `Skeleton` instead when a *list or card* is loading and you
know its shape.

## Usage

```jsx
// Inside the button that triggered the work
<Button onClick={save} disabled={busy}>
  {busy ? <Spinner /> : <Save className="h-3.5 w-3.5" />}
  Save
</Button>

// Inline before a status line
<div aria-busy="true">
  <p className="flex items-center gap-2 text-sm text-muted-foreground">
    <Spinner />
    Preparing your workspace…
  </p>
</div>

// A slightly larger one for a whole panel body
<Spinner className="h-4 w-4" />
```

## Props

`Spinner` takes **`className` only**. There is no `size` prop and no colour
prop — both come from utilities:

| className | Where the app uses it |
| --- | --- |
| *(none)* | The default `h-3.5 w-3.5` (14px): buttons, inline labels. |
| `h-3 w-3` | Agent activity rows and other 11px contexts. |
| `h-4 w-4` | A panel body waiting on a request. |
| `h-5 w-5` | The full-page session check. |

The glyph is `currentColor`, so it inherits the text colour of whatever contains
it — `text-muted-foreground` next to muted copy, `text-primary-foreground`
inside a filled button. Do not add a colour to the spinner itself; set it on the
line of text or the button and let it inherit.

## Accessibility

The spinner is `aria-hidden="true"` on purpose. A spinning glyph with no name is
noise to a screen reader, and it is **always paired with visible text**, which is
what should be announced. Two rules follow:

- Never render a `Spinner` as the only content of a control. An icon-only button
  in a busy state still needs its `aria-label`.
- Put `aria-busy="true"` on the region that is loading (the `<ul>`, the panel
  body, the form), so assistive tech knows the content is not final. The spinner
  does not do this for you.

## Composition

- Inside a `Button`, the button's own `[&_svg]:size-4` sizing and 8px gap apply,
  so `<Spinner />` before a label needs no extra classes. Swap it in for the
  button's normal leading icon rather than adding it alongside.
- Pair it with a label that names the operation in the present continuous —
  "Saving…", "Uploading…", "Extracting text from attention-2017.pdf…" — not a
  bare "Loading".
- Centre it in a region with `flex items-center justify-center` plus the label;
  a spinner alone in a large empty panel reads as a broken page.
