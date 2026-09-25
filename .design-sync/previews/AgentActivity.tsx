import { AgentActivity } from 'colwrite-ui';

// AgentActivity is the assistant's "what I just did" list, rendered above the
// answer in a chat turn: one quiet line per tool call ("✓ Searched Semantic
// Scholar · 0.8s"), each opening onto its query, input and output.
//
// `live` is the only prop that changes the shape: while a turn runs every line
// is shown and the running one shimmers; once it finishes, more than three
// steps fold under a single "Used N tools" line until someone clicks it. A
// failure's cause is always printed under its line.
//
// `tool` is a key into TOOL_META (ChatAssistant/AgentActivity/toolMeta.ts). An
// unknown key still renders, but with the generic fallback label — the ids below
// are all real ones the agent can emit.

type Run = {
  id: string;
  tool: string;
  state: 'running' | 'done' | 'error';
  durationMs?: number;
  detail?: string;
};

const FINISHED: Run[] = [
  {
    id: 'r1',
    tool: 'doc_read',
    state: 'done',
    durationMs: 420,
    detail: '18 blocks, 2,140 words',
  },
  {
    id: 'r2',
    tool: 'search_citations',
    state: 'done',
    durationMs: 2600,
    detail: '4 candidates for the scaling claim',
  },
  {
    id: 'r3',
    tool: 'doc_edit',
    state: 'done',
    durationMs: 890,
    detail: 'Rewrote the caveat in 4. Results',
  },
];

export function Running() {
  return (
    <div className="max-w-[34rem]">
      <AgentActivity
        live
        runs={[
          { id: 'r1', tool: 'doc_read', state: 'done', durationMs: 380, detail: '18 blocks read' },
          { id: 'r2', tool: 'semantic_scholar_search', state: 'running' },
        ]}
      />
    </div>
  );
}

export function Finished() {
  return (
    <div className="max-w-[34rem]">
      <AgentActivity live={false} runs={FINISHED} />
    </div>
  );
}

export function WithAFailedStep() {
  return (
    <div className="max-w-[34rem]">
      <AgentActivity
        live
        runs={[
          { id: 'r1', tool: 'doc_read', state: 'done', durationMs: 410 },
          {
            id: 'r2',
            tool: 'validate_claim',
            state: 'error',
            durationMs: 1200,
            detail: 'Source returned 404',
          },
          { id: 'r3', tool: 'search_citations', state: 'running' },
        ]}
      />
    </div>
  );
}

export function FinishedAndFolded() {
  return (
    <div className="max-w-[34rem]">
      <AgentActivity
        live={false}
        runs={[...FINISHED, { id: 'r4', tool: 'doc_read', state: 'done', durationMs: 300 }]}
      />
    </div>
  );
}

export function SingleStep() {
  return (
    <div className="max-w-[34rem]">
      <AgentActivity
        live
        runs={[{ id: 'r1', tool: 'doc_read', state: 'done', durationMs: 310, detail: '2,140 words' }]}
      />
    </div>
  );
}
