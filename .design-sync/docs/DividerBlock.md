---
category: Editor blocks
keywords: [divider, rule, separator, thematic break, hr]
---

# DividerBlock

The thematic break block: a full-width hairline with vertical breathing room.

Takes **no props** and reads no context — the whole component is a `div` and an
`hr` at `bg-border/60`.

Use it between sections of a document. For a rule inside a panel or a card, use
a border utility instead; this block carries document-level spacing (`py-3`) that
will look wrong in dense chrome.
