---
category: Feedback
keywords: [alert, callout, banner, error message, warning, notice, inline status]
---

# Alert

The inline status callout: a bordered, tinted box with a leading icon and a
message. Every research panel, the documents menu, the chats panel and the auth
dialog used to hand-roll this, each with slightly different padding, radius and
icon size. `Alert` is the one definition.

Reach for it when something is **wrong or worth noticing about content that is
already on screen**, and the message belongs next to that content.

## Usage

```jsx
<Alert variant="destructive">Could not load your library — the server returned 503.</Alert>

<Alert variant="info" role="status">
  Save this document to attach files or folders.
</Alert>

<Alert variant="destructive">
  <div className="flex min-w-0 items-start gap-2">
    <span className="min-w-0 flex-1 break-words">{problem.message}</span>
    <Button variant="outline" size="xs" onClick={problem.retry}>
      <RefreshCw />
      Retry
    </Button>
  </div>
</Alert>
```

## Alert vs its neighbours

| Use | When |
| --- | --- |
| `Alert` | Something is wrong, or a condition applies, **to what is on screen**. Stays until the condition clears. |
| `EmptyState` | The container is legitimately empty. Nothing is wrong. |
| `ToastProvider`'s `toast()` | The outcome of an action the user just took, which does not need to persist — "Document saved", "Save failed". |
| `ConfirmProvider`'s `confirm()` | You need an answer before proceeding. `Alert` never blocks. |

An error the user can retry is usually an `Alert` with a `Button` in it, not a
toast — a toast disappears before they can act on it.

## Variants

| variant | Use for |
| --- | --- |
| `destructive` (**default**) | A failure: a request that did not succeed, a file that could not be read. |
| `warning` | A partial result or a degraded state — some files were skipped, autosave is paused. |
| `info` | A condition the user should know about before acting, with nothing broken. |
| `success` | A background job that finished well and has no other home. |

Each variant tints its border, background and text from one status token at a
fixed opacity (`border-<token>/40`, `bg-<token>/10`, `text-<token>`), so the four
read as one family. `variant` defaults to `destructive` — `<Alert>message</Alert>`
is a failure.

## Props

- `variant` — see above.
- `icon` — `React.ElementType | null`. Each variant has a default
  (`AlertCircle`, `TriangleAlert`, `Info`, `CheckCircle2`). Pass a different
  `lucide-react` component to override it (`icon={Upload}`), or **`null` to drop
  the icon entirely** for a note that does not need one. The icon is always
  `aria-hidden`; the message carries the meaning.
- `role` — the element is `role="alert"` by default, which is **assertive**:
  screen readers interrupt to announce it. That is right for a failure the user
  just caused and wrong for an ambient note, so pass `role="status"` for
  anything that is not urgent. The app does this on every `info`, `warning` and
  `success` alert.
- `className` — merged, so `className="text-xs"` is how a narrow panel shrinks
  the type without a new variant.
- Standard `div` attributes (`id`, `style`, `aria-*`, `data-*`) pass through to
  the root element.

## Content

Children go into a `min-w-0 flex-1 break-words` column beside the icon, so a
long unbroken token (a URL, a provider error) wraps instead of stretching the
box. Children can be a bare string, or structure:

- A `<p className="font-medium">` headline plus a
  `<p className="mt-1 text-xs opacity-90">` detail, for a failure that carries an
  upstream message.
- A row with the message on the left and a `Button size="xs"` retry on the right.
- A `<ul>` of the specific items a warning refers to.

Keep the first line a complete sentence about consequence ("Two files were not
searched"), not about the pipeline ("extraction_status=pending on 2 rows").
