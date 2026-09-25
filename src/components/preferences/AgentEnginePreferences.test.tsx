import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ToastProvider } from '@/components/ui/toast';
import type { AgentEngineCatalog, AgentEngineStatus } from '@/services/agentEngines';

const api = vi.hoisted(() => ({ list: vi.fn(), check: vi.fn() }));

vi.mock('@/services/agentEngines', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/services/agentEngines')>();
  return { ...actual, getAgentEngines: api.list, checkAgentEngine: api.check };
});

const { AgentEngineProvider } = await import('./AgentEngineContext');
const { AgentEnginePreferences } = await import('./AgentEnginePreferences');

const LEGACY: AgentEngineStatus = {
  engine: 'legacy',
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
  return { runtime, default_engine: 'legacy', engines };
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
});

afterEach(() => cleanup());

describe('AgentEnginePreferences', () => {
  it('shows nothing for a deployed server', async () => {
    api.list.mockResolvedValue(
      catalog('deployed', [
        LEGACY,
        { ...CLAUDE, state: 'disabled', available: false, message: 'Local only.' },
        { ...CODEX_SIGNED_OUT, state: 'disabled', login_command: undefined },
      ]),
    );
    const { container } = renderPreferences();
    await waitFor(() => expect(api.list).toHaveBeenCalled());
    await Promise.resolve();
    expect(container.textContent).toBe('');
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
      expect(JSON.parse(window.localStorage.getItem('colwrite:agent-engine:v1') ?? '{}').chat).toBe(
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
        JSON.parse(window.localStorage.getItem('colwrite:agent-engine:v1') ?? '{}').models,
      ).toEqual({ claude: 'opus' }),
    );
  });

  it('refuses a gateway id for a CLI and keeps the saved model', async () => {
    window.localStorage.setItem(
      'colwrite:agent-engine:v1',
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
      JSON.parse(window.localStorage.getItem('colwrite:agent-engine:v1') ?? '{}').models,
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
      'colwrite:agent-engine:v1',
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
    fireEvent.change(inline, { target: { value: 'legacy' } });
    await waitFor(() =>
      expect(JSON.parse(window.localStorage.getItem('colwrite:agent-engine:v1') ?? '{}').inline).toBe(
        'legacy',
      ),
    );
  });
});
