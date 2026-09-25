---
category: Assistant
keywords: [reference chips, doc mention, tags, hash reference, message rendering]
---

# ChatRefTags

Renders a sent chat message's text with its `#this/…` and `#doc/…` references
shown as chips rather than raw slugs. It is what makes a sent message readable
after the fact.

```ts
ChatRefTags({ text, className, style }: {
  text: string
  className?: string
  style?: CSSProperties
})
```

A block reference reads as what the block says (a heading's text, a paragraph's
opening words), and the composer's chips use the same label — a reference looks
the same being written as it does once sent. The chips are quiet tints
(`.ref-chip--block` gray, `.ref-chip--doc` blue) that sit on the user's muted
bubble as well as on the page.
