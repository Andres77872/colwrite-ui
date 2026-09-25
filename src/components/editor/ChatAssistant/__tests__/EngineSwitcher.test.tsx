import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AgentEngineCatalog, AgentEngineStatus } from '@/services/agentEngines';

const api = vi.hoisted(() => ({ list: vi.fn(), check: vi.fn() }));

vi.mock('@/services/agentEngines', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/services/agentEngines')>();
  return { ...actual, getAgentEngines: api.list, checkAgentEngine: api.check };
});

const { AgentEngineProvider } = await import('@/components/preferences/AgentEngineContext');
const { TooltipProvider } = await import('@/components/ui/tooltip');
const { ViewContext } = await import('@/components/layout/viewContextState');
const { takeRequestedSettingsPane } = await import('@/components/profile/settingsPane');
const { EngineSwitcher } = await import('../EngineSwitcher');

function status(engine: AgentEngineStatus['engine'], ready: boolean): AgentEngineStatus {
  return {
    engine,
    name: { legacy: 'ColWrite model gateway', claude: 'Claude Code', codex: 'Codex' }[engine],
    state: ready ? 'ready' : 'unauthenticated',
    available: ready,
    message: ready ? 'Ready.' : `Run \`${engine} login\` in your terminal, then check again.`,
    ...(ready ? {} : { login_command: `${engine} login` }),
  };
}

function catalog(runtime: 'local' | 'deployed'): AgentEngineCatalog {
  return {
    runtime,
    default_engine: 'legacy',
    engines: [status('legacy', true), status('claude', true), status('codex', false)],
  };
}

const setView = vi.fn();

function renderSwitcher(prefs?: object) {
  if (prefs) window.localStorage.setItem('colwrite:agent-engine:v1', JSON.stringify(prefs));
  return render(
    <ViewContext.Provider value={{ view: 'workspace', setView }}>
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
  setView.mockReset();
});

afterEach(() => cleanup());

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
    renderSwitcher({ chat: 'claude', inline: 'chat', models: {} });

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
    renderSwitcher({ chat: 'codex', inline: 'chat', models: {} });

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

    openMenu(await screen.findByRole('button', { name: 'Assistant engine: ColWrite model gateway' }));
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Engine settings…' }));

    expect(setView).toHaveBeenCalledWith('profile');
    expect(takeRequestedSettingsPane()).toBe('ai');
  });
});
