---
category: Feedback
keywords: [error boundary, crash, fallback, recovery, try again, render error]
---

# ErrorBoundary

A React error boundary with a styled fallback and a **Try again** button. It keeps
one broken subtree from blanking the whole app.

The block editor builds a lot of its DOM by hand — `contenteditable`, portals,
streamed AI widgets — so a render throw is a real possibility. There was no
boundary anywhere, which meant any such throw unmounted the entire tree and left
a white page with no route back, including no way to reach the document the
author was in the middle of writing.

## Usage

```jsx
<AppShell
  header={<ErrorBoundary label="the toolbar"><Topbar /></ErrorBoundary>}
  left={<ErrorBoundary label="the sidebar"><Sidebar /></ErrorBoundary>}
  main={
    <ErrorBoundary label="the editor">
      <Canvas />
      <ChatAssistant />
    </ErrorBoundary>
  }
  aside={<ErrorBoundary label="this panel"><ToolsAside /></ErrorBoundary>}
/>
```

## Props

- `children` (required) — rendered untouched while there is no error.
- `label` (required) — a **noun phrase with its article**, interpolated into the
  fallback title: `` `Something went wrong in ${label}` ``. The app uses
  "the editor", "the sidebar", "the toolbar", "the tools rail", "this panel",
  "your profile", "this page". Not "Editor", not "EditorCanvas".

There is no `fallback` prop and no `onError` prop: one fallback treatment for the
whole app is the point, and there is no logging service wired up.

## Granularity

**One boundary per independently useful region**, not one per app and not one per
component:

- Wrap each `AppShell` slot separately. A crash in the tools panel then leaves
  the editor, the sidebar and the toolbar alive and usable.
- Wrap the whole page when there is only one region (the landing page).
- Do not wrap a leaf that has no meaning on its own — its parent region already
  covers it, and a fallback inside a 24px slot is unreadable.

Choosing the boundary is choosing what stays working. Put it where the user still
has somewhere to go.

## The fallback

Renders an `EmptyState` at `size="page"` with an `AlertTriangle`, the title above,
the caught `error.message` as the description (or "An unexpected error interrupted
rendering." when the error has none), and a **Try again** button that clears the
error and re-renders the children. Retrying is genuinely useful for a transient
throw — a stale ref, a response that arrived in the wrong shape — and costs
nothing when it is not.

The fallback is `flex min-h-0 flex-1 items-center justify-center p-4`, so it fills
the region it was given. **Give it a parent that has a height** — a flex column,
or an `AppShell` slot. Dropped into a plain `div` with no height it collapses to
its content.

## What it does and does not catch

Catches: throws during **render**, in lifecycle methods, and in constructors of
anything below it.

Does not catch: event handlers, `setTimeout`/`requestAnimationFrame` callbacks,
promise rejections, or `async` function bodies. Async failures are the caller's
job — `try/catch` and a `toast({ variant: 'error' })`, which is how every request
in the app reports.

`componentDidCatch` attaches React's component stack to `error.cause` rather than
dropping it, so the browser's own error report shows where the throw came from.
