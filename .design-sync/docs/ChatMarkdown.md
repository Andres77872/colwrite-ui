---
category: Assistant
keywords: [markdown, message, assistant reply, code block, rich text, formatting]
---

# ChatMarkdown

Renders one assistant message.

```ts
ChatMarkdown({ text, className }: { text: string; className?: string })
```

It is a deliberately small markdown subset parsed in-process — no remark, no
rehype:

| Block | Syntax |
| --- | --- |
| Headings | `#`, `##`, `###` |
| Bullet list | `-`, `*`, `+` |
| Ordered list | `1.` or `1)` |
| Blockquote | `>` |
| Fenced code | triple backticks, optional single-word language |

Inline: `` `code` ``, `**bold**`, `__bold__`, `*italic*`, `[text](href)`.
Anything else stays literal, which is why a stray underscore in a variable name
is safe.

## Code fences: use a bare fence or one word

The fence detector matches a **single `\w*` run** as the info string. A fence
like ` ```js title="a.js" ` matches neither the fence rule nor the paragraph
rule, so the parser makes no progress on it. Keep info strings to one word.

An unterminated fence is fine and expected — a streaming message renders as far
as it has arrived.
