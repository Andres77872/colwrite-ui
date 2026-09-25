import { uid } from '@/lib/uid';
import { buildUrl } from './api';

export class AgentSocketError extends Error {
  readonly code: string;
  readonly closeCode?: number;
  constructor(message: string, code = 'CONNECTION_LOST', closeCode?: number) {
    super(message);
    this.code = code;
    this.closeCode = closeCode;
    this.name = 'AgentSocketError';
  }
}

export type AgentSessionEvent = {
  type: 'event'; session_id: string; run_id: string; seq: number;
  event: string; data: Record<string, unknown>;
};

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function agentWebSocketUrl(): string {
  const url = new URL(buildUrl('/agent/ws'), window.location.href);
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  // Authentication belongs to the browser's HttpOnly cookie, never to the URL.
  return url.toString();
}

/** One connection. Its caller owns replay and never blindly repeats mutations. */
export class AgentSocket {
  private socket: WebSocket | null = null;
  private failure: AgentSocketError | null = null;
  private pending = new Map<string, { resolve: (value: unknown) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> }>();
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
        let message: unknown;
        try { message = JSON.parse(data); } catch { this.close(4000); return; }
        if (!isRecord(message)) { this.close(4000); return; }
        if (message.type === 'subscription.error' && isRecord(message.error)) {
          this.failure = new AgentSocketError(
            typeof message.error.message === 'string' ? message.error.message : 'The event subscription failed.',
            typeof message.error.code === 'string' ? message.error.code : 'unavailable',
          );
          this.close(4000);
          return;
        }
        if (message.type === 'event' && typeof message.session_id === 'string' &&
          typeof message.run_id === 'string' && Number.isSafeInteger(message.seq) && Number(message.seq) > 0 &&
          typeof message.event === 'string' && isRecord(message.data)) {
          this.onEvent(message as AgentSessionEvent);
          return;
        }
        if (message.type === 'event') { this.close(4000); return; }
        if (typeof message.id !== 'string') return;
        const pending = this.pending.get(message.id);
        if (!pending) return;
        this.pending.delete(message.id);
        clearTimeout(pending.timer);
        if (isRecord(message.error)) {
          pending.reject(new AgentSocketError(
            typeof message.error.message === 'string' ? message.error.message : 'The assistant request failed.',
            typeof message.error.code === 'string' ? message.error.code : 'ASSISTANT_ERROR',
          ));
        } else if ('result' in message) pending.resolve(message.result);
        else pending.reject(new AgentSocketError('Invalid assistant response.', 'INVALID_RESPONSE'));
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

  request<T = unknown>(method: string, params: Record<string, unknown>): Promise<T> {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
      return Promise.reject(new AgentSocketError('The assistant is reconnecting.'));
    }
    const id = uid();
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new AgentSocketError('The assistant request timed out.'));
        this.close();
      }, 20_000);
      this.pending.set(id, { resolve: (value) => resolve(value as T), reject, timer });
      try { this.socket!.send(JSON.stringify({ id, method, params })); }
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
