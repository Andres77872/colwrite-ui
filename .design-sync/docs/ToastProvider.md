---
category: Feedback
keywords: [toast, notification, snackbar, useToast, non-blocking feedback, provider]
---

# ToastProvider

Non-blocking feedback for something that just finished. `ToastProvider` mounts
the stack and portals it to `document.body`, fixed at the bottom centre of the
viewport; `useToast()` is how anything below it posts a message.

It replaces `window.alert`, which froze the whole app for routine outcomes like
"document saved" and gave no way to keep working while a request was in flight.

## Where it goes

At the **root of the app, above everything that might report an outcome** —
including auth, so the sign-in flow can use it too. There is exactly one in the
tree; a second provider would give a second stack.

```jsx
// src/main.tsx
<ToastProvider>
  <ConfirmProvider>
    <TooltipProvider delayDuration={300}>
      <AuthProvider>
        <App />
      </AuthProvider>
    </TooltipProvider>
  </ConfirmProvider>
</ToastProvider>
```

## Usage

```jsx
const { toast, dismiss } = useToast();

// The happy path
toast({ title: 'Document saved', variant: 'success' });

// A failure, with the server's own message as the detail
toast({
  title: 'Save failed',
  description: error instanceof Error ? error.message : undefined,
  variant: 'error',
});

// Keep the id if you need to close it yourself
const id = toast({ title: 'Uploading 3 PDFs' });
dismiss(id);
```

`useToast()` throws `"useToast must be used within ToastProvider"` if there is no
provider above it — that is intentional, so a missing provider fails loudly in
development rather than silently swallowing messages.

## `toast(options)`

| option | |
| --- | --- |
| `title` (required) | One short line, sentence case, no trailing period. This is the whole message for most toasts. |
| `description` | Optional second line at `text-xs` for the detail — usually the server's error text. Wraps. |
| `variant` | `default` · `success` · `error` · `warning`. Sets the border accent and the leading icon (`Info`, `CheckCircle2`, `XCircle`, `AlertTriangle`). |
| `duration` | ms before auto-dismiss. Defaults to **4000**, or **8000** for `error` — a failure needs longer to read. |

Returns the toast's id, for `dismiss(id)`.

## Behaviour worth knowing

- **At most three** toasts are on screen; a fourth pushes the oldest out.
- **Identical toasts are deduped.** A new `toast()` with the same `title` *and*
  `variant` as a live one reuses it and restarts its timer instead of stacking a
  copy. This is what keeps a retrying request — or an effect React runs twice in
  StrictMode — from producing a column of the same message.
- Pending timers are cleared if the provider unmounts mid-flight.

## Accessibility

Each card announces itself, and the urgency follows the variant: `error` is
`role="alert"` / `aria-live="assertive"` and interrupts; everything else is
`role="status"` / `aria-live="polite"` and waits for a pause in speech. The stack
is a `role="region"` labelled "Notifications". Every card has a real
"Dismiss notification" close button, so a toast is never mouse-timeout-only.

The stack itself is `pointer-events-none`; only the cards accept clicks, so a
toast at the bottom of the screen never blocks the UI under it.

## Toast vs its neighbours

- **`toast()`** — the outcome of an action the user just took, which does not need
  to persist. "Document saved", "Could not open that document".
- **`Alert`** — a condition about content on screen that stays until it clears,
  and anything the user must be able to act on (a retry button). A toast
  disappears before they can click it.
- **`confirm()`** — you need an answer before proceeding.
