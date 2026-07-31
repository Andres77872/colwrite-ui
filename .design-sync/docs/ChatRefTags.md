---
category: Assistant
keywords: [reference chips, doc mention, tags, hash reference, message rendering]
---

# ChatRefTags

Renders a chat message's text with its `#doc/…` references shown as chips rather
than raw slugs. It is what makes a sent message readable after the fact.

```ts
ChatRefTags({ text, interactive, onTagClick, onTagRemove, surface, className, style }: {
  text: string
  interactive?: boolean
  onTagClick?: (start: number, refText: string) => void
  onTagRemove?: (start: number, refText: string) => void
  surface?: 'card' | 'onfill'
  className?: string
  style?: CSSProperties
})
```

**`surface` is the one thing that is easy to get wrong.** Use `'card'` (the
default) on the assistant's card background and `'onfill'` on a filled user
bubble — the chip needs different treatment on a tinted surface.

`interactive` turns the chips into buttons. Leave it off for a sent message,
which should be static text.
