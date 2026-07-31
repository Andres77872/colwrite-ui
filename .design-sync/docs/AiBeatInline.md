---
category: Inline widgets
keywords: [ai beat, ai passage, generated text, prompt, machine written]
---

# AiBeatInline

The AI-passage widget: a prompt the author keeps in the document, plus the text
the assistant generated from it.

```ts
AiBeatInline(props: AiBeatWidgetProps)
```

`AiBeatWidgetProps` extends `InlineWidgetProps` with `documentId` and
`createRemote` — it needs to be able to generate into a document that does not
exist yet.

Unlike the other inline widgets it is **primary-tinted rather than neutral**,
because it marks a span of the document that is machine-written and re-runnable.
`child.message` is what to write, `child.prompt` is how to write it,
`child.output` is the result, and `child.collapsed` folds it to its header.

`output` is the one field the widget also keeps locally, because it arrives token
by token while generating.
