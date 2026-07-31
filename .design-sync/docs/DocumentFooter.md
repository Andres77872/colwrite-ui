---
category: Editor
keywords: [document footer, status bar, word count, character count, counts]
---

# DocumentFooter

The status bar under the canvas. Word and character counts lead; the structural
totals (blocks, headings, paragraphs) are secondary. It previously led with the
structural trivia, which told a writer nothing.

Takes **no props** — it reads `blocks`, `documentId` and `hasAnyRemoteDocs` from
the editor context.

**It returns `null`** when there is no open document and none on the server, so
a fresh install shows no footer at all rather than a row of zeroes.

## Usage

```jsx
<AppShell header={<DocumentHeader />} main={<><Canvas /><DocumentFooter /></>} />
```
