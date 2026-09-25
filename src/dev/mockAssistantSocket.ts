/** Dev-preview-only assistant transport. The log survives observer disconnects. */
import { uid } from '@/lib/uid';

type Json = Record<string, unknown>;
type RunStatus = 'queued' | 'running' | 'cancelling' | 'completed' | 'failed' | 'cancelled';
type MockRun = {
  id: string; session_id: string; request_id: string; request: Json; fingerprint: string;
  status: RunStatus; event_count: number; event_bytes: number; created_at: string;
  reader?: ReadableStreamDefaultReader<Uint8Array>;
};
type Session = {
  id: string; document_id: string; chat_id: string | null; title: string; ephemeral: boolean;
  request_id: string | null; last_seq: number; active_run_id: string | null;
  created_at: string; updated_at: string;
};
type SessionEvent = { type: 'event'; session_id: string; run_id: string; seq: number; event: string; data: Json };
type StoredSession = { session: Session; events: SessionEvent[]; runs: MockRun[]; fingerprint: string };
export type MockAssistantOptions = {
  stream: (request: Json) => Response | Promise<Response>;
  documentExists?: (id: string) => boolean;
  enabledFeatures?: () => Promise<string[]>;
};

const terminal = new Set<RunStatus>(['completed', 'failed', 'cancelled']);
const record = (value: unknown): value is Json => typeof value === 'object' && value !== null && !Array.isArray(value);
const copy = <T,>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
const publicRun = (run: MockRun): Json => {
  const { reader: _reader, fingerprint: _fingerprint, ...row } = run;
  return copy(row);
};
function fingerprint(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(fingerprint).join(',')}]`;
  if (record(value)) return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${fingerprint(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
}
class RpcError extends Error {
  readonly code: string;
  constructor(code: string, message: string) { super(message); this.code = code; }
}
function text(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new RpcError('invalid_params', `${label} is required`);
  return value;
}

/** Installs only /api/agent/ws; Vite HMR and every other socket stay native. */
export function installMockAssistantSocket(options: MockAssistantOptions): () => void {
  const NativeSocket = window.WebSocket;
  const sessions = new Map<string, StoredSession>();
  const sockets = new Set<PreviewSocket>();
  const timers = new Set<ReturnType<typeof setTimeout>>();
  let disposed = false;

  const sessionFor = (id: unknown): StoredSession => {
    const value = sessions.get(text(id, 'session_id'));
    if (!value) throw new RpcError('not_found', 'Assistant session not found');
    return value;
  };
  const append = (stored: StoredSession, run: MockRun, event: string, data: Json) => {
    const envelope: SessionEvent = { type: 'event', session_id: stored.session.id, run_id: run.id,
      seq: ++stored.session.last_seq, event, data: copy(data) };
    stored.session.updated_at = new Date().toISOString();
    stored.events.push(envelope);
    run.event_count += 1;
    run.event_bytes += JSON.stringify(data).length;
    for (const socket of sockets) socket.replay(stored);
  };
  const finish = (stored: StoredSession, run: MockRun, status: RunStatus) => {
    if (terminal.has(run.status)) return;
    run.status = status;
    stored.session.active_run_id = null;
    append(stored, run, 'run.status', { run_id: run.id, status });
  };

  async function execute(stored: StoredSession, run: MockRun): Promise<void> {
    if (disposed || run.status !== 'queued') return;
    run.status = 'running';
    append(stored, run, 'run.status', { run_id: run.id, status: run.status });
    let sawTerminal = false;
    const live = () => !disposed && run.status === 'running';
    try {
      const features = await options.enabledFeatures?.() ?? [];
      if (!live()) return;
      const plan = features.includes('todos') && !stored.session.ephemeral;
      const worker = features.includes('subagents') && !stored.session.ephemeral;
      const workerId = `preview-worker-${run.id}`;
      const items = [
        { id: 'preview-review', content: 'Review the fixture evidence (preview)', status: 'in_progress' },
        { id: 'preview-synthesis', content: 'Summarize the fixture findings', status: 'pending' },
      ];
      if (plan) append(stored, run, 'todo', { items });
      if (worker) append(stored, run, 'subagent', { id: workerId, status: 'running', engine: run.request.engine ?? 'legacy' });
      const response = await options.stream(run.request);
      if (!response.ok || !response.body) throw new Error('Preview stream unavailable');
      run.reader = response.body.getReader();
      if (!live()) { await run.reader.cancel(); return; }
      const decoder = new TextDecoder();
      let buffer = '';
      while (live()) {
        const { value, done } = await run.reader.read();
        if (!live()) break;
        buffer += decoder.decode(value, { stream: !done });
        let boundary: number;
        while ((boundary = buffer.indexOf('\n\n')) >= 0 && live()) {
          const frame = buffer.slice(0, boundary);
          buffer = buffer.slice(boundary + 2);
          const lines = frame.split('\n');
          const event = lines.find((line) => line.startsWith('event:'))?.slice(6).trim();
          const raw = lines.filter((line) => line.startsWith('data:')).map((line) => line.slice(5).trimStart()).join('\n');
          if (!event || !raw) continue;
          const data: unknown = JSON.parse(raw);
          if (!record(data)) throw new Error('Invalid preview event');
          if (event === 'session.chat' && typeof data.chat_id === 'string') stored.session.chat_id = data.chat_id;
          if (event === 'done') {
            if (typeof data.chat_id === 'string') {
              stored.session.chat_id = data.chat_id;
              append(stored, run, 'session.chat', { chat_id: data.chat_id });
            }
            if (plan) append(stored, run, 'todo', { items: items.map((item) => ({ ...item, status: 'completed' })) });
            if (worker) append(stored, run, 'subagent', { id: workerId, status: 'completed', engine: run.request.engine ?? 'legacy' });
          }
          append(stored, run, event, data);
          if (event === 'done' || event === 'error') {
            sawTerminal = true;
            finish(stored, run, event === 'done' ? 'completed' : 'failed');
          }
        }
        if (done) break;
      }
      if (live() && !sawTerminal) throw new Error('Preview stream stopped before completion');
    } catch {
      if (live()) {
        append(stored, run, 'error', { error_code: 'PREVIEW_STREAM_ERROR', message: 'The fixture assistant stream could not finish.' });
        finish(stored, run, 'failed');
      }
    } finally {
      if (run.reader) {
        await run.reader.cancel().catch(() => {});
        run.reader.releaseLock();
        run.reader = undefined;
      }
    }
  }

  function dispatch(socket: PreviewSocket, method: string, params: Json): unknown {
    if (method === 'ping') return { time: Date.now() / 1000 };
    if (method === 'sessions.create') {
      const documentId = text(params.document_id, 'document_id');
      if (options.documentExists && !options.documentExists(documentId)) throw new RpcError('not_found', 'Document not found');
      const normalized = { document_id: documentId, chat_id: typeof params.chat_id === 'string' ? params.chat_id : null,
        title: typeof params.title === 'string' && params.title ? params.title : 'New conversation', ephemeral: params.ephemeral === true };
      if (normalized.ephemeral && normalized.chat_id) throw new RpcError('invalid_params', 'Ephemeral sessions cannot resume a chat');
      const requestId = typeof params.request_id === 'string' ? params.request_id : null;
      const hash = fingerprint(normalized);
      const existing = requestId && [...sessions.values()].find((row) => row.session.request_id === requestId);
      if (existing) {
        if (existing.fingerprint !== hash) throw new RpcError('conflict', 'Session request_id already used for different parameters');
        return copy(existing.session);
      }
      const now = new Date().toISOString();
      const session: Session = { id: uid(), ...normalized, request_id: requestId, last_seq: 0, active_run_id: null, created_at: now, updated_at: now };
      sessions.set(session.id, { session, events: [], runs: [], fingerprint: hash });
      return copy(session);
    }
    if (method === 'sessions.list') {
      const documentId = text(params.document_id, 'document_id');
      return [...sessions.values()].map((row) => row.session)
        .filter((row) => row.document_id === documentId && !row.ephemeral && (!params.chat_id || row.chat_id === params.chat_id))
        .sort((a, b) => b.updated_at.localeCompare(a.updated_at) || b.id.localeCompare(a.id))
        .slice(0, typeof params.limit === 'number' ? Math.max(1, Math.min(100, params.limit)) : 50).map(copy);
    }
    const stored = sessionFor(params.session_id);
    if (method === 'sessions.get') return { session: copy(stored.session), run: stored.runs.length ? publicRun(stored.runs[stored.runs.length - 1]) : null };
    if (method === 'sessions.delete') {
      if (stored.session.active_run_id) throw new RpcError('conflict', 'Stop the active run before deleting its session');
      sessions.delete(stored.session.id);
      return { deleted: true };
    }
    if (method === 'sessions.subscribe' || method === 'sessions.unsubscribe') {
      const after = params.after_seq ?? 0;
      if (typeof after !== 'number' || !Number.isSafeInteger(after) || after < 0 || after > stored.session.last_seq) throw new RpcError('invalid_cursor', 'Replay cursor is outside this session');
      if (method === 'sessions.unsubscribe') socket.subscriptions.delete(stored.session.id);
      else {
        socket.subscriptions.set(stored.session.id, after);
        queueMicrotask(() => socket.replay(stored));
      }
      return { subscribed: method === 'sessions.subscribe' };
    }
    if (method === 'runs.start') {
      const requestId = text(params.request_id, 'request_id');
      if (!record(params.request)) throw new RpcError('invalid_params', 'request must be an object');
      const request = params.request;
      text(request.message, 'message');
      const hash = fingerprint(request);
      const previous = stored.runs.find((run) => run.request_id === requestId);
      if (previous) {
        if (previous.fingerprint !== hash) throw new RpcError('conflict', 'Run request_id already used for a different request');
        return publicRun(previous);
      }
      if (request.document_id !== stored.session.document_id || (request.ephemeral === true) !== stored.session.ephemeral ||
        (request.chat_id != null && request.chat_id !== stored.session.chat_id)) throw new RpcError('invalid_params', 'Run context does not match the assistant session');
      if (stored.session.active_run_id || (stored.session.chat_id && [...sessions.values()].some((row) => row.session.chat_id === stored.session.chat_id && row.session.active_run_id))) throw new RpcError('conflict', 'A run is already active in this conversation');
      const run: MockRun = { id: uid(), session_id: stored.session.id, request_id: requestId,
        request: { ...copy(request), chat_id: stored.session.chat_id }, fingerprint: hash, status: 'queued', event_count: 0, event_bytes: 0, created_at: new Date().toISOString() };
      stored.runs.push(run);
      stored.session.active_run_id = run.id;
      append(stored, run, 'run.status', { run_id: run.id, status: 'queued' });
      const timer = setTimeout(() => { timers.delete(timer); void execute(stored, run); }, 0);
      timers.add(timer);
      return publicRun(run);
    }
    if (method === 'runs.cancel') {
      const run = stored.runs.find((entry) => entry.id === params.run_id);
      if (!run) throw new RpcError('not_found', 'Assistant run not found');
      if (!terminal.has(run.status)) {
        if (run.status === 'running') {
          run.status = 'cancelling';
          append(stored, run, 'run.status', { run_id: run.id, status: 'cancelling' });
        }
        finish(stored, run, 'cancelled');
        void run.reader?.cancel().catch(() => {});
      }
      return publicRun(run);
    }
    throw new RpcError('method_not_found', 'Unknown assistant command');
  }

  class PreviewSocket extends EventTarget {
    readonly url: string;
    readonly protocol = '';
    readonly extensions = '';
    readonly bufferedAmount = 0;
    binaryType: BinaryType = 'blob';
    readyState: number = NativeSocket.CONNECTING;
    onopen: WebSocket['onopen'] = null;
    onmessage: WebSocket['onmessage'] = null;
    onerror: WebSocket['onerror'] = null;
    onclose: WebSocket['onclose'] = null;
    readonly subscriptions = new Map<string, number>();
    constructor(url: string) {
      super();
      this.url = url;
      sockets.add(this);
      queueMicrotask(() => {
        if (this.readyState !== NativeSocket.CONNECTING) return;
        this.readyState = NativeSocket.OPEN;
        const event = new Event('open');
        this.dispatchEvent(event);
        this.onopen?.call(this as unknown as WebSocket, event);
      });
    }
    deliver(payload: unknown) {
      if (this.readyState !== NativeSocket.OPEN) return;
      const event = new MessageEvent('message', { data: JSON.stringify(payload) });
      this.dispatchEvent(event);
      this.onmessage?.call(this as unknown as WebSocket, event);
    }
    replay(stored: StoredSession) {
      let cursor = this.subscriptions.get(stored.session.id);
      if (cursor === undefined || this.readyState !== NativeSocket.OPEN) return;
      for (const event of stored.events) {
        if (event.seq <= cursor) continue;
        this.subscriptions.set(stored.session.id, event.seq);
        cursor = event.seq;
        this.deliver(event);
      }
    }
    send(raw: string | ArrayBufferLike | Blob | ArrayBufferView) {
      if (this.readyState !== NativeSocket.OPEN) throw new DOMException('Socket is not open', 'InvalidStateError');
      queueMicrotask(() => {
        if (this.readyState !== NativeSocket.OPEN) return;
        let id: unknown = null;
        try {
          if (typeof raw !== 'string') throw new RpcError('invalid_params', 'JSON text commands are required');
          const command: unknown = JSON.parse(raw);
          if (!record(command)) throw new RpcError('invalid_params', 'Invalid assistant command');
          id = command.id;
          const method = text(command.method, 'method');
          if (!record(command.params)) throw new RpcError('invalid_params', 'params must be an object');
          this.deliver({ id, result: dispatch(this, method, command.params) });
        } catch (error) {
          this.deliver({ id, error: { code: error instanceof RpcError ? error.code : 'invalid_params', message: error instanceof Error ? error.message : 'Invalid assistant command' } });
        }
      });
    }
    close(code = 1000, reason = '') {
      if (this.readyState === NativeSocket.CLOSED) return;
      this.readyState = NativeSocket.CLOSED;
      this.subscriptions.clear();
      sockets.delete(this);
      // Closing an observer never cancels an application-owned preview run.
      queueMicrotask(() => {
        const event = new CloseEvent('close', { code, reason, wasClean: true });
        this.dispatchEvent(event);
        this.onclose?.call(this as unknown as WebSocket, event);
      });
    }
  }

  const MockSocket = new Proxy(NativeSocket, {
    construct(target, args: ConstructorParameters<typeof WebSocket>) {
      const url = new URL(String(args[0]), window.location.href);
      const local = url.host === window.location.host;
      if (local && url.pathname === '/api/agent/ws') return new PreviewSocket(url.href);
      return Reflect.construct(target, args);
    },
  });
  window.WebSocket = MockSocket;
  return () => {
    disposed = true;
    if (window.WebSocket === MockSocket) window.WebSocket = NativeSocket;
    for (const socket of [...sockets]) socket.close();
    for (const timer of timers) clearTimeout(timer);
    for (const stored of sessions.values()) for (const run of stored.runs) void run.reader?.cancel().catch(() => {});
  };
}
