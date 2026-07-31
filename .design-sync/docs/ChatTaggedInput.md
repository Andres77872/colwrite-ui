---
category: Assistant
keywords: [composer, message input, contenteditable, chat input, mention, send]
---

# ChatTaggedInput

The assistant's message composer.

```ts
ChatTaggedInput(props: {
  value: string
  onChange: (next: string) => void
  onSubmit?: () => void
  placeholder?: string
  disabled?: boolean
  onTriggerPicker?: (anchorIndex: number) => void
  onEditRef?: (start: number, refText: string) => void
  onRemoveRef?: (start: number, refText: string) => void
  onKeyDown?: (event: KeyboardEvent<HTMLDivElement>) => void
  isPickerOpen?: () => boolean
  maxLength?: number
  className?: string
})
```

It is a `contenteditable` rather than a `textarea` for one reason: a `#doc/…`
reference renders as a chip the caret steps over in a single press, which no
plain text field can do. **Everything else behaves like a text field** — Enter
sends, Shift+Enter opens a line, and `value` is a plain string.

`isPickerOpen` is how the composer hands Enter to `ChatRefPicker`: with a list of
documents on screen, Enter picks the highlighted one instead of sending.

Exposes a `ChatTaggedInputHandle` ref (`focus`, `getHost`, `setSelectionRange`,
`getSelectionRange`).
