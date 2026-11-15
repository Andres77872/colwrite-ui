import { act, cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderWithQueryClient as render } from '@/__tests__/queryClient';
import { jsonOf, pathOf, queryOf, recordRequests } from '@/__tests__/server';
import { ToastProvider } from '@/components/ui/toast';
import { ViewContext } from '@/components/layout/viewContextState';
import { WorkspaceContext, type WorkspaceContextValue } from '@/components/workspace/workspaceContextState';
import {
  DELETED_WORKSPACE_ID,
  LAB_WORKSPACE_ID,
  OWNED_WORKSPACE_ID,
  PERSONAL_WORKSPACE_ID,
  deletedWorkspaces,
  fixtures,
  workspaceSummary,
} from '@/dev/msw/fixtures';
import type { Workspace } from '@/data/workspaces';
import { WorkspacePane } from '../WorkspacePane';

/**
 * Settings → Workspace (M5.UI-3): name, icon, order and the policy for
 * admins, read-only for the rest; Delete for the owner of a shared
 * workspace, with its name typed; the deleted workspaces with Restore.
 */

const switchWorkspace = vi.fn(async () => {});
const setView = vi.fn();
const summary = (id: string): Workspace => {
  const stored = fixtures.workspaces.get(id);
  if (!stored) throw new Error(`No workspace ${id}`);
  return workspaceSummary(stored);
};

function renderPane(shownId: string) {
  function Shown({ children }: { children: ReactNode }) {
    const value: WorkspaceContextValue = {
      workspaces: [summary(PERSONAL_WORKSPACE_ID), summary(LAB_WORKSPACE_ID), summary(OWNED_WORKSPACE_ID)],
      deleted: deletedWorkspaces(),
      workspace: summary(shownId),
      multiWorkspace: true,
      switchWorkspace,
    };
    return (
      <ToastProvider>
        <ViewContext.Provider value={{ view: 'settings', setView }}>
          <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>
        </ViewContext.Provider>
      </ToastProvider>
    );
  }
  return render(<WorkspacePane />, { wrapper: Shown });
}

afterEach(() => {
  cleanup();
  switchWorkspace.mockClear();
  setView.mockClear();
});

describe('WorkspacePane', () => {
  it('switches a policy feature off for everyone, on the workspace’s ETag', async () => {
    renderPane(OWNED_WORKSPACE_ID);
    const web = await screen.findByRole('switch', { name: 'Web search' });
    expect(web.getAttribute('aria-checked')).toBe('true');

    const sent = recordRequests();
    await act(async () => {
      fireEvent.click(web);
    });

    await waitFor(() => expect(screen.getByRole('switch', { name: 'Web search' }).getAttribute('aria-checked')).toBe('false'));
    const patch = sent.find((request) => request.method === 'PATCH');
    expect(await jsonOf(patch)).toEqual({ policy: { web_search: false } });
    expect(patch?.headers.get('If-Match')).toBe('"cww:1"');
    expect(screen.getByText('Switched off for everyone here.')).toBeTruthy();
    expect(fixtures.workspaces.get(OWNED_WORKSPACE_ID)?.policy.web_search).toBe(false);
  });

  it('deletes a shared workspace its owner names exactly, then leaves it for the personal one', async () => {
    renderPane(OWNED_WORKSPACE_ID);
    fireEvent.click(await screen.findByRole('button', { name: 'Delete workspace' }));
    const dialog = await screen.findByRole('dialog', { name: 'Delete Side project?' });
    const confirm = within(dialog).getByRole('button', { name: 'Delete workspace' });
    const field = within(dialog).getByRole('textbox', { name: /Type Side project to confirm/ });
    fireEvent.change(field, { target: { value: 'side project' } });
    expect((confirm as HTMLButtonElement).disabled).toBe(true);

    fireEvent.change(field, { target: { value: 'Side project' } });
    const sent = recordRequests();
    await act(async () => {
      fireEvent.click(confirm);
    });

    await waitFor(() => expect(switchWorkspace).toHaveBeenCalledWith(PERSONAL_WORKSPACE_ID));
    const deletion = sent.find((request) => request.method === 'DELETE');
    expect(pathOf(deletion)).toContain(`/workspaces/${OWNED_WORKSPACE_ID}?`);
    expect(deletion && queryOf(deletion).confirm_name).toBe('Side project');
    expect(setView).toHaveBeenCalledWith('editor');
    expect(fixtures.workspaces.get(OWNED_WORKSPACE_ID)?.deleted_at).toBeTruthy();
    expect(await screen.findByText('Deleted Side project')).toBeTruthy();
  });

  it('says why a personal workspace cannot be deleted', async () => {
    renderPane(PERSONAL_WORKSPACE_ID);
    expect(await screen.findByText(/Your personal workspace goes with your account/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Delete workspace' })).toBeNull();
  });

  it('shows an editor the settings read-only, with no export and no delete', async () => {
    renderPane(LAB_WORKSPACE_ID);
    expect(await screen.findByText(/Only this workspace’s admins can change its settings/)).toBeTruthy();
    expect((screen.getByRole('switch', { name: 'Auto' }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.queryByRole('button', { name: 'Export workspace' })).toBeNull();
    expect(screen.getByText('Only the workspace’s owner can delete it.')).toBeTruthy();
  });

  it('lists the deleted workspaces with the days left, and restores one', async () => {
    renderPane(PERSONAL_WORKSPACE_ID);
    expect(await screen.findByText('Old project')).toBeTruthy();
    expect(screen.getByText(/Deleted forever in 25 days/)).toBeTruthy();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Restore Old project' }));
    });
    expect(await screen.findByText('Restored Old project')).toBeTruthy();
    expect(fixtures.workspaces.get(DELETED_WORKSPACE_ID)?.deleted_at).toBeNull();
  });
});
