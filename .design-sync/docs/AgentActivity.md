---
category: Assistant
keywords: [agent activity, tool calls, steps, progress, what the agent did]
---

# AgentActivity

What the agent did on this turn, in the order it did it.

```ts
AgentActivity({ runs, live }: { runs: ToolRun[]; live: boolean })
```

```ts
type ToolRun = {
  id: string
  tool: string                          // key into TOOL_META
  state: 'running' | 'done' | 'error'
  durationMs?: number
  detail?: string                       // one line about what the call did
}
```

`live` is true while the turn is still running: it forces the list open and
shows the running verb of the **last** run. Once the turn finishes it collapses
to a single "N steps" line — the detail matters while you are waiting and becomes
noise once the answer is there. That collapsed line is the resting state, not a
truncated render.

Returns `null` for an empty `runs` array.

`tool` names are described to the writer through `TOOL_META`, so the strip says
"Reading your document" rather than "Running doc_read".
