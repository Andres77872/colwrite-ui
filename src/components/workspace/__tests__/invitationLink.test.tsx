import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTestQueryClient } from '@/__tests__/queryClient';
import { pathOf, recordRequests } from '@/__tests__/server';
import { ToastProvider } from '@/components/ui/toast';
import { NavigationProvider } from '@/components/layout/NavigationContext';
import { AuthContext, type AuthContextValue } from '@/components/auth/authContextState';
import { INVITED_WORKSPACE_ID, INVITE_TOKENS, PERSONAL_WORKSPACE_ID } from '@/dev/msw/fixtures';
import { WorkspaceProvider } from '../WorkspaceProvider';
import { useWorkspace } from '../workspaceContextState';

/**
 * An invitation link (`?invite=<token>`, M6.UI-1) is accepted before the
 * workspace is chosen: a join opens the workspace it joined and says so; a
 * link that cannot be used says why, and goes on to the account's own
 * workspaces.
 */

function Shown() {
  const { workspace } = useWorkspace();
  return <p data-testid="workspace">{`${workspace.id} ${workspace.role}`}</p>;
}

const auth = { user: { name: 'Ada Author', email: 'ada@example.org' } } as AuthContextValue;

function renderAt(search: string) {
  window.history.replaceState(null, '', `/${search}`);
  return render(
    <AuthContext.Provider value={auth}>
      <ToastProvider>
        <QueryClientProvider client={createTestQueryClient()}>
          <NavigationProvider>
            <WorkspaceProvider>
              <Shown />
            </WorkspaceProvider>
          </NavigationProvider>
        </QueryClientProvider>
      </ToastProvider>
    </AuthContext.Provider>,
  );
}

beforeEach(() => localStorage.clear());

afterEach(() => {
  cleanup();
  localStorage.clear();
  window.history.replaceState(null, '', '/');
});

describe('an invitation link', () => {
  it('joins before the list is read, opens the workspace it joined, says so, and leaves the address clean', async () => {
    const sent = recordRequests();
    renderAt(`?invite=${INVITE_TOKENS.join}`);

    expect(await screen.findByText(`${INVITED_WORKSPACE_ID} editor`)).toBeTruthy();
    expect(await screen.findByText('You joined Thesis committee')).toBeTruthy();
    expect(screen.getByText('You’re an editor here.')).toBeTruthy();
    const params = new URLSearchParams(window.location.search);
    expect(params.get('invite')).toBeNull();
    expect(params.get('ws')).toBe(INVITED_WORKSPACE_ID);
    // The acceptance came first, so the list it read holds the workspace.
    const order = sent.map((request) => `${request.method} ${pathOf(request).replace(/^\/api/, '')}`);
    expect(order.indexOf('POST /invitations/accept')).toBeLessThan(order.indexOf('GET /workspaces'));
  });

  it('says a lapsed link has expired, and goes on to the account’s workspaces', async () => {
    renderAt(`?invite=${INVITE_TOKENS.expired}`);
    expect(await screen.findByRole('heading', { name: 'This invitation has expired' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Continue to your workspaces' }));
    });
    expect(await screen.findByText(`${PERSONAL_WORKSPACE_ID} owner`)).toBeTruthy();
    expect(new URLSearchParams(window.location.search).get('invite')).toBeNull();
  });

  it('says a link for another address is not for this account, naming the address signed in', async () => {
    renderAt(`?invite=${INVITE_TOKENS.mismatch}`);
    expect(await screen.findByRole('heading', { name: 'This invitation is for another email address' })).toBeTruthy();
    expect(screen.getByText('ada@example.org')).toBeTruthy();
    expect(screen.getByText(/add and verify it on your account, then open the link again/)).toBeTruthy();
  });

  it('says a used or revoked link cannot be used', async () => {
    renderAt('?invite=cwinv-not-a-real-one');
    expect(await screen.findByRole('heading', { name: 'This invitation can’t be used' })).toBeTruthy();
  });

  it('answers a second open of the same link with "already in"', async () => {
    renderAt(`?invite=${INVITE_TOKENS.join}`);
    await screen.findByText('You joined Thesis committee');
    cleanup();
    renderAt(`?invite=${INVITE_TOKENS.join}`);
    expect(await screen.findByText('You’re already in Thesis committee')).toBeTruthy();
    await waitFor(() => expect(screen.getByTestId('workspace').textContent).toBe(`${INVITED_WORKSPACE_ID} editor`));
  });
});
