import { act, cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import { renderWithQueryClient as render } from '@/__tests__/queryClient';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { http, server, serverError } from '@/__tests__/server';
import type { UpdateAgentToolSettingsRequest } from '@/api/schema';
import type { AgentToolSettings } from '@/data/agentTools';
import { fixtures, PERSONAL_WORKSPACE_ID } from '@/dev/msw/fixtures';

/** The server's `/users/me/agent-tools`: `get` reads it, `update` takes a PUT's body. A stand-in that throws is the server failing. */
const api = {
  get: vi.fn<() => Promise<AgentToolSettings>>(),
  update: vi.fn<(body: UpdateAgentToolSettingsRequest) => Promise<AgentToolSettings>>(),
};

const { AgentToolsProvider } = await import('./AgentToolsContext');
const { useAgentTools } = await import('./agentToolsContextState');

function settings(semanticScholar: boolean): AgentToolSettings {
  return {
    version: 1,
    sources: [
      {
        id: 'arxiv',
        label: 'arXiv',
        description: 'Search arXiv.',
        default_enabled: true,
        enabled: true,
        available: true,
        effective_enabled: true,
      },
      {
        id: 'semantic_scholar',
        label: 'Semantic Scholar',
        description: 'Search Semantic Scholar.',
        default_enabled: false,
        enabled: semanticScholar,
        available: true,
        effective_enabled: semanticScholar,
      },
    ],
    categories: [
      {
        id: 'web', label: 'Web', description: 'The public web.',
        tools: [{
          id: 'web_search', category: 'web', label: 'Web search', description: 'Search the web.', default_enabled: true, enabled: true,
          available: true, effective_enabled: true, modes: ['assistant'], requires_sources: [], requires_tools: [], source_policy: 'all',
        }],
      },
    ],
    skills: [],
    features: [],
  };
}

function Probe() {
  const preferences = useAgentTools();
  return (
    <>
      <span>
        Semantic:{preferences.isSourceEnabled('semantic_scholar') ? 'on' : 'off'}
      </span>
      <span>Web:{preferences.isToolEnabled('web_search') ? 'on' : 'off'}</span>
      <span>Why:{preferences.switchedOffBy('source', 'semantic_scholar') ?? 'none'}</span>
      {preferences.error && <span role="alert">{preferences.error}</span>}
      <button type="button" onClick={() => void preferences.refresh()}>
        Refresh preferences
      </button>
    </>
  );
}

function mount() {
  return render(
    <AgentToolsProvider>
      <Probe />
    </AgentToolsProvider>,
  );
}

beforeEach(() => {
  api.get.mockReset();
  api.update.mockReset();
  server.use(
    http.get('/users/me/agent-tools', ({ response }) => api.get().then((body) => response(200).json(body), serverError)),
    http.put('/users/me/agent-tools', async ({ request, response }) =>
      api.update(await request.json()).then((body) => response(200).json(body), serverError)),
  );
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('AgentToolsProvider request ordering', () => {
  it('fails closed when the latest refresh cannot load settings', async () => {
    api.get.mockResolvedValueOnce(settings(true));
    mount();
    await screen.findByText('Semantic:on');

    api.get.mockRejectedValueOnce(new Error('Preferences unavailable'));
    fireEvent.click(screen.getByRole('button', { name: 'Refresh preferences' }));

    await screen.findByRole('alert');
    expect(screen.getByText('Semantic:off')).toBeTruthy();
  });

  it('does not let an older refresh overwrite the newest response', async () => {
    api.get.mockResolvedValueOnce(settings(false));
    mount();
    await screen.findByText('Semantic:off');

    // Each refresh waits at the server until the test answers it, in the
    // order the requests arrived.
    const waiting: Array<(value: AgentToolSettings) => void> = [];
    api.get.mockImplementation(() => new Promise<AgentToolSettings>((resolve) => { waiting.push(resolve); }));

    const refresh = screen.getByRole('button', { name: 'Refresh preferences' });
    fireEvent.click(refresh);
    await waitFor(() => expect(waiting).toHaveLength(1));
    fireEvent.click(refresh);
    await waitFor(() => expect(waiting).toHaveLength(2));
    const [resolveOlder, resolveNewest] = [waiting[0]!, waiting[1]!];

    await act(async () => {
      resolveNewest(settings(true));
    });
    await screen.findByText('Semantic:on');

    await act(async () => {
      resolveOlder(settings(false));
    });
    await waitFor(() => expect(screen.getByText('Semantic:on')).toBeTruthy());
  });
});

describe('AgentToolsProvider and the workspace policy (D7)', () => {
  it('narrows the person’s own settings by what the workspace switched off, and says which switch did', async () => {
    const personal = fixtures.workspaces.get(PERSONAL_WORKSPACE_ID);
    if (!personal) throw new Error('No personal workspace');
    personal.policy = { web_search: false, outside_research: false, auto: true };
    api.get.mockResolvedValue(settings(true));
    mount();

    await screen.findByText('Why:outside_research');
    expect(screen.getByText('Semantic:off')).toBeTruthy();
    expect(screen.getByText('Web:off')).toBeTruthy();
  });

  it('leaves the person’s settings as they are when the workspace restricts nothing', async () => {
    api.get.mockResolvedValue(settings(true));
    mount();
    await screen.findByText('Semantic:on');
    expect(screen.getByText('Web:on')).toBeTruthy();
    expect(screen.getByText('Why:none')).toBeTruthy();
  });
});
