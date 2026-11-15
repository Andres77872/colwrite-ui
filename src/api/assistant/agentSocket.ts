import { resolveApiPath } from '@/api/url';
import { isUnknownRecord } from '@/lib/json';
import { uid } from '@/lib/uid';
import type {
  AgentChatRequestInput,
  AgentContext,
  AssistantClientMessage,
  AssistantServerMessage,
  ErrorBody,
  GatewayModelSelection,
  RunRef,
  RunStart,
  SessionCreate,
  SessionList,
  SessionRef,
  Subscribe,
} from '@/api/schema';

/**
 * A failed connection or command. A command failure carries the server's
 * error `code` and `retryable` (`ColWrite-api/docs/errors.md`); a lost
 * connection is `CONNECTION_LOST`, which reconnecting can always fix.
 */
export class AgentSocketError extends Error {
  readonly code: string;
  readonly retryable: boolean;
  readonly closeCode?: number;
  constructor(message: string, code = 'CONNECTION_LOST', closeCode?: number, retryable = code === 'CONNECTION_LOST') {
    super(message);
    this.code = code;
    this.retryable = retryable;
    this.closeCode = closeCode;
    this.name = 'AgentSocketError';
  }
}

/* ----------------------------------------
   The contract (`AssistantClientMessage`, `AssistantServerMessage`)
   ---------------------------------------- */

export type AssistantMethod = AssistantClientMessage['method'];

/**
 * A run's request as this client sends it. The generated type marks every
 * field with a server default as required; leaving one out means the
 * default, which is not always the same as sending it (an omitted `chat_id`
 * resumes the session's chat).
 */
export type AgentRunRequest = Pick<AgentChatRequestInput, 'document_id'>
  & Partial<Omit<AgentChatRequestInput, 'context' | 'gateway_models'>>
  & { context?: Partial<AgentContext>; gateway_models?: Partial<GatewayModelSelection> };

/**
 * Each command's `params`, with the fields the server defaults left
 * optional. Every command but `ping` names its workspace.
 */
export type CommandParams = {
  ping: Record<string, never>;
  'sessions.create': Pick<SessionCreate, 'workspace_id' | 'document_id'> & Partial<SessionCreate>;
  'sessions.list': Pick<SessionList, 'workspace_id' | 'document_id'> & Partial<SessionList>;
  'sessions.get': SessionRef;
  'sessions.delete': SessionRef;
  'sessions.subscribe': Pick<Subscribe, 'workspace_id' | 'session_id'> & Partial<Subscribe>;
  'sessions.unsubscribe': SessionRef;
  'runs.start': Omit<RunStart, 'request'> & { request: AgentRunRequest };
  'runs.cancel': RunRef;
};

/** A reply: `method` repeats the command's and fixes the shape of `result`. */
type Reply = Extract<AssistantServerMessage, { method: string; result: unknown }>;

/** What each command answers, from the reply that carries its method. */
export type CommandResults = { [M in AssistantMethod]: Extract<Reply, { method: M }>['result'] };

/** Fails to compile when the contract gains or loses a method `CommandParams` does not list. */
type Assert<T extends true> = T;
type ListsEveryMethod<T> = [Exclude<keyof T, AssistantMethod>] extends [never]
  ? T extends Record<AssistantMethod, unknown> ? true : false
  : false;
export type CommandContract = [Assert<ListsEveryMethod<CommandParams>>];

/** One command on the wire: `AssistantClientMessage` for that method. */
type Command<M extends AssistantMethod> = { id: string; method: M; params: CommandParams[M] };

/**
 * One event of a session's log, as the socket delivers it. Its `event` and
 * `data` are read by `decodeAgentEvent` into the generated `AssistantEvent`.
 */
export type AgentSessionEvent = {
  type: 'event';
  session_id: string;
  run_id: string;
  seq: number;
  event: string;
  data: Record<string, unknown>;
};

type SubscriptionFailure = { type: 'subscription.error'; session_id: string; error: ErrorBody };
type CommandOutcome =
  | { id: string | null; error: ErrorBody }
  | { id: string; method: string; result: unknown };

/** A frame as this client reads it. */
export type ServerFrame = AgentSessionEvent | SubscriptionFailure | CommandOutcome;

/** The server's `error` body, read defensively: it is untrusted like any frame. */
function errorBody(value: unknown): Pick<ErrorBody, 'message' | 'retryable'> & { code: string } | null {
  if (!isUnknownRecord(value)) return null;
  return {
    code: typeof value.code === 'string' ? value.code : '',
    message: typeof value.message === 'string' ? value.message : '',
    retryable: value.retryable === true,
  };
}

/**
 * One decoded frame, as `AssistantServerMessage` describes it, or `null` for
 * one that matches none of its members. Only the fields this client relies on
 * are checked; a reply's `method` is matched to its command by the caller.
 */
export function parseServerMessage(raw: unknown): ServerFrame | null {
  if (!isUnknownRecord(raw)) return null;
  if (raw.type === 'event') {
    if (typeof raw.session_id !== 'string' || typeof raw.run_id !== 'string') return null;
    if (!Number.isSafeInteger(raw.seq) || Number(raw.seq) <= 0) return null;
    if (typeof raw.event !== 'string' || !isUnknownRecord(raw.data)) return null;
    return {
      type: 'event',
      session_id: raw.session_id,
      run_id: raw.run_id,
      seq: Number(raw.seq),
      event: raw.event,
      data: raw.data,
    };
  }
  if (raw.type === 'subscription.error') {
    const error = errorBody(raw.error);
    if (!error) return null;
    return {
      type: 'subscription.error',
      session_id: typeof raw.session_id === 'string' ? raw.session_id : '',
      error: error as ErrorBody,
    };
  }
  if (raw.type !== undefined) return null;
  if (raw.id !== null && typeof raw.id !== 'string') return null;
  const error = errorBody(raw.error);
  if (error) return { id: raw.id, error: error as ErrorBody };
  if (typeof raw.id === 'string' && typeof raw.method === 'string' && 'result' in raw) {
    return { id: raw.id, method: raw.method, result: raw.result };
  }
  return null;
}

function socketError(
  error: { code: string; message: string; retryable: boolean },
  fallbackMessage: string,
  fallbackCode: string,
): AgentSocketError {
  return new AgentSocketError(error.message || fallbackMessage, error.code || fallbackCode, undefined, error.retryable);
}

export function agentWebSocketUrl(): string {
  const url = new URL(resolveApiPath('/api/agent/ws'), window.location.href);
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  // Authentication belongs to the browser's HttpOnly cookie, never to the URL.
  return url.toString();
}

/** One connection. Its caller owns replay and never blindly repeats mutations. */
export class AgentSocket {
  private socket: WebSocket | null = null;
  private failure: AgentSocketError | null = null;
  private pending = new Map<string, {
    method: AssistantMethod;
    resolve: (value: unknown) => void;
    reject: (error: Error) => void;
    timer: ReturnType<typeof setTimeout>;
  }>();
  private heartbeat: ReturnType<typeof setInterval> | undefined;
  private resolveClosed!: (error: AgentSocketError) => void;
  readonly closed = new Promise<AgentSocketError>((resolve) => { this.resolveClosed = resolve; });

  private readonly onEvent: (event: AgentSessionEvent) => void;
  constructor(onEvent: (event: AgentSessionEvent) => void) { this.onEvent = onEvent; }

  connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      const socket = new WebSocket(agentWebSocketUrl());
      this.socket = socket;
      let opened = false;
      const timeout = setTimeout(() => {
        reject(new AgentSocketError('The assistant connection timed out.'));
        this.close();
      }, 15_000);
      socket.onopen = () => {
        opened = true;
        clearTimeout(timeout);
        this.heartbeat = setInterval(() => {
          void this.request('ping', {}).catch(() => this.close());
        }, 20_000);
        resolve();
      };
      socket.onmessage = ({ data }: MessageEvent<unknown>) => {
        if (typeof data !== 'string' || data.length > 8_000_000) { this.close(4000); return; }
        let raw: unknown;
        try { raw = JSON.parse(data); } catch { this.close(4000); return; }
        const message = parseServerMessage(raw);
        if (!message) {
          // An event the client cannot read is a gap in the log.
          if (!isUnknownRecord(raw) || raw.type !== undefined) { this.close(4000); return; }
          const pending = typeof raw.id === 'string' ? this.pending.get(raw.id) : undefined;
          if (pending && typeof raw.id === 'string') {
            this.pending.delete(raw.id);
            clearTimeout(pending.timer);
            pending.reject(new AgentSocketError('Invalid assistant response.', 'INVALID_RESPONSE'));
          }
          return;
        }
        if ('type' in message) {
          if (message.type === 'subscription.error') {
            this.failure = socketError(message.error, 'The event subscription failed.', 'unavailable');
            this.close(4000);
            return;
          }
          this.onEvent(message);
          return;
        }
        if (message.id === null) return;
        const pending = this.pending.get(message.id);
        if (!pending) return;
        this.pending.delete(message.id);
        clearTimeout(pending.timer);
        if ('error' in message) {
          pending.reject(socketError(message.error, 'The assistant request failed.', 'ASSISTANT_ERROR'));
        } else if (message.method !== pending.method) {
          pending.reject(new AgentSocketError('Invalid assistant response.', 'INVALID_RESPONSE'));
        } else {
          pending.resolve(message.result);
        }
      };
      socket.onerror = () => { /* onclose rejects commands and drives reconnect */ };
      socket.onclose = (event) => {
        clearTimeout(timeout);
        clearInterval(this.heartbeat);
        const error = this.failure ?? new AgentSocketError('The assistant connection was interrupted.', 'CONNECTION_LOST', event.code);
        if (!opened) reject(error);
        for (const pending of this.pending.values()) {
          clearTimeout(pending.timer);
          pending.reject(error);
        }
        this.pending.clear();
        this.resolveClosed(error);
      };
    });
  }

  request<M extends AssistantMethod>(method: M, params: CommandParams[M]): Promise<CommandResults[M]> {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
      return Promise.reject(new AgentSocketError('The assistant is reconnecting.'));
    }
    const id = uid();
    const command: Command<M> = { id, method, params };
    return new Promise<CommandResults[M]>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new AgentSocketError('The assistant request timed out.'));
        this.close();
      }, 20_000);
      this.pending.set(id, { method, resolve: (value) => resolve(value as CommandResults[M]), reject, timer });
      try { this.socket!.send(JSON.stringify(command)); }
      catch (error) {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(error);
      }
    });
  }

  close(code = 1000): void {
    clearInterval(this.heartbeat);
    this.socket?.close(code);
  }
}
