---
category: App shell
keywords: [topbar, header, app bar, account menu, brand, navigation]
---

# Topbar

The application header: brand lockup on the left, account menu on the right, plus
the two drawer triggers that only exist below `md` (open navigation, show tools).
Designed to sit in `AppShell`'s `header` slot.

## Usage

```jsx
<AppShell header={<Topbar />} main={<Canvas />} />
```

It takes **no props** — everything comes from context.

## Requires context

Calls `useAuth()`, `usePanels()` and `useView()`, and throws without all three
providers. `ViewProvider` itself depends on the editor and toast contexts, so the
real app order is `ToastProvider > EditorProvider > PanelsProvider >
AuthProvider > ViewProvider`.

**It returns `null` while `user` is null.** The app renders the landing page when
nobody is signed in, so a signed-out branch here would be dead code — if the
topbar renders nothing, the auth context has no user, and that is correct
behaviour rather than a bug.

## What it renders

- `BrandMark size="md"` plus the app name and, from `sm` up, the tagline. The
  lockup is deliberately **not** a link — there is no other page to navigate to.
- An account button showing two-letter initials in a `bg-secondary` chip, the
  display name, and the email at `text-2xs`. It opens a `DropdownMenu` with
  "Signed in as", a Profile/Editor toggle driven by the current `view`, and a
  destructive Sign out.
- Below `md` only, and only on the `workspace` view: a `Menu` button that opens
  the sidebar drawer and a `PanelRight` button that toggles the tools panel. The
  profile view has no sidebar, so those triggers would open an empty one.

## Surface

`rounded-xl border border-border/60 bg-card` with `px-3 py-2`, at
`z-[var(--z-sticky)]` — the same surface treatment as every other `AppShell`
region.
