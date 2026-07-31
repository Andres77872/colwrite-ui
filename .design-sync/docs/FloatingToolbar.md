---
category: Editor
keywords: [floating toolbar, selection toolbar, formatting, bold, italic, ai actions]
---

# FloatingToolbar

The selection toolbar: formatting controls on the left, `AIActionMenu` on the
right. Takes **no props**.

**It appears only while there is a non-collapsed selection inside an element
carrying the `editable` class.** That class is how the toolbar finds the active
field — until it was added to `Editable`, the toolbar could not appear at all
and the AI action menu was unreachable. If your own editable surface needs the
toolbar, it must carry that class.

Visibility is internal state driven by `selectionchange`; there is no `open`
prop. It returns `null` while nothing is selected.

The toolbar keeps the selection range in a ref, which is what makes the AI menu
safe to open: opening a menu moves DOM focus off the text.
