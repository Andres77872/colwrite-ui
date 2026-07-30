---
category: Forms
keywords: [editable, contenteditable, rich text, block editor, paragraph, prose, slash menu]
---

# Editable

The contenteditable field that every block in the document canvas is built on —
paragraphs, headings, and anything else the user types prose into. It is not a
form control: there is no `value`/`onChange`, no border, and no focus outline.
It renders the HTML you give it and reports edits back to the editor store.

Use `Input` or `Textarea` for a plain string in a form. Use `Editable` only for
document body content, where inline formatting, inline widgets and the slash
menu have to work.

## Requires the editor context

`Editable` calls `useEditor()` for `updateHtml`, `addBlockAfter`, `removeBlock`,
`setActive` and the ref registry, and **throws** outside `EditorProvider`:

```jsx
<EditorProvider>
  <Editable
    id={block.id}
    html={block.html}
    slashEnabled
    placeholder="Type something, or press '/' for commands…"
    className="text-md leading-relaxed"
  />
</EditorProvider>
```

The heading block, for comparison — same component, different type scale and no
slash menu:

```jsx
<Editable
  id={block.id}
  html={block.html}
  placeholder="Heading"
  className="text-2xl font-semibold leading-tight tracking-tight"
/>
```

## Props

| Prop | Type | Notes |
| --- | --- | --- |
| `id` | `string` (required) | The block id. It is the key in the editor's ref registry and the id passed to every store call — it must be the real block id, not a generated one. |
| `html` | `string` (required) | The block's markup. Written into the node with `innerHTML` from a layout effect, not rendered as children, so the caret is not reset on every keystroke. |
| `placeholder` | `string` | Rendered by CSS (`[contenteditable][data-placeholder]:empty::before`) only while the node is **truly empty**. |
| `slashEnabled` | `boolean` | Default `false`. When true, `/` opens the command menu instead of typing a slash. Paragraphs set it; headings do not. |
| `className` | `string` | Merged after the base. This is where the type scale lives. |
| `style` | `CSSProperties` | Used for CSS multi-column bodies (`columnCount`, `columnGap`, `columnRule`). |

There is no `onChange`: edits go to `updateHtml(id, serialized)` on the editor
context, after `serializeEditableHtml` strips inline-widget internals.

## What is interaction-only

These behaviours exist but cannot appear in a static render, so do not expect
them in a card and do not design around a screenshot of one:

- **The slash menu** (`slashEnabled` + `/`) — opens a separate overlay.
- **The floating format toolbar**, which finds the active field by the
  `.editable` class on a live selection.
- **Ctrl+Enter** inserts a new paragraph after this block; **Backspace** in a
  truly empty block deletes it.
- The active-row tint, which `Canvas` draws from `.editable:focus-visible`.

## Accessibility and behaviour notes

- The element is a `div[contenteditable]`. It has **no focus outline on purpose**
  — a box drawn around body text reads as an error state while writing. The
  affordance is the row tint in `Canvas`. Do not add `focus:ring-*`.
- It carries the `editable` class as a DOM hook. Keep it: removing it silently
  disables the format/AI toolbar.
- Give the field an accessible name from its surroundings (a heading, or a
  labelled block row); `placeholder` is a CSS `::before` and is not announced.
- Inline widgets (tables, equations, citations, AI beats) live inside the same
  host as `[data-child-id]` placeholders and are portalled in by the block. Key
  handling deliberately defers to them, so `/` and Backspace inside a table cell
  belong to the table, not the paragraph.

## Composition

- One `Editable` per block. Do not nest them, and do not put focusable controls
  inside one except as a widget with `contenteditable=false`.
- Type scale comes from `className`: `text-md leading-relaxed` for body,
  `text-3xl` / `text-2xl` / `text-xl` for h1–h3.
- The component is `w-full` with a `min-h-[1.5em]` floor so an empty block still
  has a clickable line.
- `whitespace-pre-wrap break-words` is built in — long tokens and pasted
  linebreaks are handled; do not override the wrapping.
