import type { ReactNode } from 'react';
import { AgentActivity, AssistantCatalogContext, assistantCatalogAllOn } from 'colwrite-ui';

// AgentActivity is the assistant's "what I just did" list, rendered above the
// answer in a chat turn: one quiet line per tool call ("✓ Searched Semantic
// Scholar · 0.8s"), each opening onto its input and output.
//
// `live` is the only prop that changes the shape: while a turn runs every line
// is shown and the running one shimmers; once it finishes, more than three
// steps fold under a single "Used N tools" line until someone clicks it. A
// failure's cause is always printed under its line.
//
// A row's label, running label, icon and detail line come from the workspace's
// assistant catalog (here the literal `assistantCatalogAllOn`), or, for a tool
// the catalog does not list, from the `display` its start event carried. The
// detail is the first of the tool's templates its arguments can fill.

type Run = {
  id: string;
  tool: string;
  state: 'running' | 'done' | 'error';
  durationMs?: number;
  args?: Record<string, unknown>;
  error?: string;
  errorType?: string;
  display?: { label: string; running_label: string; icon: string; detail_templates: string[] };
};

function WithCatalog({ children }: { children: ReactNode }) {
  return (
    <AssistantCatalogContext.Provider value={assistantCatalogAllOn}>
      <div className="max-w-[34rem]">{children}</div>
    </AssistantCatalogContext.Provider>
  );
}

const FINISHED: Run[] = [
  { id: 'r1', tool: 'doc_read', state: 'done', durationMs: 420 },
  {
    id: 'r2',
    tool: 'semantic_scholar_search',
    state: 'done',
    durationMs: 2600,
    args: { content_redacted: true, query_redacted: true, query_length: 38, limit: 10, year_from: 2020 },
  },
  { id: 'r3', tool: 'doc_edit', state: 'done', durationMs: 890 },
];

export function Running() {
  return (
    <WithCatalog>
      <AgentActivity
        live
        runs={[
          { id: 'r1', tool: 'doc_read', state: 'done', durationMs: 380 },
          { id: 'r2', tool: 'semantic_scholar_search', state: 'running' },
        ]}
      />
    </WithCatalog>
  );
}

export function Finished() {
  return (
    <WithCatalog>
      <AgentActivity live={false} runs={FINISHED} />
    </WithCatalog>
  );
}

export function WithAFailedStep() {
  return (
    <WithCatalog>
      <AgentActivity
        live
        runs={[
          { id: 'r1', tool: 'doc_read', state: 'done', durationMs: 410 },
          {
            id: 'r2',
            tool: 'validate_claim',
            state: 'error',
            durationMs: 30_000,
            error: 'External research tool failed; content-bearing details redacted.',
            errorType: 'timeout',
          },
          { id: 'r3', tool: 'web_search', state: 'running' },
        ]}
      />
    </WithCatalog>
  );
}

export function FinishedAndFolded() {
  return (
    <WithCatalog>
      <AgentActivity
        live={false}
        runs={[...FINISHED, { id: 'r4', tool: 'doc_read', state: 'done', durationMs: 300 }]}
      />
    </WithCatalog>
  );
}

/** A tool this client's catalog does not list: named by its start event's display. */
export function AToolTheCatalogLacks() {
  return (
    <WithCatalog>
      <AgentActivity
        live={false}
        runs={[
          {
            id: 'r1',
            tool: 'page_outline',
            state: 'done',
            durationMs: 410,
            args: { sections_count: 4 },
            display: { label: 'Read the page outline', running_label: 'Reading the page outline', icon: 'file-search', detail_templates: ['{sections_count} sections'] },
          },
        ]}
      />
    </WithCatalog>
  );
}
