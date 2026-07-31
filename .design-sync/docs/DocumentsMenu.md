---
category: Editor
keywords: [documents, document list, open, search, sort, paging, new document]
---

# DocumentsMenu

The document list: search, sort, paging, open, create and delete. Takes **no
props**.

Everything it shows comes from `listRemote` on the editor context, re-fetched
whenever `documentListRevision` changes. It needs `ToastProvider` and
`ConfirmProvider` above it — creating and deleting both go through them.

## Usage

```jsx
<AppShell left={<DocumentsMenu />} main={<Canvas />} />
```

## States

Loading, populated, empty ("no documents yet"), and list-unavailable are all
driven by how `listRemote` settles — there are no props to force them.
