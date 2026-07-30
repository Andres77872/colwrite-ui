---
category: Content
keywords: [empty state, placeholder, nothing here, zero state, no results]
---

# EmptyState

The single "nothing here yet" treatment. Every panel used to hand-roll this with
a decorative emoji, which read inconsistently and was announced as meaningless
text by screen readers. The icon here is presentational and hidden from the
accessibility tree — the title and description carry the meaning.

Use `Alert` instead when something is *wrong*; `EmptyState` is for a container
that is legitimately empty.

## Usage

```jsx
<EmptyState
  icon={MessageSquare}
  title="No chats yet"
  description="Start a conversation to keep a history of your assistant sessions."
/>

<EmptyState
  size="page"
  icon={FileText}
  title="No documents yet"
  description="Create one to start writing."
  action={<Button size="sm"><Plus />New document</Button>}
/>
```

## Props

- `title` (required) — a short noun phrase naming what is missing.
- `description` — one sentence on how to fill it. `ReactNode`, so it can
  interpolate a search term.
- `icon` — a `lucide-react` component (passed, not rendered: `icon={FileText}`).
  Presentational and `aria-hidden`.
- `size` — `panel` (default) suits narrow side panels; `page` suits the main
  canvas and adds vertical breathing room.
- `action` — an optional node, normally a small `Button`.

## Writing the copy

Titles state the absence ("No files yet", "No matches"). Descriptions say what
would put something there ("PDFs you upload are kept with your account."), not
what the system did. For a search miss, name the query in the description rather
than the title.

## Layout

The component centres itself and provides its own padding; it does not draw a
border or background. Put it inside the panel or card surface that owns those —
it stretches to the width it is given, and `className="h-full"` makes it fill a
panel vertically.
