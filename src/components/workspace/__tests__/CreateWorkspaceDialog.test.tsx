import { act, cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderWithQueryClient as render } from '@/__tests__/queryClient';
import { http, jsonOf, pathOf, problem, recordRequests, server } from '@/__tests__/server';
import { ToastProvider } from '@/components/ui/toast';
import { PERSONAL_WORKSPACE_ID, fixtures } from '@/dev/msw/fixtures';
import { WorkspaceContext, type WorkspaceContextValue } from '../workspaceContextState';
import { CreateWorkspaceDialog } from '../CreateWorkspaceDialog';

/**
 * "New workspace…" (M5.UI-1): a name and an icon, one `Idempotency-Key`,
 * then the switch to the new workspace. The owned-workspace limit is said in
 * the dialog, plainly.
 */

const PERSONAL = { id: PERSONAL_WORKSPACE_ID, name: 'Personal', kind: 'personal', role: 'owner', icon: null, last_opened_at: null, member_count: 1 } as const;
const switchWorkspace = vi.fn(async () => {});

function Shown({ children }: { children: ReactNode }) {
  const value: WorkspaceContextValue = { workspaces: [PERSONAL], deleted: [], workspace: PERSONAL, multiWorkspace: true, switchWorkspace };
  return (
    <ToastProvider>
      <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>
    </ToastProvider>
  );
}

afterEach(() => {
  cleanup();
  switchWorkspace.mockClear();
});

describe('CreateWorkspaceDialog', () => {
  it('creates the workspace with its icon, then switches to it', async () => {
    const onOpenChange = vi.fn();
    render(<CreateWorkspaceDialog open onOpenChange={onOpenChange} />, { wrapper: Shown });

    const create = screen.getByRole('button', { name: 'Create workspace' });
    expect((create as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(screen.getByRole('textbox', { name: 'Name' }), { target: { value: 'Thesis' } });
    const icons = screen.getByRole('radiogroup', { name: 'Icon' });
    expect(icons).toBeTruthy();
    fireEvent.click(screen.getByRole('radio', { name: '🎓' }));
    expect(screen.getByRole('radio', { name: '🎓' }).getAttribute('aria-checked')).toBe('true');

    const sent = recordRequests();
    await act(async () => {
      fireEvent.click(create);
    });

    const post = sent.find((request) => request.method === 'POST' && pathOf(request).endsWith('/workspaces'));
    expect(await jsonOf(post)).toEqual({ name: 'Thesis', icon: '🎓' });
    expect(post?.headers.get('Idempotency-Key')).toBeTruthy();
    const created = [...fixtures.workspaces.values()].find((workspace) => workspace.name === 'Thesis');
    await waitFor(() => expect(switchWorkspace).toHaveBeenCalledWith(created?.id));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('says plainly when the account owns the most workspaces it can', async () => {
    server.use(http.post('/workspaces', () => problem('workspace_limit', 'You own the most workspaces one account can have', { limit: 20 })));
    render(<CreateWorkspaceDialog open onOpenChange={vi.fn()} />, { wrapper: Shown });
    fireEvent.change(screen.getByRole('textbox', { name: 'Name' }), { target: { value: 'One more' } });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Create workspace' }));
    });
    expect(await screen.findByText(/You own 20 workspaces, the most one account can have/)).toBeTruthy();
    expect(switchWorkspace).not.toHaveBeenCalled();
  });
});
