---
category: Assistant
keywords: [reference picker, document picker, hash mention, autocomplete, chat]
---

# ChatRefPicker

The "#" document picker in the chat composer.

```ts
ChatRefPicker(props: {
  getHost: () => HTMLElement | null
  input: string
  setInput: (value: SetStateAction<string>) => void
  setCaretIndex?: (idx: number) => void
})
```

**It is imperative by design**: the composer owns the text and tells the picker
when to open through a ref handle, because the trigger is a caret position
rather than a click.

```ts
type ChatRefPickerHandle = {
  openAt: (anchorIndex: number, opts?: { editing?: boolean }) => void
  close: () => void
  isOpen: () => boolean     // the composer asks before treating Enter as "send"
}
```

`getHost` returns the element it positions against. The list comes from
`listRemote` on the editor context.
