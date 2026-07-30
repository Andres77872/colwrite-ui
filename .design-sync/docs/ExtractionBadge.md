---
category: Feedback
keywords: [extraction, status badge, pdf, upload state, ready, failed, unsupported, resource]
---

# ExtractionBadge

Whether the assistant can read an uploaded file yet. One small pill carrying an
icon and a one- or two-word label, driven entirely by the file's
`extraction_status`.

Both the library panel and the profile dashboard list uploads, and a file that
read "Failed" in one place and "Not ready" in the other was two bugs to a user
reporting it. This is the single vocabulary.

## Usage

```jsx
// Inside a row button — no `describe`, or the hint joins the row's name
<ExtractionBadge status={resource.extraction_status} error={resource.extraction_error} />

// Standing on its own — turn the hint on
<ExtractionBadge status={upload.extraction_status} error={upload.extraction_error} describe />
```

## The vocabulary

`describeExtraction(status)` is the shared source of these and is exported
alongside the badge — use it when you need the same wording in prose (the
resource detail view prints `hint` as an `Alert`).

| status | label | variant | hint |
| --- | --- | --- | --- |
| `ready` | Ready | success | The assistant can read and quote this file. |
| `running` | Converting | info | Being converted to text. This takes longer for a long paper. *(icon spins)* |
| `pending` | Queued | secondary | Waiting to be converted to text. |
| `failed` | Failed | warning | Conversion did not finish. Retrying usually works. |
| `unsupported` | No text | destructive | No text layer to read — usually a scan. Retrying will not help. |
| `null` | Unknown | secondary | The conversion state could not be read. |

The wording is deliberately about **consequence** — whether the assistant can read
the file — not about the pipeline stage, which a writer has no reason to model.
Note the colour choice: `failed` is *warning* because a retry usually fixes it,
while `unsupported` is *destructive* because it will not.

`describeExtraction` also returns `settling` (whether the client should keep
polling — true for `pending` and `running`) and `retry`
(`'none' | 'automatic' | 'force'`), which is what decides whether a row shows a
Retry button and whether that retry needs forcing.

## Props

- `status` (required) — `'pending' | 'running' | 'ready' | 'failed' | 'unsupported' | null`.
  Pass the API value straight through, including `null`; there is no "loading"
  state to special-case.
- `error` — the provider's own error text. It is **not** rendered inline: it is
  upstream text of unbounded length that belongs to one file, not to the list, so
  it is appended to the badge's `title` (`"<hint> — <error>"`). Print it in full
  in a detail view.
- `describe` — off by default. `true` appends the hint to the accessible name via
  an `sr-only` span. Turn it on wherever the badge **stands on its own**, so the
  explanation is not trapped in a mouse-only `title`. Leave it off when the badge
  sits *inside* a row button — "paper.pdf, Ready, the assistant can read and quote
  this file, 1.2 MB" is worse than the label alone.
- `className` — merged onto the badge.

## Composition

The badge is a `<span>` styled with `badgeVariants`, **not** a `<Badge>` (which is
a `<div>`). That is deliberate and load-bearing: it sits inside `<p>` and `<span>`
in the list rows and the dashboard, and flow content there is not merely invalid —
the parser closes the paragraph early and the row falls apart. Keep it inline.

Its natural home is the meta line under a filename, beside the size and page
count:

```jsx
<p className="mt-1 flex flex-wrap items-center gap-x-1.5 gap-y-1 text-2xs text-muted-foreground">
  <ExtractionBadge status={upload.extraction_status} error={upload.extraction_error} describe />
  <span>2.1 MB · 15 pages · attached to Scaling notes</span>
</p>
```

The pill is compact by design (`px-1.5 py-0 text-2xs`) so it fits a 380px panel.
Do not scale it up to match a heading; put it on the meta line instead.
