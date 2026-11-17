import { act, cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderWithQueryClient as render } from '@/__tests__/queryClient';
import { jsonOf, pathOf, recordRequests } from '@/__tests__/server';
import { ToastProvider } from '@/components/ui/toast';
import { ConfirmProvider } from '@/components/ui/confirm-dialog';
import { ViewContext } from '@/components/layout/viewContextState';
import { WorkspaceContext, type WorkspaceContextValue } from '@/components/workspace/workspaceContextState';
import {
  LAB_WORKSPACE_ID,
  OWNED_WORKSPACE_ID,
  PEOPLE,
  PERSONAL_WORKSPACE_ID,
  fixtures,
  workspaceSummary,
} from '@/dev/msw/fixtures';
import type { Workspace } from '@/data/workspaces';
import { MembersPane } from '../MembersPane';

/**
 * Settings → Members (M6.UI-1): the members with their roles, role changes
 * and removal for admins, invitation links with their pending list, leaving,
 * and the ownership transfer the new owner accepts.
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
      deleted: [],
      workspace: summary(shownId),
      multiWorkspace: true,
      switchWorkspace,
    };
    return (
      <ToastProvider>
        <ConfirmProvider>
          <ViewContext.Provider value={{ view: 'settings', setView }}>
            <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>
          </ViewContext.Provider>
        </ConfirmProvider>
      </ToastProvider>
    );
  }
  return render(<MembersPane />, { wrapper: Shown });
}

const memberRow = async (name: RegExp) => {
  const list = await screen.findByRole('list', { name: /^Members of/ });
  const row = within(list).getAllByRole('listitem').find((item) => name.test(item.textContent ?? ''));
  if (!row) throw new Error(`No member row ${name}`);
  return row;
};

afterEach(() => {
  cleanup();
  switchWorkspace.mockClear();
  setView.mockClear();
});

describe('MembersPane', () => {
  it('lists the members with their roles in words, and nothing to manage for an editor', async () => {
    renderPane(LAB_WORKSPACE_ID);
    const list = await screen.findByRole('list', { name: 'Members of Lab workspace' });
    const rows = within(list).getAllByRole('listitem');
    expect(rows.map((row) => row.querySelector('p')?.textContent)).toEqual([
      'Grace Hopper', 'Alan Turing', 'Ada Author (you)', 'Katherine Johnson',
    ]);
    expect(within(rows[0] as HTMLElement).getByText('Owner')).toBeTruthy();
    expect(within(rows[3] as HTMLElement).getByText('Viewer')).toBeTruthy();
    // An editor changes no role, removes nobody and invites nobody.
    expect(screen.queryByRole('combobox')).toBeNull();
    expect(screen.queryByRole('button', { name: /^Remove / })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Invite people…' })).toBeNull();
    expect(screen.getByText(/You are an editor here\. Only the workspace’s admins can invite people/)).toBeTruthy();
  });

  it('shows the member a transfer names who asked, and accepts it: they are the owner then', async () => {
    const sent = recordRequests();
    renderPane(LAB_WORKSPACE_ID);
    const notice = await screen.findByRole('region', { name: 'Grace Hopper wants to make you the owner' });
    await act(async () => {
      fireEvent.click(within(notice).getByRole('button', { name: 'Accept' }));
    });
    await waitFor(() => expect(sent.some((request) => request.method === 'POST' && pathOf(request).endsWith(`/workspaces/${LAB_WORKSPACE_ID}/ownership-transfer/accept`))).toBe(true));
    expect(await screen.findByText(`You’re now the owner of Lab workspace`)).toBeTruthy();
    await waitFor(() => expect(screen.queryByRole('region', { name: /wants to make you the owner/ })).toBeNull());
  });

  it('declines a transfer', async () => {
    const sent = recordRequests();
    renderPane(LAB_WORKSPACE_ID);
    const notice = await screen.findByRole('region', { name: 'Grace Hopper wants to make you the owner' });
    await act(async () => {
      fireEvent.click(within(notice).getByRole('button', { name: 'Decline' }));
    });
    await waitFor(() => expect(sent.some((request) => request.method === 'DELETE' && pathOf(request).endsWith('/ownership-transfer'))).toBe(true));
    expect(fixtures.transfers.has(LAB_WORKSPACE_ID)).toBe(false);
  });

  it('changes a member’s role as the owner', async () => {
    const sent = recordRequests();
    renderPane(OWNED_WORKSPACE_ID);
    const row = await memberRow(/Marie Curie/);
    const role = within(row).getByLabelText('Role of Marie Curie') as HTMLSelectElement;
    expect(role.value).toBe('editor');
    await act(async () => {
      fireEvent.change(role, { target: { value: 'viewer' } });
    });
    const patch = await waitFor(() => {
      const found = sent.find((request) => request.method === 'PATCH');
      if (!found) throw new Error('No PATCH yet');
      return found;
    });
    expect(pathOf(patch)).toMatch(new RegExp(`/workspaces/${OWNED_WORKSPACE_ID}/members/${PEOPLE.marie.user_id}$`));
    expect(await jsonOf(patch)).toEqual({ role: 'viewer' });
    expect(await screen.findByText('Marie Curie is now a viewer')).toBeTruthy();
  });

  it('removes a member after asking, and says the last owner cannot leave', async () => {
    renderPane(OWNED_WORKSPACE_ID);
    const row = await memberRow(/Marie Curie/);
    fireEvent.click(within(row).getByRole('button', { name: 'Remove Marie Curie' }));
    const dialog = await screen.findByRole('alertdialog', { name: 'Remove Marie Curie from Side project?' });
    await act(async () => {
      fireEvent.click(within(dialog).getByRole('button', { name: 'Remove' }));
    });
    await waitFor(() => expect(screen.queryByText('Marie Curie')).toBeNull());

    const own = await memberRow(/Ada Author/);
    expect((within(own).getByRole('button', { name: 'Leave' }) as HTMLButtonElement).disabled).toBe(true);
    expect(within(own).getByText(/You are the only owner, so you can’t leave/)).toBeTruthy();
  });

  it('asks a member to become the owner, and can withdraw it', async () => {
    renderPane(OWNED_WORKSPACE_ID);
    const row = await memberRow(/Marie Curie/);
    fireEvent.click(within(row).getByRole('button', { name: 'Make Marie Curie the owner' }));
    const dialog = await screen.findByRole('alertdialog', { name: 'Make Marie Curie the owner?' });
    await act(async () => {
      fireEvent.click(within(dialog).getByRole('button', { name: 'Ask to become owner' }));
    });
    const notice = await screen.findByRole('region', { name: 'You asked Marie Curie to become the owner' });
    expect(fixtures.transfers.get(OWNED_WORKSPACE_ID)?.to_user_id).toBe(PEOPLE.marie.user_id);
    await act(async () => {
      fireEvent.click(within(notice).getByRole('button', { name: 'Withdraw' }));
    });
    await waitFor(() => expect(fixtures.transfers.has(OWNED_WORKSPACE_ID)).toBe(false));
  });

  it('makes an invitation link once, with its role and expiry, and lists it with Revoke', async () => {
    const sent = recordRequests();
    renderPane(OWNED_WORKSPACE_ID);
    // The seeded pending invitation, masked as the API answers it.
    expect(await screen.findByText('s***@example.org')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Invite people…' }));
    const dialog = await screen.findByRole('dialog', { name: 'Invite people to Side project' });
    fireEvent.change(within(dialog).getByLabelText('Email address'), { target: { value: 'lin@example.org' } });
    fireEvent.change(within(dialog).getByLabelText('Role'), { target: { value: 'viewer' } });
    expect(within(dialog).getByText('Can read everything and ask the assistant, but can’t change anything.')).toBeTruthy();
    await act(async () => {
      fireEvent.click(within(dialog).getByRole('button', { name: 'Create invite link' }));
    });

    const shown = await screen.findByRole('dialog', { name: 'Share this link with lin@example.org' });
    const link = within(shown).getByLabelText('Invite link') as HTMLInputElement;
    expect(link.value).toMatch(/\?invite=cwinv-[0-9a-f]+$/);
    expect(link.readOnly).toBe(true);
    expect(within(shown).getByText(/join Side project as a viewer\. The link works once and expires on/)).toBeTruthy();
    expect(within(shown).getByText(/This link is shown only now/)).toBeTruthy();
    const post = sent.find((request) => request.method === 'POST');
    expect(post?.headers.get('Idempotency-Key')).toBeTruthy();
    expect(await jsonOf(post)).toEqual({ email: 'lin@example.org', role: 'viewer' });

    fireEvent.click(within(shown).getByRole('button', { name: 'Done' }));
    expect(await screen.findByText('l***@example.org')).toBeTruthy();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Revoke the invitation for l***@example.org' }));
    });
    await waitFor(() => expect(screen.queryByText('l***@example.org')).toBeNull());
  });

  it('says a personal workspace has only its owner', () => {
    renderPane(PERSONAL_WORKSPACE_ID);
    expect(screen.getByText(/Your personal workspace is only yours/)).toBeTruthy();
    expect(screen.queryByRole('list', { name: /^Members of/ })).toBeNull();
  });
});
