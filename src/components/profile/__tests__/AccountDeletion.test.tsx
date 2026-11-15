import { act, cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderWithQueryClient as render } from '@/__tests__/queryClient';
import { queryOf, recordRequests } from '@/__tests__/server';
import { ToastProvider } from '@/components/ui/toast';
import { ConfirmProvider } from '@/components/ui/confirm-dialog';
import { AuthContext, type AuthContextValue } from '@/components/auth/authContextState';
import { WorkspaceContext, type WorkspaceContextValue } from '@/components/workspace/workspaceContextState';
import { OWNED_WORKSPACE_ID, PERSONAL_WORKSPACE_ID, fixtures, me, workspaceSummary } from '@/dev/msw/fixtures';
import type { Workspace } from '@/data/workspaces';
import { AccountPane } from '../AccountPane';

/**
 * Settings → Account → Delete account (07 §8, M5.UI-3): the username typed
 * exactly; refused, naming them, while a shared workspace has the account
 * as its only owner; once deleted, the session ends here too.
 */

const endSession = vi.fn();
const summary = (id: string): Workspace => {
  const stored = fixtures.workspaces.get(id);
  if (!stored) throw new Error(`No workspace ${id}`);
  return workspaceSummary(stored);
};

function Providers({ children }: { children: ReactNode }) {
  const auth: AuthContextValue = {
    user: { name: 'Ada Author', email: 'ada@example.org' },
    status: 'authenticated',
    openAuth: vi.fn(),
    closeAuth: vi.fn(),
    logout: vi.fn(),
    endSession,
    loginWithCredentials: vi.fn(),
  };
  const workspaces: WorkspaceContextValue = {
    workspaces: [summary(PERSONAL_WORKSPACE_ID), summary(OWNED_WORKSPACE_ID)],
    deleted: [],
    workspace: summary(PERSONAL_WORKSPACE_ID),
    multiWorkspace: true,
    switchWorkspace: async () => {},
  };
  return (
    <ToastProvider>
      <ConfirmProvider>
        <AuthContext.Provider value={auth}>
          <WorkspaceContext.Provider value={workspaces}>{children}</WorkspaceContext.Provider>
        </AuthContext.Provider>
      </ConfirmProvider>
    </ToastProvider>
  );
}

afterEach(() => {
  cleanup();
  endSession.mockClear();
});

describe('deleting the account', () => {
  it('is refused while the account alone owns a shared workspace, which it names; then goes, ending the session', async () => {
    const { identity, profile } = me();
    render(<AccountPane identity={identity} profile={profile} />, { wrapper: Providers });

    fireEvent.click(screen.getByRole('button', { name: 'Delete account' }));
    const dialog = await screen.findByRole('dialog', { name: 'Delete your account?' });
    fireEvent.change(within(dialog).getByRole('textbox', { name: /Type Ada Author to confirm/ }), { target: { value: 'Ada Author' } });
    await act(async () => {
      fireEvent.click(within(dialog).getByRole('button', { name: 'Delete account' }));
    });

    expect(await within(dialog).findByText(/You are the only owner of Side project/)).toBeTruthy();
    expect(endSession).not.toHaveBeenCalled();

    // The author deleted Side project first.
    const side = fixtures.workspaces.get(OWNED_WORKSPACE_ID);
    if (!side) throw new Error('No owned workspace');
    side.deleted_at = new Date().toISOString();
    const sent = recordRequests();
    await act(async () => {
      fireEvent.click(within(dialog).getByRole('button', { name: 'Delete account' }));
    });

    await waitFor(() => expect(endSession).toHaveBeenCalledTimes(1));
    const deletion = sent.find((request) => request.method === 'DELETE');
    expect(deletion && queryOf(deletion).confirm_username).toBe('Ada Author');
    expect(await screen.findByText('Your account was deleted')).toBeTruthy();
  });
});
