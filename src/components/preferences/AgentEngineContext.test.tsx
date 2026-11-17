import { act, cleanup, screen, waitFor } from '@testing-library/react';
import { renderWithQueryClient as render } from '@/__tests__/queryClient';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mockAgentEngines } from '@/data/__tests__/agentEngineFixtures';
import { fixtures } from '@/dev/msw/fixtures';
import type { AgentEngineCatalog, AgentEngineStatus } from '@/data/agentEngines';
import {
  DEFAULT_ENGINE_PREFS,
  preferencesOf,
  resolveEngineRequest,
  useAgentEngine,
  type AgentEngineContextValue,
} from './agentEngineContextState';

/** The server's engine routes. */
const api = { list: vi.fn(), check: vi.fn() };

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
    default_engine: 'gateway',
    engines: [
      status('gateway', 'ready'),
      status('claude', runtime === 'local' ? 'ready' : 'disabled'),
      status('codex', runtime === 'local' ? codex : 'disabled'),
    ],
    gateway_models: {
      main: ['openai/gpt-6.1-sol', 'anthropic/claude-sonnet-5.5', 'google/gemini-4-hydrogen'],
      lite: ['openai/gpt-6-luna', 'anthropic/claude-haiku-5.5', 'google/gemini-4-hydrogen'],
    },
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
      resolveEngineRequest({ ...prefs, inline: 'gateway' }, local, 'inline'),
    ).toEqual({});
  });

  it('never names a local engine to a deployed server', () => {
    const prefs = { chat: 'codex' as const, inline: 'claude' as const, models: {} };
    expect(resolveEngineRequest(prefs, catalog('deployed'), 'chat')).toEqual({});
    expect(resolveEngineRequest(prefs, catalog('deployed'), 'inline')).toEqual({});
  });

  it('names the gateway until the server has said it is local (U-37)', () => {
    const prefs = { chat: 'claude' as const, inline: 'codex' as const, models: { claude: 'sonnet' } };
    // The catalog has not answered: the runtime is unknown, so no local engine.
    expect(resolveEngineRequest(prefs, null, 'chat')).toEqual({});
    expect(resolveEngineRequest(prefs, null, 'inline')).toEqual({});
    expect(resolveEngineRequest(prefs, local, 'chat')).toEqual({ engine: 'claude', model: 'sonnet' });
  });

  it('keeps an engine that is not signed in, so the server says why', () => {
    const prefs = { chat: 'codex' as const, inline: 'chat' as const, models: {} };
    expect(resolveEngineRequest(prefs, local, 'chat')).toEqual({ engine: 'codex' });
  });

  it('drops a stored model the engine could not accept', () => {
    const prefs = { chat: 'claude' as const, inline: 'chat' as const, models: { claude: '~gateway/id' } };
    expect(resolveEngineRequest(prefs, local, 'chat')).toEqual({ engine: 'claude' });
    const gatewayPrefs = { chat: 'gateway' as const, inline: 'chat' as const, models: { gateway: '~anthropic/x' } };
    expect(resolveEngineRequest(gatewayPrefs, local, 'chat')).toEqual({});
  });

  it('sends tier choices to gateway and CLI runs on both surfaces', () => {
    const prefs = {
      chat: 'claude' as const, inline: 'gateway' as const,
      models: { gateway: 'anthropic/claude-sonnet-5.5', claude: 'sonnet' },
      liteModel: 'anthropic/claude-haiku-5.5',
    };
    const gateway_models = { main: 'anthropic/claude-sonnet-5.5', lite: 'anthropic/claude-haiku-5.5' };
    expect(resolveEngineRequest(prefs, local, 'chat')).toEqual({ engine: 'claude', model: 'sonnet', gateway_models });
    expect(resolveEngineRequest(prefs, local, 'inline')).toEqual({ gateway_models });
    expect(resolveEngineRequest(prefs, catalog('deployed'), 'chat')).toEqual({ gateway_models });
  });

  it('does not send unknown, cross-tier, or unverified stored choices', () => {
    const prefs = {
      ...DEFAULT_ENGINE_PREFS,
      models: { gateway: 'openai/gpt-6-luna' },
      liteModel: 'openai/gpt-6.1-sol',
    };
    expect(resolveEngineRequest(prefs, local, 'chat')).toEqual({});
    const valid = { ...prefs, models: { gateway: 'openai/gpt-6.1-sol' }, liteModel: 'openai/gpt-6-luna' };
    expect(resolveEngineRequest(valid, null, 'chat')).toEqual({});
  });

  it('uses account defaults and resolves a separate review engine', () => {
    const prefs = preferencesOf({ chat_engine: 'claude', review_engine: 'gateway', chat_effort: 'quick' });
    expect(prefs.chatEffort).toBe('quick');
    expect(resolveEngineRequest(prefs, local, 'chat')).toEqual({ engine: 'claude' });
    expect(resolveEngineRequest(prefs, local, 'review')).toEqual({});
  });
});

describe('AgentEngineProvider', () => {
  let latest: AgentEngineContextValue | null = null;

  function Probe() {
    latest = useAgentEngine();
    return <span data-testid="engine">{latest.requestFor('chat').engine ?? 'gateway'}</span>;
  }

  beforeEach(() => {
    window.localStorage.clear();
    api.list.mockReset();
    api.check.mockReset();
    mockAgentEngines(api);
    latest = null;
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('works on the default engine outside a provider', () => {
    render(<Probe />);
    expect(screen.getByTestId('engine').textContent).toBe('gateway');
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
    await waitFor(() => expect(latest?.selectable && latest.preferencesReady).toBe(true));
    expect(latest?.statusOf('claude')?.state).toBe('ready');

    act(() => latest?.setChatEngine('claude'));
    await waitFor(() => expect(screen.getByTestId('engine').textContent).toBe('claude'));
    expect(latest?.requestFor('chat')).toEqual({ engine: 'claude' });
  });

  it('ignores a remembered local engine on a deployed server', async () => {
    fixtures.assistant.defaults = { chat_engine: 'claude' };
    api.list.mockResolvedValue(catalog('deployed'));
    render(
      <AgentEngineProvider>
        <Probe />
      </AgentEngineProvider>,
    );
    await waitFor(() => expect(api.list).toHaveBeenCalled());
    await waitFor(() => expect(latest?.catalog?.runtime).toBe('deployed'));
    expect(latest?.selectable).toBe(false);
    await waitFor(() => expect(latest?.prefs.chat).toBe('claude'));
    expect(screen.getByTestId('engine').textContent).toBe('gateway');
    expect(latest?.requestFor('chat')).toEqual({});
  });

  it('does not inherit the previous account or the old device-wide engine on the same browser', async () => {
    window.localStorage.setItem('colwrite:device:agent-engine', JSON.stringify({
      chat: 'codex', inline: 'chat', models: { gateway: 'google/gemini-4-hydrogen' },
    }));
    api.list.mockResolvedValue(catalog('local'));
    fixtures.assistant.defaults = { chat_engine: 'claude', claude_model: 'opus' };
    const first = render(<AgentEngineProvider><Probe /></AgentEngineProvider>);
    await waitFor(() => expect(latest?.requestFor('chat')).toEqual({ engine: 'claude', model: 'opus' }));
    first.unmount();
    fixtures.assistant.defaults = {};
    render(<AgentEngineProvider><Probe /></AgentEngineProvider>);
    await waitFor(() => expect(latest?.selectable && latest.preferencesReady).toBe(true));
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
    await waitFor(() => expect(latest?.selectable && latest.preferencesReady).toBe(true));

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
    await waitFor(() => expect(latest?.prefs.models.claude).toBe('opus'));

    act(() => {
      latest?.setModel('claude', '');
    });
    await waitFor(() => expect(latest?.prefs.models.claude).toBeUndefined());
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
    act(() => latest?.noteRunError('MODEL_NOT_CONFIGURED'));
    await waitFor(() => expect(api.list).toHaveBeenCalledTimes(3));
    // A CLI failure that is not a sign-in: the probe says whether the login still holds.
    act(() => latest?.noteRunError('ENGINE_FAILED'));
    await waitFor(() => expect(api.list).toHaveBeenCalledTimes(4));
  });

  it('validates each gateway tier against its own catalog and keeps existing preferences intact', async () => {
    api.list.mockResolvedValue(catalog('deployed'));
    render(<AgentEngineProvider><Probe /></AgentEngineProvider>);
    await waitFor(() => expect(latest?.catalog?.gateway_models && latest.preferencesReady).toBeTruthy());
    let problem: string | null = null;
    act(() => { problem = latest?.setGatewayModel('main', 'openai/gpt-6-luna') ?? null; });
    expect(problem).toMatch(/configured/);
    act(() => { problem = latest?.setGatewayModel('lite', 'openai/gpt-6.1-sol') ?? null; });
    expect(problem).toMatch(/configured/);
    expect(latest?.requestFor('chat')).toEqual({});

    act(() => { latest?.setModel('gateway', ' anthropic/claude-sonnet-5.5 '); });
    act(() => { latest?.setGatewayModel('lite', 'google/gemini-4-hydrogen'); });
    await waitFor(() => expect(latest?.requestFor('chat')).toEqual({
      gateway_models: { main: 'anthropic/claude-sonnet-5.5', lite: 'google/gemini-4-hydrogen' },
    }));
    act(() => { latest?.setGatewayModel('main', 'unknown/model'); });
    expect(latest?.prefs.models.gateway).toBe('anthropic/claude-sonnet-5.5');
    act(() => { latest?.setGatewayModel('lite', ''); });
    await waitFor(() => expect(latest?.requestFor('inline')).toEqual({ gateway_models: { main: 'anthropic/claude-sonnet-5.5' } }));
    act(() => { latest?.setGatewayModel('main', ''); });
    await waitFor(() => expect(latest?.requestFor('chat')).toEqual({}));
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
