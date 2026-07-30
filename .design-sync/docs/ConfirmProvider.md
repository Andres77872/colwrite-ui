---
category: Feedback
keywords: [confirm, confirmation dialog, useConfirm, destructive action, are you sure, provider]
---

# ConfirmProvider

`await confirm({ … })` — a styled, focus-correct replacement for
`window.confirm`. `ConfirmProvider` holds the single pending confirmation and
renders it as a `Dialog`; `useConfirm()` returns the function that opens one and
resolves to a boolean.

The native dialog blocks the event loop, cannot be styled, reads the page URL
aloud as its title, and can only say "OK / Cancel" — so it could never name what
was about to be deleted. This keeps the same `await` ergonomics inside the app's
own focus and theming rules.

## Where it goes

At the **root of the app, just inside `ToastProvider`**. One instance for the
whole tree: the provider holds a single `pending` confirmation, which is correct —
two overlapping confirmations would be a bug in the calling code.

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
const confirm = useConfirm();

const onDelete = async () => {
  const ok = await confirm({
    title: `Delete “${doc.name}”?`,
    description: 'This permanently removes the document and its chats. It cannot be undone.',
    confirmLabel: 'Delete',
    destructive: true,
  });
  if (!ok) return;
  await deleteDocument(doc.id);
};

// A non-destructive checkpoint
const ok = await confirm({
  title: 'Start a new document?',
  description: 'Unsaved changes to the current document will be lost.',
  confirmLabel: 'Start new',
});
```

`useConfirm()` returns the `confirm` function directly (not an object), and throws
`"useConfirm must be used within ConfirmProvider"` when no provider is above it.
The promise resolves `false` on Cancel, on Escape, and on an overlay click — so
`if (!ok) return;` covers every dismissal.

## `confirm(options)`

| option | |
| --- | --- |
| `title` (required) | A question naming the specific thing: `` `Delete “${doc.name}”?` ``, not "Are you sure?". Becomes the `DialogTitle`. |
| `description` | `ReactNode`. One sentence on what is irreversible. Becomes the `DialogDescription`. |
| `confirmLabel` | Defaults to `Confirm`. **Always override with the verb** — "Delete", "Start new", "Accept all". |
| `cancelLabel` | Defaults to `Cancel`. Override when the alternative is a real choice ("Keep reviewing"). |
| `destructive` | `true` styles the confirm button `destructive` **and** moves initial focus to Cancel. |

## `destructive` is a safety behaviour, not a colour

With `destructive: true` the dialog's `onOpenAutoFocus` is intercepted and focus
lands on **Cancel** instead of the confirm button. Without it, a user who was
mid-keystroke when the dialog opened could delete a document with one stray
Enter. Set it on every irreversible action, and leave it off for a checkpoint the
user can simply redo.

There is no corner close button (`showCloseButton={false}`): the footer's Cancel
is the dismiss path, so there is one obvious way out rather than two.

## Confirm vs its neighbours

- **`confirm()`** — you need an answer before proceeding, and the action is
  destructive or loses work. It blocks.
- **`Dialog`** — anything with more than two outcomes, or a form. `confirm()` is
  strictly yes/no; reach for `Dialog` directly the moment you need an input.
  A "type the collection name to confirm" flow is a `Dialog`, not this.
- **`toast()`** — reporting what happened *after* the action. The two pair up:
  confirm, act, then toast the outcome.
