import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import { AgentSocket, type AgentSessionEvent } from '@/api/assistant/agentSocket';
import { decodeAgentEvent, handleAgentEvent, type AgentEventHandlers } from '@/api/assistant/streamParser';
import { listMessages } from '@/data/chats';
import { AssistantCatalogContext, catalogValue } from '@/components/preferences/assistantCatalogContextState';
import { FIXTURE_DOCUMENT_ID, PERSONAL_WORKSPACE_ID, catalogOf, fixtures } from '@/dev/msw/fixtures';
import { AgentActivity } from '../AgentActivity';
import { emptyMessage, historyMessages, type ChatMessage } from '../chatUtils';
import { citedOrder } from '../answerSourceMarkers';
import type { AgentChatRequestInput } from '@/api/schema';
import { enableImageFixture } from '@/dev/msw/imageGenerations';
import { replyDetails, replyMetaOf, replySummary } from '../replyMeta';
import { conversationSources, withArtifact, withChangeSet, withEvidence, withTodos, withToken, withToolArgs, withToolEnd, withToolStart, withWorker, withClaim, withSkill, withInstructions } from '../transcript';

/**
 * A reply survives a reload (P1.UI-4): the mock API's scripted turn, with a
 * research worker, a paper search, its sources, a task list and an edit, is
 * shown live from its events the way the chat folds them in, then read back
 * from `GET …/messages` and rebuilt from its record. Both are the same reply.
 */

const WS = PERSONAL_WORKSPACE_ID;
const DOC = FIXTURE_DOCUMENT_ID;
const clients: AgentSocket[] = [];
afterEach(() => {
  for (const client of clients.splice(0)) client.close();
  cleanup();
});

/** The reply as the chat builds it from a run's events (`useAgentTurn`'s handlers, on the transcript's updates). */
function liveReply(events: AgentSessionEvent[]): { message: ChatMessage; chatId: string; messageId: number } {
  let message = emptyMessage('assistant');
  let ids = { chatId: '', messageId: 0 };
  const handlers: AgentEventHandlers = {
    onToken: (content) => { message = withToken(message, content, 0, null); },
    onToolCallStart: (tool, id, display) => { message = withToolStart(message, { id, tool, display }, 0); },
    onToolCallArgs: (event) => { message = withToolArgs(message, event); },
    onToolCallEnd: (event) => { message = withToolEnd(message, event); },
    onEvidence: (evidence) => { message = withEvidence(message, evidence); },
    onClaim: (claim) => { message = withClaim(message, claim); },
    onArtifact: (artifact) => { message = withArtifact(message, artifact); },
    onSkill: (skill) => { message = withSkill(message, skill); },
    onInstructions: (items) => { message = withInstructions(message, items); },
    onTodo: (items) => { message = withTodos(message, items); },
    onSubagent: (worker) => { message = withWorker(message, worker); },
    onToolAction: (action) => { if (action.changeSetId) message = withChangeSet(message, action.changeSetId); },
    onDone: ({ chatId, messageId, usage, models, cost, budget, persistence }) => {
      message = { ...message, usage, models, cost, budget, persistence };
      ids = { chatId: chatId ?? '', messageId: messageId ?? 0 };
    },
  };
  for (const event of events) {
    const decoded = decodeAgentEvent(event.event, event.data);
    if (decoded) handleAgentEvent(decoded, handlers);
  }
  return { message, ...ids };
}

type Turn = { message: string; attachments?: AgentChatRequestInput['attachments']; after?: { chatId: string; messageId: number } };

/**
 * Runs the mock's scripted turn over the socket (in the chat `after` names,
 * continuing its branch) and reads its reply live and back from
 * `GET …/messages`, with the branch it ends.
 */
async function runAndReload({ message, attachments, after }: Turn): Promise<{
  live: ChatMessage; reloaded: ChatMessage; branch: ChatMessage[]; chatId: string; messageId: number;
}> {
  const events: AgentSessionEvent[] = [];
  const client = new AgentSocket((event) => events.push(event));
  clients.push(client);
  await client.connect();
  const chat = after ? { chat_id: after.chatId } : {};
  const session = await client.request('sessions.create', { workspace_id: WS, document_id: DOC, ...chat });
  await client.request('sessions.subscribe', { workspace_id: WS, session_id: session.id });
  await client.request('runs.start', {
    workspace_id: WS, session_id: session.id, request_id: 'run',
    request: { document_id: DOC, message, ...(attachments ? { attachments } : {}), ...(after ? { chat_id: after.chatId, leaf_id: after.messageId } : {}) },
  });
  await vi.waitFor(() => expect(events.at(-1)?.data.status).toBe('completed'), { timeout: 20_000 });

  const live = liveReply(events);
  const stored = await listMessages(WS, DOC, live.chatId, live.messageId);
  const branch = historyMessages(stored.items);
  const reloaded = branch.at(-1);
  if (!reloaded) throw new Error('The reply was not stored');
  return { live: live.message, reloaded, branch, chatId: live.chatId, messageId: live.messageId };
}

/** What a reader of the reply sees: its activity list, its line and its details. */
function shown(message: ChatMessage): {
  activity: string;
  summary: string[];
  details: Array<{ label: string; value: string }>;
} {
  const catalog = catalogValue(catalogOf(WS), false, null);
  const { container, unmount } = render(
    <AssistantCatalogContext.Provider value={catalog}>
      <AgentActivity live={false} runs={message.runs} workers={message.workers} />
    </AssistantCatalogContext.Provider>,
  );
  const activity = container.textContent ?? '';
  unmount();
  // When and how long are this browser's for a live turn and the server's for a stored one.
  const meta = replyMetaOf({ ...message, createdAt: undefined, durationMs: undefined });
  return { activity, summary: replySummary(meta).map((part) => part.text), details: replyDetails(meta) };
}

describe('a reply, reloaded', () => {
  it('generates an image in chat and uses the same asset in the page edit and reloaded reply', async () => {
    enableImageFixture();
    fixtures.jobDurationMs = 0;
    const { live, reloaded, chatId } = await runAndReload({ message: 'Generate an illustration of a blue river and add it to the page.' });
    expect(live.artifacts).toHaveLength(1);
    expect(reloaded.artifacts).toEqual(live.artifacts);
    const image = reloaded.artifacts![0]!;
    expect(image).toMatchObject({ kind: 'image', status: 'succeeded', asset_id: expect.stringMatching(/^ast-/) });
    expect(fixtures.imageGenerations.get(image.generation_id)?.asset_id).toBe(image.asset_id);
    expect(fixtures.assets.get(image.asset_id!)?.references).toContainEqual(expect.objectContaining({ kind: 'chat', referenceId: chatId }));
    expect(fixtures.changeSets.get(DOC)?.at(-1)?.operations).toMatchObject([
      { op: 'write_blocks', blocks: [{ type: 'image', assetId: image.asset_id }] },
    ]);
    expect(fixtures.jobs.size).toBe(1);
    expect(fixtures.assets.size).toBe(1);
  });

  it('shows the same activity, sources, tasks, workers, change sets, models, usage and cost against its limit', async () => {
    fixtures.assistant = { switches: { workers: true }, sources: { semantic_scholar: true } };
    fixtures.documents.get(FIXTURE_DOCUMENT_ID)!.instructions = 'Private author instructions.';
    const { live: message, reloaded } = await runAndReload({ message: 'Improve this from the literature' });
    const live = { message };

    // The record holds what the events showed: no previews, which the server keeps nowhere.
    const strip = (message: ChatMessage) => message.runs.map(({ id, tool, state, durationMs, args, error, errorType, outputChars }) => (
      { id, tool, state, durationMs, args, error, errorType, outputChars }
    ));
    expect(strip(reloaded)).toEqual(strip(live.message));
    expect(reloaded.runs.map((run) => run.tool)).toEqual(['paper_search', 'paper_search', 'doc_read', 'doc_edit']);
    expect(reloaded.sources).toEqual(live.message.sources);
    expect(reloaded.sources?.map((source) => [source.handle, source.kind, source.state, source.record.key])).toEqual([
      ['S1', 'paper', 'unchecked', 'arxiv:2101.03961'], ['S2', 'preprint', 'unchecked', 'arxiv:2202.08906'],
    ]);
    expect(reloaded.passages).toEqual(live.message.passages);
    expect(reloaded.todos).toEqual(live.message.todos);
    expect(reloaded.workers).toEqual(live.message.workers);
    expect(reloaded.workers).toHaveLength(1);
    expect(message.skills).toEqual(expect.arrayContaining([expect.objectContaining({ id: 'editor', by: 'tools' })]));
    expect(reloaded.skills).toEqual(message.skills);
    expect(reloaded.instructions).toEqual([{ scope: 'page', block_id: null, label: 'Page' }]);
    expect(JSON.stringify(reloaded.instructions)).not.toContain('Private author');
    expect(reloaded.changeSetIds).toEqual(live.message.changeSetIds);
    expect(reloaded.content).toBe(live.message.content);
    expect({ usage: reloaded.usage, models: reloaded.models, cost: reloaded.cost })
      .toEqual({ usage: live.message.usage, models: live.message.models, cost: live.message.cost });

    // The record keeps the run's cost ceiling (`cost_limit`) and the limit
    // it answered at (`limit_reached`, none here) as `done` reported them.
    expect(reloaded.budget).toEqual(live.message.budget);
    expect(reloaded.budget).toEqual({ costLimit: 5, limitReached: null });

    // It reads the same: the worker's group, each step's name and detail,
    // the model, tokens, and the cost against its limit.
    expect(shown(reloaded)).toEqual(shown(live.message));
    // Four steps fold under their summary, the worker's group with them.
    expect(shown(reloaded).activity).toContain('Used 4 tools');
    expect(shown(reloaded).activity).toContain('1 research worker');
    expect(shown(reloaded).details).toContainEqual({ label: 'Cost', value: '$0.0168 of $5.00' });
  }, 30_000);

  it('says it stopped at its limit after a reload as it did live, but not the writes that failed', async () => {
    const { live, reloaded } = await runAndReload({ message: 'Keep going until your limit; some of it may be unsaved' });
    expect(live.budget).toEqual({ costLimit: 5, limitReached: 'model_calls' });
    expect(reloaded.budget).toEqual(live.budget);

    // The line, its popover's words and the cost against its limit.
    expect(shown(reloaded)).toEqual(shown(live));
    expect(shown(reloaded).summary[0]).toBe('Stopped at its limit');
    expect(shown(reloaded).details).toContainEqual({ label: 'Ended', value: 'Stopped at its step limit and answered with what it had' });
    expect(shown(reloaded).details.find((row) => row.label === 'Cost')?.value).toMatch(/^\$[\d.]+ of \$5\.00$/);

    // The failed writes are in `done` only, so the note is said live only.
    expect(live.persistence).toEqual({ failedWrites: 1, kinds: ['llm_call'] });
    expect(reloaded.persistence).toBeUndefined();
  }, 30_000);

  it('keeps a claim check with its passages, so the claim card reads the same after a reload', async () => {
    const { live, reloaded } = await runAndReload({ message: 'Check the claim that top-1 routing keeps compute constant' });
    expect(live.claims).toEqual([{
      toolCallId: 'call_claim', verdict: 'partly', evidenceLevel: 'full_text', cannotAssess: false,
      passages: [{ id: 'S1.1', level: 'full_text', stance: 'supports' }, { id: 'S2.1', level: 'abstract', stance: 'limits' }],
    }]);
    expect(reloaded.claims).toEqual(live.claims);
    // Each passage's source is the reply's, by its handle.
    expect(reloaded.passages?.map((passage) => passage.id)).toEqual(['S1.1', 'S2.1']);
    expect(reloaded.sources?.map((source) => source.handle)).toEqual(['S1', 'S2']);
  }, 30_000);

  it('keeps a check that could not assess the claim on abstracts alone', async () => {
    const { live, reloaded } = await runAndReload({ message: 'Check this claim against the abstracts' });
    expect(live.claims?.[0]).toMatchObject({ verdict: 'insufficient', cannotAssess: true, evidenceLevel: 'abstract' });
    expect(reloaded.claims).toEqual(live.claims);
  }, 30_000);

  it('keeps an attached PDF’s handle and the passages its read stored', async () => {
    const pdf = fixtures.pdfs.find((item) => item.workspace_id === WS);
    if (!pdf) throw new Error('No PDF in the personal workspace');
    const { live, reloaded } = await runAndReload({ message: 'What does my PDF say?', attachments: [{ kind: 'resource', resource_id: pdf.id }] });
    expect(live.sources?.[0]).toMatchObject({ handle: 'S1', kind: 'pdf', provider: 'resource', record: { key: `resource:${pdf.id}` } });
    expect(live.passages).toHaveLength(10);
    expect(reloaded.sources).toEqual(live.sources);
    expect(reloaded.passages).toEqual(live.passages);
    expect(shown(reloaded)).toEqual(shown(live));
  }, 30_000);

  it('resolves a handle an earlier turn registered, live and after a reload', async () => {
    const first = await runAndReload({ message: 'What does the literature say?' });
    const second = await runAndReload({ message: 'Remind me what you found earlier', after: first });
    // The second reply cites S1 and touched nothing: its own record has no sources.
    expect(second.live.content).toContain('[S1]');
    expect(second.live.sources).toBeUndefined();
    expect(second.reloaded.sources).toBeUndefined();
    // Read against the conversation's sources, the marker names the paper the first turn found.
    const liveKnown = conversationSources([first.live, second.live]);
    const reloadedKnown = conversationSources(second.branch);
    expect(citedOrder(second.reloaded.content, reloadedKnown)).toEqual(['S1']);
    expect(reloadedKnown).toEqual(liveKnown);
    expect(reloadedKnown.find((source) => source.handle === 'S1')?.record.csl.title).toBe('Switch Transformers: Scaling to Trillion Parameter Models with Simple and Efficient Sparsity');
    // Not against the reply's own, which would leave it as text.
    expect(citedOrder(second.reloaded.content, second.reloaded.sources ?? [])).toEqual([]);
  }, 40_000);
});
