---
category: Review
keywords: [review bar, pending changes, accept all, reject all, batch, invites]
---

# ReviewBar

The sticky summary of everything the assistant is waiting on. Takes **no props**.

Individual changes are reviewed in place (`ChangeCard`), but a batch can span the
whole document — without a count and a way to step through them, an author has no
idea whether they have seen all of it.

**It returns `null` when there is nothing to review**: no pending changes, no
document invites and no error. There is no "empty" state to design for.

It reads `blocks` and `switchTo` from the editor and the pending set, invites and
error from proposals, and needs `ConfirmProvider` above it — accept-all and
reject-all both confirm first.

Three things can put it on screen: pending changes, a document the assistant
created and is offering (`invites`), or an `error` such as a version conflict.
