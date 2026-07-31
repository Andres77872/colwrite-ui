---
category: Editor
keywords: [ai actions, improve writing, rephrase, translate, shorten, assistant menu]
---

# AIActionMenu

The AI actions available for the current text selection — grouped edit /
reference / transform, with Translate opening a submenu of languages.

```ts
AIActionMenu({ disabled, onAction }: {
  disabled?: boolean
  onAction: (action: AiAction, language?: string) => void
})
```

Items fire through Radix's `onSelect`, so they work from the keyboard as well as
the mouse. That is only safe because `FloatingToolbar` keeps the selection range
in a ref: opening the menu moves DOM focus off the text.

The action list comes from `AI_ACTION_REGISTRY` (`src/config/aiActions.ts`) —
it is data, not markup, so adding an action does not touch this component.

The underlying menu is uncontrolled; there is no `open` prop.
