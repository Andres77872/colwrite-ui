import { attachmentRef } from './chatAttachments';
import { uid } from '@/lib/uid';
import type { AssistantSession, SessionSnapshot } from '@/api/schema';
import type { AgentChatOptions, AgentChatParams, AgentChatResult, AgentRunProfile } from './agentChat';
import { ensureRefreshed, getRefreshGeneration } from '@/api/session';
import { AgentCommandError, AgentSocket, AgentSocketError, type AgentRunRequest, type AgentSessionEvent } from './agentSocket';
import { abortableSleep } from '@/api/retry';
import { decodeAgentEvent, handleAgentEvent, type AgentEventHandlers } from './streamParser';
import { emitRequireLogin } from '@/api/authEvents';

export type { AssistantSession } from '@/api/schema';
export type AssistantSnapshot = SessionSnapshot;
/**
 * A run to observe again: its session, and once known its id, the request id
 * that started it, and the session's sequence when it was admitted
 * (`AssistantRun.after_seq`), which a reattach subscribes after so it
 * replays this run from its first event and nothing of the session's earlier
 * runs.
 */
export type ResumeAgentRun = { sessionId: string; runId?: string; requestId?: string; afterSeq?: number };
/** A fresh start was refused before admission, with no earlier uncertain send. */
export class AgentAdmissionRefused extends AgentSocketError {
  readonly locator: ResumeAgentRun;
  constructor(locator: ResumeAgentRun, error: AgentSocketError) {
    super(error.message, error.code, error.closeCode, error.retryable);
    this.locator = locator;
    this.name = 'AgentAdmissionRefused';
  }
}
/** Admit a new generation from a saved checkpoint. The request id belongs to
 * this resume action and must survive an uncertain acknowledgement. */
export type CheckpointResume = { sessionId: string; runId: string; requestId: string };

/** The run's profile: `chat` unless the caller asked for an inline run. */
function profileOf(params: AgentChatParams): AgentRunProfile {
  return params.profile ?? 'chat';
}

/**
 * The run's request. Only what the turn sets is sent; the server defaults
 * the rest. An inline run resumes no chat and applies nothing by itself, so
 * it never carries `chat_id`, `leaf_id` or `apply_mode: "auto"`, which the
 * server refuses for it.
 */
function requestBody(params: AgentChatParams): AgentRunRequest {
  const profile = profileOf(params);
  const body: AgentRunRequest = { message: params.message, document_id: params.document_id };
  if (profile !== 'chat') body.profile = profile;
  if (profile === 'review' && params.review != null) body.review = params.review;
  if (profile !== 'review' && params.preset != null) body.preset = params.preset;
  if (params.effort != null) body.effort = params.effort;
  if (params.web !== undefined) body.web = params.web;
  if (profile === 'chat' && params.plan_id != null) body.plan_id = params.plan_id;
  if (profile === 'chat' && params.plan != null) body.plan = params.plan;
  if (profile === 'chat' && params.answers != null) body.answers = params.answers;
  if (profile === 'chat' && params.chat_id != null) body.chat_id = params.chat_id;
  if (profile === 'chat' && params.leaf_id != null) body.leaf_id = params.leaf_id;
  if (params.model != null) body.model = params.model;
  if (params.gateway_models != null) body.gateway_models = params.gateway_models;
  if (params.engine != null) body.engine = params.engine;
  if (profile !== 'review' && params.context != null) body.context = params.context;
  if (profile === 'chat' && params.apply_mode === 'auto') body.apply_mode = 'auto';
  if (profile !== 'review' && params.attachments?.length) body.attachments = params.attachments.map(attachmentRef);
  return body;
}

const terminalStates = new Set(['completed', 'failed', 'cancelled', 'interrupted']);

/** The session list's name for a conversation: its first message, within the server's 160 characters. */
function sessionTitle(message: string): string | undefined {
  const line = message.trim().split('\n', 1)[0]?.trim() ?? '';
  return line ? line.slice(0, 160) : undefined;
}

/** Look up durable work when returning to a conversation; authorization stays server-side. */
export async function findActiveAgentRun(
  workspaceId: string,
  documentId: string,
  chatId: string | null,
  signal?: AbortSignal,
): Promise<AssistantSnapshot | null> {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const observedGeneration = getRefreshGeneration();
    const client = new AgentSocket(() => {});
    const abort = () => client.close();
    signal?.addEventListener('abort', abort, { once: true });
    try {
      if (signal?.aborted) return null;
      await client.connect();
      const sessions: AssistantSession[] = await client.request('sessions.list', {
        workspace_id: workspaceId, document_id: documentId, ...(chatId ? { chat_id: chatId } : {}), limit: 100,
      });
      const match = sessions.find((session) => session.profile === 'chat' && session.active_run_id && session.chat_id === chatId);
      if (!match || signal?.aborted) return null;
      return await client.request('sessions.get', { workspace_id: workspaceId, session_id: match.id });
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

/** Start, observe, or resume a checkpoint. Every generation command keeps one
 * idempotency key across reconnections; observing never starts generation. */
export async function streamAgentSession(
  params: AgentChatParams,
  handlers: AgentEventHandlers,
  opts: AgentChatOptions = {},
): Promise<AgentChatResult> {
  const createRequestId = uid();
  const runRequestId = opts.checkpoint?.requestId ?? opts.resume?.requestId ?? uid();
  let sessionId = opts.checkpoint?.sessionId ?? opts.resume?.sessionId;
  let runId = opts.resume?.runId;
  let cursor = opts.resume?.runId ? opts.resume.afterSeq ?? 0 : 0;
  let refreshed = false;
  let finished = false;
  let startMayHaveSucceeded = false;
  let admissionCertain = !opts.resume && !opts.checkpoint;
  let reconnecting = false;
  const workspaceId = params.workspace_id;
  let result: AgentChatResult = { done: null, terminal: null };
  const capturedHandlers: AgentEventHandlers = {
    ...handlers,
    onDone: (done) => {
      result = { done, terminal: result.terminal === 'error' ? 'error' : 'done' };
      handlers.onDone?.(done);
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
    const decoded = decodeAgentEvent(event.event, event.data);
    if (!decoded) return;
    if (decoded.event === 'run.status') {
      const status = decoded.data.status;
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
      handleAgentEvent(decoded, capturedHandlers);
    }
  };

  const maxAttempts = Math.max(1, opts.retry?.maxAttempts ?? 8);
  for (let attempt = 0; !finished; attempt += 1) {
    if (opts.signal?.aborted && !shouldCancel()) return result;
    if (opts.signal?.aborted && !startMayHaveSucceeded && !runId) return result;
    const cursorAtConnect = cursor;
    let wake!: () => void;
    const changed = new Promise<void>((resolve) => { wake = resolve; });
    const observedGeneration = getRefreshGeneration();
    const buffered: AgentSessionEvent[] = [];
    let subscribed = false;
    const client = new AgentSocket((event) => {
      if (!runId || (opts.checkpoint && !subscribed)) {
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
        try {
          // Reuse the durable session for an existing chat, preserving planning state.
          if (profileOf(params) === 'chat' && params.chat_id) {
            const sessions = await client.request('sessions.list', {
              workspace_id: workspaceId, document_id: params.document_id, chat_id: params.chat_id, limit: 1,
            });
            sessionId = sessions[0]?.id;
          }
          if (!sessionId) {
            const title = sessionTitle(params.message);
            const session = await client.request('sessions.create', {
              workspace_id: workspaceId, request_id: createRequestId, document_id: params.document_id,
              // A session's runs share its profile; an inline one has no chat.
              chat_id: profileOf(params) === 'chat' ? params.chat_id ?? null : null, profile: profileOf(params),
              ...(title ? { title } : {}),
            });
            sessionId = session.id;
          }
        } catch (error) {
          // The chat was deleted somewhere else. Reported with the code the
          // caller already recovers from, by starting a new conversation;
          // as a thrown command error it was a dead end.
          if (params.chat_id && error instanceof AgentSocketError && error.code === 'chat_not_found') {
            capturedHandlers.onError?.('CHAT_NOT_FOUND', error.message);
            return result;
          }
          throw error;
        }
        const snapshot = await client.request('sessions.get', { workspace_id: workspaceId, session_id: sessionId });
        cursor = snapshot.session.last_seq;
      }
      if (!runId && opts.resume?.requestId) {
        // An acknowledgement may have been lost before unmount. Resolve its
        // exact action first, without replaying replacement engine/model fields.
        // A different/latest action is not proof that this one never ran.
        const snapshot = await client.request('sessions.get', { workspace_id: workspaceId, session_id: sessionId });
        if (snapshot.run?.request_id === runRequestId) {
          runId = snapshot.run.id;
          cursor = snapshot.run.after_seq;
          opts.onRunStarted?.({ sessionId, runId, requestId: runRequestId, afterSeq: cursor }, snapshot.run.request);
        }
      }
      if (opts.checkpoint && !runId) {
        if (opts.signal?.aborted && !startMayHaveSucceeded) return result;
        opts.onRunStarted?.({ sessionId, requestId: runRequestId });
        startMayHaveSucceeded = true;
        const run = await client.request('runs.resume', {
          workspace_id: workspaceId, session_id: sessionId, run_id: opts.checkpoint.runId, request_id: runRequestId,
        });
        runId = run.id;
        // Admission is authoritative, including an idempotent acknowledgement
        // of a run that finished while this browser was disconnected. The
        // session's latest sequence would skip that saved answer.
        cursor = run.after_seq;
        opts.onRunStarted?.({ sessionId, runId, requestId: runRequestId, afterSeq: run.after_seq });
      }
      await client.request('sessions.subscribe', { workspace_id: workspaceId, session_id: sessionId, after_seq: cursor });
      // The server accepted this socket's credentials, so a long run may
      // refresh again when this access token expires in turn.
      refreshed = false;
      if (reconnecting) {
        reconnecting = false;
        if (!opts.signal?.aborted) handlers.onStatus?.('reconnected', 'Working…');
      }
      if (!runId) {
        if (opts.signal?.aborted && !startMayHaveSucceeded) return result;
        opts.onRunStarted?.({ sessionId, requestId: runRequestId });
        startMayHaveSucceeded = true;
        const run = await client.request('runs.start', {
          workspace_id: workspaceId, session_id: sessionId, request_id: runRequestId, request: requestBody(params),
        });
        runId = run.id;
        opts.onRunStarted?.({ sessionId, runId, requestId: runRequestId, afterSeq: run.after_seq });
      }
      for (const event of buffered) {
        if (event.session_id === sessionId && event.seq > cursor + 1) {
          throw new AgentSocketError('Replaying missing assistant events.');
        }
        consume(event);
      }
      subscribed = true;
      if (opts.signal?.aborted) {
        if (shouldCancel()) await client.request('runs.cancel', { workspace_id: workspaceId, session_id: sessionId, run_id: runId });
        return result;
      }
      if (!finished) {
        const outcome = await Promise.race([changed.then(() => null), client.closed]);
        if (outcome) throw outcome;
      }
      if (opts.signal?.aborted && shouldCancel()) {
        await client.request('runs.cancel', { workspace_id: workspaceId, session_id: sessionId, run_id: runId });
      } else if (finished && profileOf(params) === 'inline') {
        // A one-shot session is listed nowhere, so nobody else deletes it.
        // The server also expires them; this keeps a busy day of Ask AI from
        // filling the account's session and replay limits in the meantime.
        const removed = client.request('sessions.delete', { workspace_id: workspaceId, session_id: sessionId }).catch(() => undefined);
        await Promise.race([removed, new Promise((resolve) => setTimeout(resolve, 2_000))]);
      }
      return result;
    } catch (error) {
      if (opts.signal?.aborted && !shouldCancel()) return result;
      const failure = error instanceof AgentSocketError ? error : null;
      // These command failures precede insertion in AssistantStore.create_run
      // and request validation. A generic error or a failed replay does not
      // prove absence: a prior unacknowledged send may still have committed.
      const refused = !runId && startMayHaveSucceeded && error instanceof AgentCommandError
        && error.method === 'runs.start' && (error.code === 'invalid_request' || error.code === 'limit_exceeded');
      const certainlyRefused = admissionCertain && refused;
      if (startMayHaveSucceeded && !refused) admissionCertain = false;
      if (failure?.closeCode === 4403 || failure?.closeCode === 1008 || failure?.code === 'forbidden') {
        throw new AgentSocketError('The assistant connection was denied. Check your access and the configured site origin.', 'forbidden');
      }
      if (failure?.closeCode === 4401 || failure?.code === 'unauthorized') {
        if (!refreshed && await ensureRefreshed(observedGeneration)) { refreshed = true; continue; }
        emitRequireLogin('expired');
        throw new AgentSocketError('Your session expired. Sign in again to resume the conversation.', 'unauthorized');
      }
      // The limit is on consecutive failures. A run of an hour can lose its
      // connection many times; counting every loss ended the stream on the
      // eighth one however well each reconnect had gone.
      if (cursor > cursorAtConnect) attempt = 0;
      if (!failure?.retryable || attempt + 1 >= maxAttempts) {
        if (certainlyRefused && sessionId && failure) {
          throw new AgentAdmissionRefused({ sessionId, requestId: runRequestId }, failure);
        }
        throw error;
      }
      reconnecting = true;
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
