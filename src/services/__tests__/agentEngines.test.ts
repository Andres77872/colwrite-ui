import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  checkAgentEngine,
  engineModelProblem,
  getAgentEngines,
  isAgentEngineId,
} from '../agentEngines';
import { streamAgentChatSSE as streamAgentChat } from '../agentChat';

beforeEach(() => {
  vi.restoreAllMocks();
});

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status });
}

function sse(): Response {
  return new Response('event: done\ndata: {"chat_id":null,"thread_id":null,"usage":{}}\n\n', {
    status: 200,
    headers: { 'content-type': 'text/event-stream' },
  });
}

describe('agent engines service', () => {
  it('lists engines from the agent route the dev proxy forwards unchanged', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      json({ runtime: 'deployed', default_engine: 'legacy', engines: [] }),
    );

    await getAgentEngines();

    expect(String(fetchSpy.mock.calls[0][0])).toBe('/api/agent/engines');
    expect((fetchSpy.mock.calls[0][1] as RequestInit).credentials).toBe('include');
  });

  it('re-checks one engine with a POST', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      json({ engine: 'codex', name: 'Codex', state: 'ready', available: true, message: '' }),
    );

    const status = await checkAgentEngine('codex');

    const [url, init] = fetchSpy.mock.calls[0];
    expect(String(url)).toBe('/api/agent/engines/codex/check');
    expect((init as RequestInit).method).toBe('POST');
    expect(status.state).toBe('ready');
  });

  it('recognises engine ids', () => {
    expect(isAgentEngineId('claude')).toBe(true);
    expect(isAgentEngineId('gpt')).toBe(false);
    expect(isAgentEngineId(undefined)).toBe(false);
  });

  it('applies the server’s model rules', () => {
    expect(engineModelProblem('claude', '')).toBeNull();
    expect(engineModelProblem('claude', 'sonnet')).toBeNull();
    expect(engineModelProblem('claude', 'claude-sonnet-5')).toBeNull();
    expect(engineModelProblem('claude', 'claude-opus-4-6[1m]')).toBeNull();
    expect(engineModelProblem('codex', 'gpt-6-astra')).toBeNull();
    // Gateway ids are for the gateway only.
    expect(engineModelProblem('claude', '~anthropic/claude-haiku-latest')).toMatch(/gateway id/);
    expect(engineModelProblem('codex', '--dangerous')).not.toBeNull();
    expect(engineModelProblem('legacy', '~anthropic/claude-haiku-latest')).toBeNull();
    expect(engineModelProblem('legacy', 'two words')).not.toBeNull();
  });
});

describe('agent chat engine field', () => {
  it('sends engine and model when a caller names them', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(sse());

    await streamAgentChat(
      { message: 'hi', document_id: 'doc', engine: 'claude', model: 'sonnet' },
      {},
    );

    const body = JSON.parse(String((fetchSpy.mock.calls[0][1] as RequestInit).body));
    expect(body).toEqual({ message: 'hi', document_id: 'doc', engine: 'claude', model: 'sonnet' });
  });

  it('leaves the default request exactly as it was', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(sse());

    await streamAgentChat({ message: 'hi', document_id: 'doc' }, {});

    const body = JSON.parse(String((fetchSpy.mock.calls[0][1] as RequestInit).body));
    expect(body).toEqual({ message: 'hi', document_id: 'doc' });
  });
});
