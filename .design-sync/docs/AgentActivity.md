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
  state: 'running' | 'done' | 'error' | 'interrupted'
  durationMs?: number
  detail?: string                       // one line about what the call did
}
```

One quiet line per call — state icon, the tool's label, its duration — that
opens onto the call's query, input and output. `live` is true while the turn is
still running: every line stays in view and the running one names what it is
doing ("Searching Semantic Scholar…") in a shimmer. Once the turn finishes, more
than three steps fold under a single "Used N tools" line. A failed call's cause
is always printed under its line, never behind a click.

Returns `null` for an empty `runs` array.

`tool` names are described to the writer through `TOOL_META`, so the strip says
"Reading your document" rather than "Running doc_read".
