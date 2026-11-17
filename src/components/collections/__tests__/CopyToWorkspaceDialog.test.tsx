import { act, cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderWithQueryClient as render } from '@/__tests__/queryClient';
import { jsonOf, pathOf, recordRequests } from '@/__tests__/server';
import { ToastProvider } from '@/components/ui/toast';
import { EditorProvider } from '@/editor';
import { WorkspaceContext, type WorkspaceContextValue } from '@/components/workspace/workspaceContextState';
import { FIXTURE_DOCUMENT_ID, LAB_WORKSPACE_ID, PERSONAL_WORKSPACE_ID, fixtures } from '@/dev/msw/fixtures';
import { CopyToWorkspaceDialog } from '../CopyToWorkspaceDialog';

/**
 * "Copy to workspace…" (M5.UI-3, D11): the target is one of the author's
 * workspaces they can edit, the PDFs choice goes in the request, the dialog
 * says what is not copied, and once the job is done "Open copy" switches to
 * the new page.
 */

const PERSONAL = { id: PERSONAL_WORKSPACE_ID, name: 'Personal', kind: 'personal', role: 'owner', icon: null, last_opened_at: null, member_count: 1 } as const;
const LAB = { id: LAB_WORKSPACE_ID, name: 'Lab workspace', kind: 'shared', role: 'editor', icon: null, last_opened_at: null, member_count: 3 } as const;
const READ_ONLY = { id: 'wsp-viewer', name: 'Read only', kind: 'shared', role: 'viewer', icon: null, last_opened_at: null, member_count: 3 } as const;
const switchWorkspace = vi.fn(async () => {});

function Workspaces({ children }: { children: ReactNode }) {
  const value: WorkspaceContextValue = {
    workspaces: [PERSONAL, LAB, READ_ONLY], deleted: [], workspace: PERSONAL, multiWorkspace: true, switchWorkspace,
  };
  return (
    <ToastProvider>
      <WorkspaceContext.Provider value={value}>
        <EditorProvider>{children}</EditorProvider>
      </WorkspaceContext.Provider>
    </ToastProvider>
  );
}

beforeEach(() => {
  fixtures.jobDurationMs = 0;
});

afterEach(() => {
  cleanup();
  switchWorkspace.mockClear();
});

describe('CopyToWorkspaceDialog', () => {
  it('copies the page into a workspace the author can edit, with the PDFs chosen, then opens the copy', async () => {
    const onOpenChange = vi.fn();
    render(
      <CopyToWorkspaceDialog page={{ id: FIXTURE_DOCUMENT_ID, name: 'Fixture page', collectionId: null }} onOpenChange={onOpenChange} />,
      { wrapper: Workspaces },
    );

    expect(screen.getByText('History, chats and review notes are not copied.')).toBeTruthy();
    // A workspace the author only views is not a target, nor is this one.
    const select = screen.getByRole('combobox', { name: 'Workspace' });
    expect([...select.querySelectorAll('option')].map((option) => option.textContent)).toEqual(['Lab workspace']);

    fireEvent.click(screen.getByRole('radio', { name: 'PDFs on this page' }));
    const sent = recordRequests();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Copy' }));
    });

    const open = await screen.findByRole('button', { name: 'Open copy' });
    const copy = sent.find((request) => pathOf(request).endsWith(`/documents/${FIXTURE_DOCUMENT_ID}/copy`));
    expect(await jsonOf(copy)).toEqual({ target_workspace_id: LAB_WORKSPACE_ID, target_collection_id: null, include_pdfs: 'located' });
    expect(copy?.headers.get('Idempotency-Key')).toBeTruthy();
    expect(screen.getByText(/Copied to Lab workspace/)).toBeTruthy();

    fireEvent.click(open);
    const copyId = [...fixtures.documents.values()].find((doc) => doc.workspace_id === LAB_WORKSPACE_ID && doc.name === fixtures.documents.get(FIXTURE_DOCUMENT_ID)?.name)?._id;
    expect(copyId).toBeTruthy();
    await waitFor(() => expect(switchWorkspace).toHaveBeenCalledWith(LAB_WORKSPACE_ID, { documentId: copyId, reason: 'link' }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('says when there is no other workspace to copy into', () => {
    function OnlyOne({ children }: { children: ReactNode }) {
      const value: WorkspaceContextValue = {
        workspaces: [PERSONAL], deleted: [], workspace: PERSONAL, multiWorkspace: true, switchWorkspace,
      };
      return (
        <ToastProvider>
          <WorkspaceContext.Provider value={value}>
            <EditorProvider>{children}</EditorProvider>
          </WorkspaceContext.Provider>
        </ToastProvider>
      );
    }
    render(<CopyToWorkspaceDialog page={{ id: FIXTURE_DOCUMENT_ID, name: 'Fixture page', collectionId: null }} onOpenChange={vi.fn()} />, { wrapper: OnlyOne });
    expect(screen.getByText(/You have no other workspace you can add pages to/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Copy' })).toBeNull();
  });
});
