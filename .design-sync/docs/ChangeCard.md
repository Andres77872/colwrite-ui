---
category: Review
keywords: [change card, diff, proposed change, accept, reject, review]
---

# ChangeCard

One proposed change, rendered where it would land in the document.

```ts
ChangeCard({ change }: { change: ProposedChange })
```

**The accept and reject controls live here rather than in the chat panel on
purpose**: an author cannot judge a rewrite from a summary, only from seeing it
against the surrounding paragraph.

`change.kind` covers replace, insert and delete; `anchorBlockId` is the existing
block the card renders beside, and is null for inserts at the very start or end
of the document. `dependsOn` lists changes in the same batch that must be
accepted first — while any of them are outstanding, `ready(change)` is false and
this card cannot be accepted yet.

Reads `blocks` from the editor (to show the text being replaced) and
`accept`/`reject`/`ready`/`focusedChangeId` from proposals.
