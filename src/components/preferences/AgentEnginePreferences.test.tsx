import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { renderWithQueryClient as render } from '@/__tests__/queryClient';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mockAgentEngines } from '@/data/__tests__/agentEngineFixtures';
import { ToastProvider } from '@/components/ui/toast';
import type { AgentEngineCatalog, AgentEngineStatus } from '@/data/agentEngines';

/** The server's engine routes. */
const api = { list: vi.fn(), check: vi.fn() };

const { AgentEngineProvider } = await import('./AgentEngineContext');
const { AgentEnginePreferences } = await import('./AgentEnginePreferences');

const LEGACY: AgentEngineStatus = {
  engine: 'gateway',
  name: 'ColWrite model gateway',
  state: 'ready',
  available: true,
  message: 'Magic LLM through the configured model gateway.',
};
const CLAUDE: AgentEngineStatus = {
  engine: 'claude',
  name: 'Claude Code',
  state: 'ready',
  available: true,
  message: 'Signed in to Claude Code with your account.',
  auth_method: 'claude.ai',
  plan: 'max',
  version: '2.1.280 (Claude Code)',
};
const CODEX_SIGNED_OUT: AgentEngineStatus = {
  engine: 'codex',
  name: 'Codex',
  state: 'unauthenticated',
  available: false,
  message: 'Codex is not signed in. Run `codex login` in your terminal, then check again.',
  login_command: 'codex login',
};

function radio(element: HTMLElement): HTMLInputElement {
  return element as HTMLInputElement;
}

function catalog(runtime: 'local' | 'deployed', engines: AgentEngineStatus[]): AgentEngineCatalog {
  return {
    runtime, default_engine: 'gateway', engines,
    gateway_models: {
      main: ['openai/gpt-6.1-sol', 'anthropic/claude-sonnet-5.5', 'google/gemini-4-hydrogen'],
      lite: ['openai/gpt-6-luna', 'anthropic/claude-haiku-5.5', 'google/gemini-4-hydrogen'],
    },
  };
}

function renderPreferences() {
  return render(
    <ToastProvider>
      <AgentEngineProvider>
        <AgentEnginePreferences />
      </AgentEngineProvider>
    </ToastProvider>,
  );
}

beforeEach(() => {
  window.localStorage.clear();
  api.list.mockReset();
  api.check.mockReset();
  mockAgentEngines(api);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('AgentEnginePreferences', () => {
  it('offers gateway models but no local engines on a deployed server', async () => {
    api.list.mockResolvedValue(
      catalog('deployed', [
        LEGACY,
        { ...CLAUDE, state: 'disabled', available: false, message: 'Local only.' },
        { ...CODEX_SIGNED_OUT, state: 'disabled', login_command: undefined },
      ]),
    );
    renderPreferences();
    expect(await screen.findByRole('combobox', { name: 'General model' })).toBeTruthy();
    expect(screen.getByRole('combobox', { name: 'Lite model' })).toBeTruthy();
    expect(screen.queryByRole('radiogroup')).toBeNull();
  });

  it('lists each engine with its state on a local server', async () => {
    api.list.mockResolvedValue(catalog('local', [LEGACY, CLAUDE, CODEX_SIGNED_OUT]));
    renderPreferences();

    const group = await screen.findByRole('radiogroup', { name: 'Agent engine' });
    const radios = within(group).getAllByRole('radio');
    expect(radios).toHaveLength(3);
    expect(radio(screen.getByRole('radio', { name: /ColWrite model gateway/ })).checked).toBe(true);
    expect(radio(screen.getByRole('radio', { name: /Claude Code/ })).disabled).toBe(false);
    // A CLI that is not signed in is shown, with its reason, but not offered.
    expect(radio(screen.getByRole('radio', { name: /Codex/ })).disabled).toBe(true);
    expect(screen.getByText('Sign-in needed')).toBeTruthy();
    expect(screen.getByText(/Signed in · Max plan · 2\.1\.280/)).toBeTruthy();
    expect(screen.getByText('codex login')).toBeTruthy();
  });

  it('switches engines and shows that engine’s model setting', async () => {
    api.list.mockResolvedValue(catalog('local', [LEGACY, CLAUDE, CODEX_SIGNED_OUT]));
    renderPreferences();

    fireEvent.click(await screen.findByRole('radio', { name: /Claude Code/ }));
    expect(radio(screen.getByRole('radio', { name: /Claude Code/ })).checked).toBe(true);
    await waitFor(() =>
      expect(JSON.parse(window.localStorage.getItem('colwrite:device:agent-engine') ?? '{}').chat).toBe(
        'claude',
      ),
    );

    // Claude Code offers its aliases, and any other id it accepts.
    const models = screen.getAllByRole('combobox', { name: 'Model' });
    const claudeModel = models.find((select) =>
      within(select).queryByRole('option', { name: 'Claude Code default' }),
    )!;
    fireEvent.change(claudeModel, { target: { value: 'opus' } });
    await waitFor(() =>
      expect(
        JSON.parse(window.localStorage.getItem('colwrite:device:agent-engine') ?? '{}').models,
      ).toEqual({ claude: 'opus' }),
    );
  });

  it('refuses a gateway id for a CLI and keeps the saved model', async () => {
    window.localStorage.setItem(
      'colwrite:device:agent-engine',
      JSON.stringify({ chat: 'claude', inline: 'chat', models: { claude: 'sonnet' } }),
    );
    api.list.mockResolvedValue(catalog('local', [LEGACY, CLAUDE, CODEX_SIGNED_OUT]));
    renderPreferences();

    const claudeModel = (await screen.findAllByRole('combobox', { name: 'Model' })).find((select) =>
      within(select).queryByRole('option', { name: 'Claude Code default' }),
    )!;
    fireEvent.change(claudeModel, { target: { value: '__other__' } });
    const input = screen.getByRole('textbox', { name: 'Claude Code model id' });
    fireEvent.change(input, { target: { value: '~anthropic/claude-haiku-latest' } });
    fireEvent.blur(input);

    expect(await screen.findByText(/not a gateway id\. Still using sonnet\./)).toBeTruthy();
    expect(input.getAttribute('aria-invalid')).toBe('true');
    expect(
      JSON.parse(window.localStorage.getItem('colwrite:device:agent-engine') ?? '{}').models,
    ).toEqual({ claude: 'sonnet' });
  });

  it('checks again after the author signs in, without signing in itself', async () => {
    api.list.mockResolvedValue(catalog('local', [LEGACY, CLAUDE, CODEX_SIGNED_OUT]));
    api.check.mockResolvedValue({
      engine: 'codex',
      name: 'Codex',
      state: 'ready',
      available: true,
      message: 'Signed in to Codex with your ChatGPT account.',
      auth_method: 'chatgpt',
    } satisfies AgentEngineStatus);
    renderPreferences();

    fireEvent.click(await screen.findByRole('button', { name: 'Check Codex again' }));

    await waitFor(() => expect(radio(screen.getByRole('radio', { name: /Codex/ })).disabled).toBe(false));
    expect(api.check).toHaveBeenCalledWith('codex');
    expect(screen.queryByText('codex login')).toBeNull();
    expect(screen.getByText(/under your ChatGPT account\. Signed in\./)).toBeTruthy();
  });

  it('warns when the chosen engine can no longer run', async () => {
    window.localStorage.setItem(
      'colwrite:device:agent-engine',
      JSON.stringify({ chat: 'codex', inline: 'chat', models: {} }),
    );
    api.list.mockResolvedValue(catalog('local', [LEGACY, CLAUDE, CODEX_SIGNED_OUT]));
    renderPreferences();

    expect(await screen.findByText(/The assistant is set to Codex, which cannot run yet/)).toBeTruthy();
    // Still selected (not silently swapped), so it stays enabled to be seen.
    expect(radio(screen.getByRole('radio', { name: /Codex/ })).checked).toBe(true);
  });

  it('lets inline AI use its own engine', async () => {
    api.list.mockResolvedValue(catalog('local', [LEGACY, CLAUDE, CODEX_SIGNED_OUT]));
    renderPreferences();

    const inline = await screen.findByRole('combobox', { name: 'Inline AI' });
    expect(within(inline).getAllByRole('option').map((option) => option.textContent)).toEqual([
      'Same as assistant',
      'ColWrite model gateway',
      'Claude Code',
    ]);
    fireEvent.change(inline, { target: { value: 'gateway' } });
    await waitFor(() =>
      expect(JSON.parse(window.localStorage.getItem('colwrite:device:agent-engine') ?? '{}').inline).toBe(
        'gateway',
      ),
    );
  });

  it('offers exactly the configured models for each tier, with no gateway text input', async () => {
    const server = catalog('deployed', [LEGACY]);
    api.list.mockResolvedValue(server);
    renderPreferences();
    const general = await screen.findByRole('combobox', { name: 'General model' });
    const lite = screen.getByRole('combobox', { name: 'Lite model' });
    const values = (select: HTMLElement) => within(select).getAllByRole('option')
      .map((option) => (option as HTMLOptionElement).value).filter(Boolean);
    expect(values(general)).toEqual(server.gateway_models?.main);
    expect(values(lite)).toEqual(server.gateway_models?.lite);
    expect(screen.queryByRole('textbox')).toBeNull();
  });

  it('saves independent general/lite choices, restores them, and resets one without changing the other', async () => {
    api.list.mockResolvedValue(catalog('deployed', [LEGACY]));
    const first = renderPreferences();
    fireEvent.change(await screen.findByRole('combobox', { name: 'General model' }), {
      target: { value: 'anthropic/claude-sonnet-5.5' },
    });
    fireEvent.change(screen.getByRole('combobox', { name: 'Lite model' }), {
      target: { value: 'google/gemini-4-hydrogen' },
    });
    await waitFor(() => expect(JSON.parse(localStorage.getItem('colwrite:device:agent-engine') ?? '{}'))
      .toMatchObject({ models: { gateway: 'anthropic/claude-sonnet-5.5' }, liteModel: 'google/gemini-4-hydrogen' }));

    first.unmount();
    renderPreferences();
    const general = await screen.findByRole('combobox', { name: 'General model' }) as HTMLSelectElement;
    expect(general.value).toBe('anthropic/claude-sonnet-5.5');
    expect((screen.getByRole('combobox', { name: 'Lite model' }) as HTMLSelectElement).value).toBe('google/gemini-4-hydrogen');
    fireEvent.change(general, { target: { value: '' } });
    await waitFor(() => expect(JSON.parse(localStorage.getItem('colwrite:device:agent-engine') ?? '{}'))
      .toMatchObject({ models: {}, liteModel: 'google/gemini-4-hydrogen' }));
  });

  it('does not offer a stale model saved against a different server', async () => {
    localStorage.setItem('colwrite:device:agent-engine', JSON.stringify({
      chat: 'gateway', inline: 'chat', models: { gateway: 'old/general' }, liteModel: 'old/lite',
    }));
    api.list.mockResolvedValue(catalog('deployed', [LEGACY]));
    renderPreferences();
    const general = await screen.findByRole('combobox', { name: 'General model' }) as HTMLSelectElement;
    expect(general.value).toBe('');
    expect((screen.getByRole('combobox', { name: 'Lite model' }) as HTMLSelectElement).value).toBe('');
    expect(screen.getAllByText(/saved model is no longer configured/)).toHaveLength(2);
    expect(screen.queryByRole('option', { name: 'old/general' })).toBeNull();
    expect(screen.queryByRole('option', { name: 'old/lite' })).toBeNull();
  });

  it('shows a configuration warning when the gateway has no configured models', async () => {
    api.list.mockResolvedValue({ ...catalog('deployed', [LEGACY]), gateway_models: { main: [], lite: [] } });
    renderPreferences();
    expect(await screen.findByText('Gateway models are not configured on this server.')).toBeTruthy();
    expect(screen.queryByRole('combobox')).toBeNull();
  });

  it('keeps the general picker when only the lite tier has no models (U-11)', async () => {
    const full = catalog('deployed', [LEGACY]);
    api.list.mockResolvedValue({ ...full, gateway_models: { ...full.gateway_models, lite: [] } });
    renderPreferences();
    expect(await screen.findByRole('combobox', { name: 'General model' })).toBeTruthy();
    expect(screen.queryByRole('combobox', { name: 'Lite model' })).toBeNull();
    expect(screen.getByText('Not configured on this server. The server default is used.')).toBeTruthy();
    expect(screen.queryByText('Gateway models are not configured on this server.')).toBeNull();
  });

  it('can reload the catalog after a loading failure', async () => {
    api.list.mockRejectedValueOnce(new Error('Models unavailable'));
    renderPreferences();
    expect(await screen.findByText('Models unavailable')).toBeTruthy();
    api.list.mockResolvedValue(catalog('deployed', [LEGACY]));
    fireEvent.click(screen.getByRole('button', { name: 'Reload models' }));
    expect(await screen.findByRole('combobox', { name: 'General model' })).toBeTruthy();
  });
});
