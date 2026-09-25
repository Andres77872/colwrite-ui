---
category: Assistant
keywords: [markdown, message, assistant reply, code block, rich text, formatting, math, latex, katex, equation, mermaid, diagram]
---

# ChatMarkdown

Renders one assistant message, and extracted text from library PDFs.

```ts
ChatMarkdown({ text, className, sources }: { text: string; className?: string; sources?: SourceMarkers })
```

It parses a deliberately small markdown subset in-process, without remark or
rehype:

| Block | Syntax |
| --- | --- |
| Headings | `#`, `##`, `###` |
| Bullet list | `-`, `*`, `+` |
| Ordered list | `1.` or `1)` |
| Blockquote | `>` |
| Table | GitHub pipe table |
| Fenced code | triple backticks; the first word of the info string is the language |
| Display maths | `$$ … $$`, `\[ … \]` on their own lines, or a ```` ```math ```` fence |
| Diagram | a ```` ```mermaid ```` fence, drawn by `MermaidDiagram` |

Inline: `` `code` ``, `**bold**`, `__bold__`, `*italic*`, `[text](href)`, `[S1]`
source markers, and maths as `$…$` or `\(…\)`. Anything else stays literal.

## Maths

Maths is typeset with KaTeX, with MathML alongside for screen readers, in
lenient mode and with `trust: false`. `$…$` follows pandoc's rule, so prose
dollars stay prose: "$5 and $10", "US$5" and "5$ per seat" are not maths.
Maths that KaTeX cannot parse shows exactly as the model wrote it. A display
block that has not closed yet, which is normal mid-stream, shows as source
until its closing delimiter arrives.

## Diagrams

A ```` ```mermaid ```` fence is drawn only once the fence has closed. While it
streams, it shows as code with a "drawn when the reply finishes it" note.
The drawn diagram sits in a bordered figure with **Show source** under it and
the `MermaidDiagram` hover actions (open larger, copy, download SVG) on it. A
diagram that does not parse shows its error.

## Streaming

An unterminated code fence, maths block or diagram is normal while a reply
streams, and renders as far as it has arrived. Every line is consumed by
exactly one parser branch, so no info string can stall the renderer (see
NOTES.md).
