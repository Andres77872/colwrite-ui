---
category: Assistant
keywords: [chat, assistant, ai panel, conversation, composer, agent]
---

# ChatAssistant

The writing assistant, as the content of the right sidebar's AI tab. Takes
**no props** and owns no window: it fills the column it is given (a docked
panel beside the page on desktop, a sheet on a phone).

- **Header** — the current chat's title as a button that opens the chat list
  (search, rename, delete, New chat — the shared `ChatsPanel`), a "N to review"
  pill while proposals are pending, and a New chat icon.
- **Home** — a violet sparkle, "How can I help with this paper?", and six
  suggestion rows that send straight away.
- **Transcript** — the user's message in a muted bubble on the right; the
  answer as full-width prose under a small sparkle, with one quiet line per
  tool run, `[S1]` citation pills that preview their source on hover, a
  compact source list, and Copy · Insert into page · Retry · Review N changes.
- **Composer** — context chips (the page, the selection) above the text, `#`
  to reference a block, a round send button that becomes a square stop.

**Open/closed is shell state.** `assistantOpen` lives in `PanelsContext`, so
the Mod+J shortcut can toggle it; the sidebar maps it to its AI tab.

It needs the editor, proposals, chat-sessions, toast, confirm and tooltip
providers.

## Usage

```jsx
<ToolsAside />  {/* mounts <ChatAssistant /> in its AI tab */}
```

## Composition

The pieces it renders are all separately usable: `ChatMarkdown` for a message
body, `AgentActivity` for the tool lines, `ChatTaggedInput` for the composer,
`ChatRefPicker` for "#" references and `ChatRefTags` for a sent message.
