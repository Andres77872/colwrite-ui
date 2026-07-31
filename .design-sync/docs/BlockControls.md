---
category: Editor
keywords: [block controls, gutter, add block, block menu, move, lock, delete]
---

# BlockControls

The gutter affordances for one block: an "add block" menu and an options menu
(move, lock, hide from the assistant, change heading level or paragraph columns,
delete).

```ts
BlockControls({ id }: { id: string })
```

`id` is the block it belongs to. Everything else comes from the editor context.
Both menus are Radix menus, so they carry menu semantics, arrow-key navigation
and focus return, and respect the app's z-index scale — the hand-built portals
they replaced had none of that and sat above modal dialogs.

**Open state lives in the editor context, not in the component**:
`openMenuBlockId` plus `openMenuType` (`'add' | 'options'`), set through
`setBlockMenu(blockId, type)`. That is what lets the shell close a menu from
outside.

Returns `null` if no block in `blocks` has that `id`.
