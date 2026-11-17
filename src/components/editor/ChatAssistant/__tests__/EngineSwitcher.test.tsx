import { act, cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import { renderWithQueryClient as render } from '@/__tests__/queryClient';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mockAgentEngines } from '@/data/__tests__/agentEngineFixtures';
import type { AgentEngineCatalog, AgentEngineStatus } from '@/data/agentEngines';

/** The server's engine routes. */
const api = { list: vi.fn(), check: vi.fn() };

const { AgentEngineProvider } = await import('@/components/preferences/AgentEngineContext');
const { TooltipProvider } = await import('@/components/ui/tooltip');
const { ViewContext } = await import('@/components/layout/viewContextState');
const { takeRequestedSettingsPane } = await import('@/components/profile/settingsPane');
const { EngineSwitcher } = await import('../EngineSwitcher');

function status(engine: AgentEngineStatus['engine'], ready: boolean): AgentEngineStatus {
  return {
    engine,
    name: { gateway: 'ColWrite model gateway', claude: 'Claude Code', codex: 'Codex' }[engine],
    state: ready ? 'ready' : 'unauthenticated',
    available: ready,
    message: ready ? 'Ready.' : `Run \`${engine} login\` in your terminal, then check again.`,
    ...(ready ? {} : { login_command: `${engine} login` }),
  };
}

function catalog(runtime: 'local' | 'deployed'): AgentEngineCatalog {
  return {
    runtime,
    default_engine: 'gateway',
    engines: [status('gateway', true), status('claude', true), status('codex', false)],
    gateway_models: { main: [], lite: [] },
  };
}

const setView = vi.fn();

function renderSwitcher(defaults?: AssistantDefaults) {
  if (defaults) fixtures.assistant.defaults = defaults;
  return render(
    <ViewContext.Provider value={{ view: 'editor', setView }}>
      <TooltipProvider>
        <AgentEngineProvider>
          <EngineSwitcher />
        </AgentEngineProvider>
      </TooltipProvider>
    </ViewContext.Provider>,
  );
}

function openMenu(trigger: HTMLElement) {
  act(() => {
    trigger.focus();
    fireEvent.keyDown(trigger, { key: 'Enter' });
  });
}

beforeEach(() => {
  window.localStorage.clear();
  api.list.mockReset();
  api.check.mockReset();
  mockAgentEngines(api);
  setView.mockReset();
});

afterEach(async () => {
  cleanup();
  // The menu's Radix focus scope schedules its unmount event on the next
  // turn. Do not let it dispatch into an element from a retired jsdom realm.
  await act(async () => { await new Promise<void>((resolve) => setTimeout(resolve, 0)); });
  vi.restoreAllMocks();
});

describe('EngineSwitcher', () => {
  it('renders nothing outside a local server', async () => {
    const bare = render(<EngineSwitcher />);
    expect(bare.container.textContent).toBe('');
    bare.unmount();

    api.list.mockResolvedValue(catalog('deployed'));
    const { container } = renderSwitcher();
    await waitFor(() => expect(api.list).toHaveBeenCalled());
    expect(container.textContent).toBe('');
  });

  it('switches the assistant engine from the composer', async () => {
    api.list.mockResolvedValue(catalog('local'));
    renderSwitcher({ chat_engine: 'claude' });

    const trigger = await screen.findByRole('button', { name: 'Assistant engine: Claude Code' });
    openMenu(trigger);

    const codex = await screen.findByRole('menuitemradio', { name: /Codex/ });
    expect(codex.getAttribute('aria-disabled')).toBe('true');
    expect(codex.textContent).toContain('Sign-in needed');

    fireEvent.click(screen.getByRole('menuitemradio', { name: /ColWrite model gateway/ }));
    expect(await screen.findByRole('button', { name: 'Assistant engine: ColWrite model gateway' })).toBeTruthy();
  });

  it('flags an engine that cannot run and re-checks it on request', async () => {
    api.list.mockResolvedValue(catalog('local'));
    api.check.mockResolvedValue(status('codex', true));
    renderSwitcher({ chat_engine: 'codex' });

    const trigger = await screen.findByRole('button', { name: 'Assistant engine: Codex (not ready)' });
    openMenu(trigger);
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Check Codex again' }));

    await waitFor(() => expect(api.check).toHaveBeenCalledWith('codex'));
    // The menu stays open so the new state shows in place…
    await waitFor(() =>
      expect(
        screen.getByRole('menuitemradio', { name: /Codex/ }).getAttribute('aria-disabled'),
      ).toBeNull(),
    );
    // …and once closed, the composer no longer flags the engine.
    fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' });
    expect(await screen.findByRole('button', { name: 'Assistant engine: Codex' })).toBeTruthy();
  });

  it('opens Settings on the AI & tools pane', async () => {
    api.list.mockResolvedValue(catalog('local'));
    renderSwitcher();

    const trigger = await screen.findByRole('button', { name: 'Assistant engine: ColWrite model gateway' });
    await waitFor(() => expect((trigger as HTMLButtonElement).disabled).toBe(false));
    openMenu(trigger);
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Engine settings…' }));

    expect(setView).toHaveBeenCalledWith('settings');
    expect(takeRequestedSettingsPane()).toBe('ai');
  });
});
import { fixtures } from '@/dev/msw/fixtures';
import type { AssistantDefaults } from '@/data/assistant';
