import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AgentEngineCatalog, AgentEngineStatus } from '@/services/agentEngines';
import {
  DEFAULT_ENGINE_PREFS,
  isAgentEnginePrefs,
  resolveEngineRequest,
  useAgentEngine,
  type AgentEngineContextValue,
} from './agentEngineContextState';

const api = vi.hoisted(() => ({ list: vi.fn(), check: vi.fn() }));

vi.mock('@/services/agentEngines', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/services/agentEngines')>();
  return { ...actual, getAgentEngines: api.list, checkAgentEngine: api.check };
});

const { AgentEngineProvider } = await import('./AgentEngineContext');

function status(engine: AgentEngineStatus['engine'], state: AgentEngineStatus['state']): AgentEngineStatus {
  return {
    engine,
    name: engine,
    state,
    available: state === 'ready',
    message: `${engine} ${state}`,
    ...(state === 'unauthenticated' ? { login_command: `${engine} login` } : {}),
  };
}

function catalog(runtime: 'local' | 'deployed', codex: AgentEngineStatus['state'] = 'unauthenticated'): AgentEngineCatalog {
  return {
    runtime,
    default_engine: 'legacy',
    engines: [
      status('legacy', 'ready'),
      status('claude', runtime === 'local' ? 'ready' : 'disabled'),
      status('codex', runtime === 'local' ? codex : 'disabled'),
    ],
  };
}

describe('resolveEngineRequest', () => {
  const local = catalog('local');

  it('sends nothing extra for the plain default', () => {
    expect(resolveEngineRequest(DEFAULT_ENGINE_PREFS, local, 'chat')).toEqual({});
    expect(resolveEngineRequest(DEFAULT_ENGINE_PREFS, null, 'inline')).toEqual({});
  });

  it('names the chosen engine and its model', () => {
    const prefs = { chat: 'claude' as const, inline: 'chat' as const, models: { claude: 'sonnet' } };
    expect(resolveEngineRequest(prefs, local, 'chat')).toEqual({ engine: 'claude', model: 'sonnet' });
    // Inline AI follows the assistant unless told otherwise.
    expect(resolveEngineRequest(prefs, local, 'inline')).toEqual({ engine: 'claude', model: 'sonnet' });
    expect(
      resolveEngineRequest({ ...prefs, inline: 'legacy' }, local, 'inline'),
    ).toEqual({});
  });

  it('never names a local engine to a deployed server', () => {
    const prefs = { chat: 'codex' as const, inline: 'claude' as const, models: {} };
    expect(resolveEngineRequest(prefs, catalog('deployed'), 'chat')).toEqual({});
    expect(resolveEngineRequest(prefs, catalog('deployed'), 'inline')).toEqual({});
  });

  it('keeps an engine that is not signed in, so the server says why', () => {
    const prefs = { chat: 'codex' as const, inline: 'chat' as const, models: {} };
    expect(resolveEngineRequest(prefs, local, 'chat')).toEqual({ engine: 'codex' });
  });

  it('drops a stored model the engine could not accept', () => {
    const prefs = { chat: 'claude' as const, inline: 'chat' as const, models: { claude: '~gateway/id' } };
    expect(resolveEngineRequest(prefs, local, 'chat')).toEqual({ engine: 'claude' });
    const legacy = { chat: 'legacy' as const, inline: 'chat' as const, models: { legacy: '~anthropic/x' } };
    expect(resolveEngineRequest(legacy, local, 'chat')).toEqual({ engine: 'legacy', model: '~anthropic/x' });
  });

  it('validates persisted preferences', () => {
    expect(isAgentEnginePrefs(DEFAULT_ENGINE_PREFS)).toBe(true);
    expect(isAgentEnginePrefs({ chat: 'gpt', inline: 'chat', models: {} })).toBe(false);
    expect(isAgentEnginePrefs({ chat: 'claude', inline: 'claude', models: { claude: 3 } })).toBe(false);
    expect(isAgentEnginePrefs(null)).toBe(false);
  });
});

describe('AgentEngineProvider', () => {
  let latest: AgentEngineContextValue | null = null;

  function Probe() {
    latest = useAgentEngine();
    return <span data-testid="engine">{latest.engineFor('chat')}</span>;
  }

  beforeEach(() => {
    window.localStorage.clear();
    api.list.mockReset();
    api.check.mockReset();
    latest = null;
  });

  afterEach(() => cleanup());

  it('works on the default engine outside a provider', () => {
    render(<Probe />);
    expect(screen.getByTestId('engine').textContent).toBe('legacy');
    expect(latest?.selectable).toBe(false);
    expect(latest?.requestFor('chat')).toEqual({});
  });

  it('loads the catalog and offers a choice only on a local server', async () => {
    api.list.mockResolvedValue(catalog('local'));
    render(
      <AgentEngineProvider>
        <Probe />
      </AgentEngineProvider>,
    );
    await waitFor(() => expect(latest?.selectable).toBe(true));
    expect(latest?.statusOf('claude')?.state).toBe('ready');

    act(() => latest?.setChatEngine('claude'));
    expect(screen.getByTestId('engine').textContent).toBe('claude');
    expect(latest?.requestFor('chat')).toEqual({ engine: 'claude' });
  });

  it('ignores a remembered local engine on a deployed server', async () => {
    window.localStorage.setItem(
      'colwrite:agent-engine:v1',
      JSON.stringify({ chat: 'claude', inline: 'chat', models: {} }),
    );
    api.list.mockResolvedValue(catalog('deployed'));
    render(
      <AgentEngineProvider>
        <Probe />
      </AgentEngineProvider>,
    );
    await waitFor(() => expect(api.list).toHaveBeenCalled());
    await waitFor(() => expect(latest?.catalog?.runtime).toBe('deployed'));
    expect(latest?.selectable).toBe(false);
    expect(screen.getByTestId('engine').textContent).toBe('legacy');
    expect(latest?.requestFor('chat')).toEqual({});
  });

  it('re-checks one engine and keeps the rest', async () => {
    api.list.mockResolvedValue(catalog('local'));
    api.check.mockResolvedValue(status('codex', 'ready'));
    render(
      <AgentEngineProvider>
        <Probe />
      </AgentEngineProvider>,
    );
    await waitFor(() => expect(latest?.statusOf('codex')?.state).toBe('unauthenticated'));

    await act(async () => {
      await latest?.check('codex');
    });
    expect(api.check).toHaveBeenCalledWith('codex');
    expect(latest?.statusOf('codex')?.state).toBe('ready');
    expect(latest?.statusOf('claude')?.state).toBe('ready');
  });

  it('refuses invalid model overrides and stores valid ones', async () => {
    api.list.mockResolvedValue(catalog('local'));
    render(
      <AgentEngineProvider>
        <Probe />
      </AgentEngineProvider>,
    );
    await waitFor(() => expect(latest?.selectable).toBe(true));

    let problem: string | null = null;
    act(() => {
      problem = latest?.setModel('claude', '~anthropic/claude-haiku-latest') ?? null;
    });
    expect(problem).toMatch(/gateway id/);
    expect(latest?.prefs.models.claude).toBeUndefined();

    act(() => {
      problem = latest?.setModel('claude', ' opus ') ?? null;
    });
    expect(problem).toBeNull();
    expect(latest?.prefs.models.claude).toBe('opus');

    act(() => {
      latest?.setModel('claude', '');
    });
    expect(latest?.prefs.models.claude).toBeUndefined();
  });

  it('re-reads the statuses after an engine error, not after other errors', async () => {
    api.list.mockResolvedValue(catalog('local'));
    render(
      <AgentEngineProvider>
        <Probe />
      </AgentEngineProvider>,
    );
    await waitFor(() => expect(api.list).toHaveBeenCalledTimes(1));

    act(() => latest?.noteRunError('STREAM_ERROR'));
    act(() => latest?.noteRunError('ENGINE_AUTH_REQUIRED'));
    await waitFor(() => expect(api.list).toHaveBeenCalledTimes(2));
  });

  it('keeps working on the default engine when an older API has no engines route', async () => {
    api.list.mockRejectedValue(new Error('Not Found'));
    render(
      <AgentEngineProvider>
        <Probe />
      </AgentEngineProvider>,
    );
    await waitFor(() => expect(latest?.error).toBeTruthy());
    expect(latest?.selectable).toBe(false);
    expect(latest?.requestFor('chat')).toEqual({});
  });
});
