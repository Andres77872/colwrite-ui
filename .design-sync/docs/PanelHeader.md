---
category: Layout
keywords: [panel header, title bar, section header, panel title, docked panel, toolbar]
---

# PanelHeader

The title bar every docked panel shares: a fixed 44px row with an optional icon,
a truncating title, an optional action cluster on the right, and a hairline
underneath. The sidebar, the tools aside and any future panel keep identical
height and rhythm because they all use this.

## Usage

```jsx
<div className="flex h-full flex-col overflow-hidden">
  <PanelHeader
    title="Library"
    icon={<Library aria-hidden="true" className="h-4 w-4" />}
    actions={
      <Button variant="ghost" size="icon-sm" onClick={close} aria-label="Close Library">
        <X aria-hidden="true" className="h-4 w-4" />
      </Button>
    }
  />
  <div className="min-h-0 flex-1 overflow-y-auto p-3">
    <Panel />
  </div>
</div>
```

## Props

- `title` (required) — a short noun phrase, rendered as an `<h2>`. It **truncates**
  rather than wrapping, which is what keeps the header exactly 44px however long
  the panel's name is.
- `icon` — a **rendered node**, not a component reference:
  `icon={<Library className="h-4 w-4" />}`, not `icon={Library}`. (This is the
  opposite of `EmptyState`/`Alert`, which take the component.) Size it `h-4 w-4`
  and mark it `aria-hidden` — the header colours it `text-primary/70`.
- `actions` — a node placed at the right end, inside a
  `flex items-center gap-0.5` cluster. Normally one to three `Button`s at
  `size="icon-sm"` (28px) or one `size="xs"` text button plus a close.
- `className` — merged onto the row.

Both `icon` and `actions` are omitted cleanly: with no icon the title starts at
the 12px inset, with no actions the row is title-only.

## Layout contract

The header is `h-11 flex-shrink-0` with `border-b border-border/50` and `px-3`.
It draws **no background** — it sits on whatever surface the panel supplies
(`bg-card` in the shell).

It is designed as the first child of a flex column:

```jsx
<div className="flex h-full flex-col overflow-hidden">
  <PanelHeader … />
  <div className="min-h-0 flex-1 overflow-y-auto">…</div>
</div>
```

`min-h-0` on the body is what makes the body scroll instead of the whole panel —
without it the flex child refuses to shrink below its content and the header
scrolls away with it.

## Accessibility

The title is a real `<h2>`, so panels appear in the document outline and a screen
reader can jump between them. Keep one `PanelHeader` per panel — a second `<h2>`
in the body should be an `<h3>` written by hand.

Every icon-only action needs an `aria-label` naming the panel, not just the verb:
`aria-label="Close Library"` rather than `"Close"`, since several panels can be
open at once.

## When not to use it

- For a **section inside** a panel body, write a plain heading; a second 44px bar
  reads as a second panel.
- For a **dialog**, use `DialogHeader` / `DialogTitle`.
- For the **app's** top bar, use `Topbar`. `PanelHeader` is for docked regions.
