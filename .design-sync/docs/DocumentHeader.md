---
category: Editor
keywords: [document header, title, save, rename, delete, chrome, status]
---

# DocumentHeader

The document's chrome above the canvas: the editable title, the save state, and
the destructive/new-document actions.

Takes **no props**. It reads `doc`, `documentId`, `lastSavedAt`, `isAutoSaving`,
`lastSaveSource` and `saveError` from the editor context, and needs
`ToastProvider` and `ConfirmProvider` above it — `useToast` and `useConfirm`
throw without them, and renaming and deleting both go through them.

## Usage

```jsx
<ToastProvider>
  <ConfirmProvider>
    <AppShell header={<DocumentHeader />} main={<Canvas />} />
  </ConfirmProvider>
</ToastProvider>
```

## States

| State | What drives it |
| --- | --- |
| Saved | `lastSavedAt` set; rendered as an absolute clock time |
| Auto-saving | `isAutoSaving` true |
| Save failed | `saveError` non-null — the copy says the work is kept locally |
| Local draft | `documentId` null, `lastSavedAt` null |
