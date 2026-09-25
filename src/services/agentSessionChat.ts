import { uid } from '@/lib/uid';
import type { AgentChatOptions, AgentChatParams, AgentChatResult } from './agentChat';
import { ensureRefreshed, getRefreshGeneration } from './api';
import { AgentSocket, AgentSocketError, type AgentSessionEvent } from './agentSocket';
import { abortableSleep } from './retry';
import { dispatchAgentEvent, type SSEEventHandlers } from './streamParser';
import { emitRequireLogin } from './session';

export type AssistantSession = {
  id: string; document_id: string; chat_id: string | null; title: string;
  ephemeral: boolean | number; last_seq: number; active_run_id: string | null;
};
export type AssistantRun = {
  id: string; session_id: string; request_id: string;
  status: 'queued' | 'running' | 'cancelling' | 'completed' | 'failed' | 'cancelled' | 'interrupted';
  request: AgentChatParams;
};
export type AssistantSnapshot = { session: AssistantSession; run: AssistantRun | null };
export type ResumeAgentRun = { sessionId: string; runId?: string; requestId?: string };
function requestBody(params: AgentChatParams): Record<string, unknown> {
  const body: Record<string, unknown> = { message: params.message, document_id: params.document_id };
  for (const key of ['chat_id', 'thread_id', 'model', 'engine', 'mode', 'context'] as const) {
    if (params[key] != null) body[key] = params[key];
  }
  if (params.ephemeral) body.ephemeral = true;
  return body;
}

const terminalStates = new Set(['completed', 'failed', 'cancelled', 'interrupted']);

/** Look up durable work when returning to a conversation; authorization stays server-side. */
export async function findActiveAgentRun(documentId: string, chatId: string | null, signal?: AbortSignal): Promise<AssistantSnapshot | null> {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const observedGeneration = getRefreshGeneration();
    const client = new AgentSocket(() => {});
    const abort = () => client.close();
    signal?.addEventListener('abort', abort, { once: true });
    try {
      if (signal?.aborted) return null;
      await client.connect();
      const sessions = await client.request<AssistantSession[]>('sessions.list', {
        document_id: documentId, ...(chatId ? { chat_id: chatId } : {}), limit: 100,
      });
      const match = sessions.find((session) => session.active_run_id && session.chat_id === chatId);
      if (!match || signal?.aborted) return null;
      return await client.request<AssistantSnapshot>('sessions.get', { session_id: match.id });
    } catch (error) {
      if (signal?.aborted) return null;
      if (error instanceof AgentSocketError && (error.closeCode === 4401 || error.code === 'unauthorized') &&
          attempt === 0 && await ensureRefreshed(observedGeneration)) continue;
      throw error;
    } finally {
      signal?.removeEventListener('abort', abort);
      client.close();
    }
  }
  return null;
}

/** Resume subscriptions, never generation. Start commands keep a stable idempotency key. */
export async function streamAgentSession(
  params: AgentChatParams,
  handlers: SSEEventHandlers,
  opts: AgentChatOptions = {},
): Promise<AgentChatResult> {
  const createRequestId = uid();
  const runRequestId = opts.resume?.requestId ?? uid();
  let sessionId = opts.resume?.sessionId;
  let runId = opts.resume?.runId;
  let cursor = 0;
  let refreshed = false;
  let finished = false;
  let startMayHaveSucceeded = false;
  let result: AgentChatResult = { chatId: null, threadId: null, usage: null, terminal: null };
  const capturedHandlers: SSEEventHandlers = {
    ...handlers,
    onDone: (chatId, threadId, usage) => {
      result = { chatId, threadId, usage, terminal: result.terminal === 'error' ? 'error' : 'done' };
      handlers.onDone?.(chatId, threadId, usage);
    },
    onError: (code, message) => {
      result.terminal = 'error';
      handlers.onError?.(code, message);
    },
  };
  const shouldCancel = () => opts.signal?.aborted && (opts.signal.reason === 'cancel' || opts.abortBehavior !== 'detach');
  const consume = (event: AgentSessionEvent) => {
    if (event.session_id !== sessionId || event.seq <= cursor) return;
    cursor = event.seq;
    if (event.run_id !== runId || opts.signal?.aborted) return;
    if (event.event === 'run.status') {
      const status = String(event.data.status);
      if (terminalStates.has(status)) {
        finished = true;
        if (status !== 'completed' && result.terminal !== 'error') {
          capturedHandlers.onError?.(`AGENT_${status.toUpperCase()}`, status === 'cancelled'
            ? 'The assistant run was stopped.' : 'The assistant run was interrupted. Your saved work is available in the conversation.');
        }
        if (status === 'completed' && !result.terminal) {
          capturedHandlers.onError?.('INCOMPLETE_STREAM', 'The run completed without a final response. Reopen the conversation to check the saved result.');
        }
      } else {
        // `running` means the server picked the run up; the model is next.
        handlers.onStatus?.(status, status === 'queued' ? 'Waiting to start…'
          : status === 'cancelling' ? 'Stopping…' : 'Thinking…');
      }
    } else {
      dispatchAgentEvent(event.event, event.data, capturedHandlers);
    }
  };

  const maxAttempts = Math.max(1, opts.retry?.maxAttempts ?? 8);
  for (let attempt = 0; !finished; attempt += 1) {
    if (opts.signal?.aborted && !shouldCancel()) return result;
    if (opts.signal?.aborted && !startMayHaveSucceeded && !runId) return result;
    let wake!: () => void;
    const changed = new Promise<void>((resolve) => { wake = resolve; });
    const observedGeneration = getRefreshGeneration();
    const buffered: AgentSessionEvent[] = [];
    const client = new AgentSocket((event) => {
      if (!runId) {
        if (buffered.length >= 20_000) { client.close(); return; }
        buffered.push(event);
      } else {
        if (event.session_id === sessionId && event.seq > cursor + 1) { client.close(4000); return; }
        consume(event);
      }
      if (finished) wake();
    });
    const abort = () => wake();
    opts.signal?.addEventListener('abort', abort, { once: true });
    try {
      await client.connect();
      if (!sessionId) {
        // Reuse the durable session for an existing chat, preserving planning state.
        if (params.chat_id) {
          const sessions = await client.request<AssistantSession[]>('sessions.list', { document_id: params.document_id, chat_id: params.chat_id, limit: 1 });
          sessionId = sessions[0]?.id;
        }
        if (!sessionId) {
          const session = await client.request<AssistantSession>('sessions.create', {
            request_id: createRequestId, document_id: params.document_id,
            chat_id: params.chat_id ?? null, title: params.message.slice(0, 160) || 'New conversation',
            ephemeral: params.ephemeral === true,
          });
          sessionId = session.id;
        }
        const snapshot = await client.request<AssistantSnapshot>('sessions.get', { session_id: sessionId });
        // A new turn observes only its own events; a restored turn replays from zero.
        cursor = snapshot.session.last_seq;
      }
      await client.request('sessions.subscribe', { session_id: sessionId, after_seq: cursor });
      // The server accepted this socket's credentials, so a long run may
      // refresh again when this access token expires in turn.
      refreshed = false;
      if (!runId) {
        if (opts.signal?.aborted && !startMayHaveSucceeded) return result;
        // Keep a durable locator even if the acknowledgement is lost and all
        // reconnect attempts fail. A user retry must reuse this request ID.
        opts.onRunStarted?.({ sessionId, requestId: runRequestId });
        startMayHaveSucceeded = true;
        const run = await client.request<AssistantRun>('runs.start', { session_id: sessionId, request_id: runRequestId, request: requestBody(params) });
        runId = run.id;
        opts.onRunStarted?.({ sessionId, runId, requestId: runRequestId });
      }
      for (const event of buffered) {
        if (event.session_id === sessionId && event.seq > cursor + 1) {
          throw new AgentSocketError('Replaying missing assistant events.');
        }
        consume(event);
      }
      if (opts.signal?.aborted) {
        if (shouldCancel()) await client.request('runs.cancel', { session_id: sessionId, run_id: runId });
        return result;
      }
      if (!finished) {
        const outcome = await Promise.race([changed.then(() => null), client.closed]);
        if (outcome) throw outcome;
      }
      if (opts.signal?.aborted && shouldCancel()) {
        await client.request('runs.cancel', { session_id: sessionId, run_id: runId });
      }
      return result;
    } catch (error) {
      if (opts.signal?.aborted && !shouldCancel()) return result;
      const failure = error instanceof AgentSocketError ? error : null;
      if (failure?.closeCode === 4403 || failure?.closeCode === 1008 || failure?.code === 'forbidden') {
        throw new AgentSocketError('The assistant connection was denied. Check your access and the configured site origin.', 'forbidden');
      }
      if (failure?.closeCode === 4401 || failure?.code === 'unauthorized') {
        if (!refreshed && await ensureRefreshed(observedGeneration)) { refreshed = true; continue; }
        emitRequireLogin('expired');
        throw new AgentSocketError('Your session expired. Sign in again to resume the conversation.', 'unauthorized');
      }
      if (!failure || !['CONNECTION_LOST', 'unavailable'].includes(failure.code) || attempt + 1 >= maxAttempts) throw error;
      if (!opts.signal?.aborted) handlers.onStatus?.('reconnecting', 'Reconnecting to your saved run…');
      // Cancellation may need reconnection after an uncertain start acknowledgement.
      await abortableSleep(Math.min(10_000, (opts.retry?.baseDelayMs ?? 500) * 2 ** attempt), shouldCancel() ? undefined : opts.signal);
    } finally {
      opts.signal?.removeEventListener('abort', abort);
      client.close();
    }
  }
  return result;
}
