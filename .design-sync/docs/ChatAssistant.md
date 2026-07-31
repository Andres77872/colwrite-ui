---
category: Assistant
keywords: [chat, assistant, ai panel, conversation, composer, agent]
---

# ChatAssistant

The assistant panel: the message list, the agent activity strip, the composer
with its reference picker, and the collapsed rail state. Takes **no props**.

**Open/closed is shell state, not local state.** `assistantOpen` lives in
`PanelsContext` so the Mod+J shortcut can toggle it from outside the component;
"maximized" stays local, because nothing else has a reason to touch it.

It needs the editor, proposals and chat-sessions contexts, and sits in the
`aside` region of `AppShell`.

## Usage

```jsx
<AppShell main={<Canvas />} aside={<ChatAssistant />} right={<Rail />} />
```

## Composition

The pieces it renders are all separately usable: `ChatMarkdown` for a message
body, `AgentActivity` for the tool strip, `ChatTaggedInput` for the composer,
`ChatRefPicker` for "#" references and `ChatRefTags` for a sent message.
