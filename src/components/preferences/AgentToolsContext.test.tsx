import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AgentToolSettings } from '@/services/agentTools';

const api = vi.hoisted(() => ({
  get: vi.fn(),
  update: vi.fn(),
}));

vi.mock('@/services/agentTools', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/services/agentTools')>();
  return {
    ...actual,
    getAgentToolSettings: api.get,
    updateAgentToolSettings: api.update,
  };
});

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
    categories: [],
  };
}

function Probe() {
  const preferences = useAgentTools();
  return (
    <>
      <span>
        Semantic:{preferences.isSourceEnabled('semantic_scholar') ? 'on' : 'off'}
      </span>
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
});

afterEach(cleanup);

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

    let resolveOlder!: (value: AgentToolSettings) => void;
    let resolveNewest!: (value: AgentToolSettings) => void;
    api.get
      .mockReturnValueOnce(
        new Promise<AgentToolSettings>((resolve) => {
          resolveOlder = resolve;
        }),
      )
      .mockReturnValueOnce(
        new Promise<AgentToolSettings>((resolve) => {
          resolveNewest = resolve;
        }),
      );

    const refresh = screen.getByRole('button', { name: 'Refresh preferences' });
    fireEvent.click(refresh);
    fireEvent.click(refresh);

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
