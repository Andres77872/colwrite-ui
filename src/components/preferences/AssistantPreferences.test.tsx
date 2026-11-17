import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { renderWithQueryClient as render } from '@/__tests__/queryClient';
import { http, jsonOf, problem, recordRequests, server } from '@/__tests__/server';
import { TestWorkspace } from '@/__tests__/workspace';
import { ToastProvider } from '@/components/ui/toast';
import { LAB_WORKSPACE_ID, fixtures, workspaceSummary } from '@/dev/msw/fixtures';
import { AgentEngineProvider } from './AgentEngineContext';
import { AssistantCatalogProvider } from './AssistantCatalogContext';
import { AssistantPreferences } from './AssistantPreferences';

/**
 * Settings → AI & tools (13 §9): the four switches as `/users/me/assistant`
 * keeps them, each said as it applies in this workspace by the catalog the
 * mock API computes. The pane decides nothing; every reason is the server's.
 */

afterEach(cleanup);

function renderPane(workspaceId?: string) {
  const pane = (
    <AgentEngineProvider>
      <AssistantCatalogProvider>
        <AssistantPreferences />
      </AssistantCatalogProvider>
    </AgentEngineProvider>
  );
  const workspace = workspaceId ? fixtures.workspaces.get(workspaceId) : undefined;
  return render(
    <ToastProvider>
      {workspace ? <TestWorkspace workspace={workspaceSummary(workspace)}>{pane}</TestWorkspace> : pane}
    </ToastProvider>,
  );
}

const row = (name: string) => screen.getByRole('switch', { name: new RegExp(`^${name}`) });
const rowText = (name: string) => row(name).closest('div')?.textContent ?? '';

describe('Settings → AI & tools', () => {
  it('shows group switches and the opt-in-only individual controls', async () => {
    renderPane();
    await screen.findByRole('switch', { name: /^Papers/ });
    const groups = screen.getByRole('region', { name: 'What the assistant can use' });
    expect(within(groups).getAllByRole('switch').map((control) => control.getAttribute('id'))).toEqual([
      'assistant-switch-papers', 'paper-source-openalex', 'paper-source-arxiv_index', 'paper-source-semantic_scholar',
      'assistant-switch-web', 'assistant-switch-workers', 'assistant-switch-images',
    ]);
    const sources = screen.getByRole('group', { name: 'Papers sources' });
    for (const name of [/OpenAlex/, /Semantic Scholar/]) {
      expect(within(sources).getByRole('switch', { name }).getAttribute('aria-checked')).toBe('true');
    }
    // A source the server lacks says so, and cannot be switched.
    const arxiv = within(sources).getByRole('switch', { name: /arXiv index/ });
    expect(arxiv.hasAttribute('disabled')).toBe(true);
    expect(arxiv.closest('div')?.textContent).toContain('Not configured on this server.');
    expect(row('Papers').getAttribute('aria-checked')).toBe('true');
    expect(row('Web').getAttribute('aria-checked')).toBe('false');
    expect(await screen.findByRole('switch', { name: 'Allow doc_create in my account' })).toBeTruthy();
    expect(screen.queryByRole('switch', { name: 'Allow doc_read in my account' })).toBeNull();
  });

  it('shows an unavailable row with the server’s reason, and does not let it be switched', async () => {
    renderPane();
    const images = await screen.findByRole('switch', { name: /^Images/ });
    expect(images.hasAttribute('disabled')).toBe(true);
    expect(rowText('Images')).toContain('Unavailable');
    expect(rowText('Images')).toContain('Not configured on this server.');
    // An unavailable switch is described by its reason.
    expect(document.getElementById('assistant-switch-images-status')?.textContent).toBe('Not configured on this server.');
  });

  it('shows a row the workspace blocks on that row, in the server’s words, still the person’s to switch', async () => {
    renderPane(LAB_WORKSPACE_ID);
    await waitFor(() => expect(rowText('Papers')).toContain('Switched off in this workspace.'));
    expect(rowText('Papers')).toContain('Off here');
    expect(rowText('Web')).toContain('Switched off in this workspace.');
    // Not the workspace's to say: Workers is the account's own, and is just off.
    expect(rowText('Research workers')).not.toContain('workspace');
    expect(row('Papers').hasAttribute('disabled')).toBe(false);
    const source = screen.getByRole('switch', { name: /Semantic Scholar/ });
    expect(source.closest('div')?.textContent).toContain('Switched off in this workspace.');
  });

  it('saves a paper source on its own, and says when Papers holds it back', async () => {
    const sent = recordRequests();
    renderPane();
    fireEvent.click(await screen.findByRole('switch', { name: /^Papers/ }));
    await waitFor(() => expect(sent.some((request) => request.method === 'PUT')).toBe(true));
    const put = sent.find((request) => request.method === 'PUT');
    expect(new URL(put!.url).pathname).toBe('/api/users/me/assistant');
    expect(await jsonOf(put)).toEqual({ papers: false });
    // Its own choice is kept, and the row says what holds it back now.
    const source = await screen.findByRole('switch', { name: /Semantic Scholar/ });
    await waitFor(() => expect(source.closest('div')?.textContent).toContain('Papers is switched off in your settings.'));
    expect(source.getAttribute('aria-checked')).toBe('true');

    fireEvent.click(source);
    await waitFor(() => expect(sent.filter((request) => request.method === 'PUT')).toHaveLength(2));
    expect(await jsonOf(sent.filter((request) => request.method === 'PUT')[1])).toEqual({ sources: { semantic_scholar: false } });
    expect(fixtures.assistant).toEqual({ switches: { papers: false }, sources: { semantic_scholar: false } });
  });

  it('puts a switch back, and says why on its row, when the save fails', async () => {
    server.use(http.put('/users/me/assistant', () => problem('unavailable', 'The settings service is down.'), { once: true }));
    renderPane();
    fireEvent.click(await screen.findByRole('switch', { name: /^Web/ }));
    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(screen.getByRole('alert').textContent).toContain('Not saved, so it is back to how it was.');
    expect(row('Web').getAttribute('aria-checked')).toBe('false');
  });

  it('resets to the defaults: every paper source on again, as the API defaults them', async () => {
    fixtures.assistant = { switches: { web: true }, sources: { openalex: false } };
    const sent = recordRequests();
    renderPane();
    const reset = await screen.findByRole('button', { name: 'Reset capability switches' });
    await waitFor(() => expect(reset.hasAttribute('disabled')).toBe(false));
    fireEvent.click(reset);
    await waitFor(() => expect(sent.some((request) => request.method === 'PUT')).toBe(true));
    expect(await jsonOf(sent.find((request) => request.method === 'PUT'))).toEqual({ web: false, sources: { openalex: true } });
    await screen.findByText('Assistant capability switches reset to defaults');
  });

  it('persists an opt-out, refreshes the effective status, and can clear it after reopening', async () => {
    const first = renderPane();
    const tool = await screen.findByRole('switch', { name: 'Allow paper_graph in my account' });
    fireEvent.change(screen.getByRole('textbox', { name: 'Search catalog' }), { target: { value: 'paper_graph' } });
    expect(screen.queryByText('doc_read')).toBeNull();
    fireEvent.click(tool);
    expect(await screen.findByText('This tool is switched off in your settings.')).toBeTruthy();
    expect(fixtures.assistant.permissions?.tools).toEqual({ paper_graph: false });

    first.unmount();
    renderPane();
    const persisted = await screen.findByRole('switch', { name: 'Allow paper_graph in my account' });
    expect(persisted.getAttribute('aria-checked')).toBe('false');
    fireEvent.click(persisted);
    await waitFor(() => expect(persisted.getAttribute('aria-checked')).toBe('true'));
    await waitFor(() => expect(screen.queryByText('This tool is switched off in your settings.')).toBeNull());
  });

  it('shows a skill turned off and leaves a protected skill without a switch', async () => {
    fixtures.assistant.permissions = { skills: { 'peer-review': false } };
    renderPane();
    fireEvent.click(await screen.findByRole('button', { name: 'Skills' }));
    expect(screen.getByRole('switch', { name: 'Allow peer-review in my account' }).getAttribute('aria-checked')).toBe('false');
    expect(screen.getByText('This skill is switched off in your settings.')).toBeTruthy();
    expect(screen.queryByRole('switch', { name: 'Allow editor in my account' })).toBeNull();
  });

  it('preserves independent chat and review defaults across remounts', async () => {
    const first = renderPane();
    const effort = await screen.findByRole('combobox', { name: 'Starting chat effort' }) as HTMLSelectElement;
    fireEvent.change(effort, { target: { value: 'quick' } });
    await waitFor(() => expect(effort.value).toBe('quick'));
    fireEvent.change(screen.getByRole('combobox', { name: 'Starting review type' }), { target: { value: 'structure' } });
    await waitFor(() => expect(fixtures.assistant.defaults).toEqual({ chat_effort: 'quick', review_kind: 'structure' }));
    first.unmount();
    renderPane();
    const review = await screen.findByRole('combobox', { name: 'Starting review type' }) as HTMLSelectElement;
    expect(review.value).toBe('structure');
    expect((screen.getByRole('combobox', { name: 'Starting chat effort' }) as HTMLSelectElement).value).toBe('quick');
  });
});
