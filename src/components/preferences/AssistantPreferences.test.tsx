import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { renderWithQueryClient as render } from '@/__tests__/queryClient';
import { http, jsonOf, problem, recordRequests, server } from '@/__tests__/server';
import { TestWorkspace } from '@/__tests__/workspace';
import { ToastProvider } from '@/components/ui/toast';
import { LAB_WORKSPACE_ID, fixtures, workspaceSummary } from '@/dev/msw/fixtures';
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
    <AssistantCatalogProvider>
      <AssistantPreferences />
    </AssistantCatalogProvider>
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
  it('shows the four switches, Papers with its sources, and what is always on', async () => {
    renderPane();
    await screen.findByRole('switch', { name: /^Papers/ });
    expect(screen.getAllByRole('switch').map((control) => control.getAttribute('id'))).toEqual([
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
    // From the catalog's toolsets that have no switch.
    expect(await screen.findByText(/^Always on: Document tools, Citations, Evidence, PDF library tools, Workspace pages, Planning and Skills\.$/)).toBeTruthy();
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
    const reset = await screen.findByRole('button', { name: 'Reset to defaults' });
    await waitFor(() => expect(reset.hasAttribute('disabled')).toBe(false));
    fireEvent.click(reset);
    await waitFor(() => expect(sent.some((request) => request.method === 'PUT')).toBe(true));
    expect(await jsonOf(sent.find((request) => request.method === 'PUT'))).toEqual({ web: false, sources: { openalex: true } });
    await screen.findByText('Assistant settings reset to defaults');
  });
});
