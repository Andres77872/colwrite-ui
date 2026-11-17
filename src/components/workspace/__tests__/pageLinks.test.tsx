import { act, cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderWithQueryClient as render } from '@/__tests__/queryClient';
import { ToastProvider } from '@/components/ui/toast';
import { EditorProvider, useDocumentId } from '@/editor';
import { ChatRefTags } from '@/components/editor/ChatAssistant/ChatRefTags';
import { useOpenPageLink } from '@/actions/usePageLink';
import { pageIdOf } from '@/lib/pageLink';
import {
  FIXTURE_DOCUMENT_ID,
  LAB_DOCUMENT_ID,
  LAB_WORKSPACE_ID,
  PERSONAL_WORKSPACE_ID,
} from '@/dev/msw/fixtures';
import { WorkspaceContext, type WorkspaceContextValue } from '../workspaceContextState';

/**
 * Links into another workspace from inside one (M5.UI-2, 11 §5 "Following
 * links"): a chat `#doc/…` reference and a pasted page link are located
 * first. A page of this workspace opens in place; one of another of the
 * author's workspaces says "This page is in another workspace" and Open
 * switches there; one the author cannot open says it is not available.
 */

const PERSONAL = { id: PERSONAL_WORKSPACE_ID, name: 'Personal', kind: 'personal', role: 'owner', icon: null, last_opened_at: null, member_count: 1 } as const;
const LAB = { id: LAB_WORKSPACE_ID, name: 'Lab workspace', kind: 'shared', role: 'editor', icon: null, last_opened_at: null, member_count: 3 } as const;
const switchWorkspace = vi.fn(async () => {});

function Workspaces({ children }: { children: ReactNode }) {
  const value: WorkspaceContextValue = {
    workspaces: [PERSONAL, LAB], deleted: [], workspace: PERSONAL, multiWorkspace: true, switchWorkspace,
  };
  return (
    <ToastProvider>
      <WorkspaceContext.Provider value={value}>
        <EditorProvider>{children}</EditorProvider>
      </WorkspaceContext.Provider>
    </ToastProvider>
  );
}

function OpenButton({ id }: { id: string }) {
  const open = useOpenPageLink();
  const shown = useDocumentId();
  return (
    <>
      <p data-testid="open">{shown ?? 'none'}</p>
      <button type="button" onClick={() => void open(id)}>Follow {id}</button>
    </>
  );
}

afterEach(() => {
  cleanup();
  localStorage.clear();
  switchWorkspace.mockClear();
});

describe('a chat reference to a page', () => {
  it('says a page of another workspace is there, and opens it in that workspace', async () => {
    render(<ChatRefTags text={`See #doc/${LAB_DOCUMENT_ID} for the agenda`} />, { wrapper: Workspaces });

    fireEvent.click(screen.getByRole('button', { name: /^Page / }));
    expect(await screen.findByText('This page is in another workspace')).toBeTruthy();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Open in Lab workspace' }));
    });
    expect(switchWorkspace).toHaveBeenCalledWith(LAB_WORKSPACE_ID, { documentId: LAB_DOCUMENT_ID, reason: 'link' });
  });

  it('says plainly that a page it cannot open is not available, and offers nothing to open', async () => {
    render(<ChatRefTags text="#doc/66f0c0ffee000000000000ff" />, { wrapper: Workspaces });

    fireEvent.click(screen.getByRole('button', { name: /^Page / }));
    expect(await screen.findByText('This page isn’t available')).toBeTruthy();
    expect(screen.getByText('It may have been deleted, or you may not have access.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /^Open/ })).toBeNull();
  });

  it('opens a page of this workspace in place', async () => {
    render(<ChatRefTags text={`#doc/${FIXTURE_DOCUMENT_ID}`} />, { wrapper: Workspaces });

    fireEvent.click(screen.getByRole('button', { name: /^Page / }));
    expect(await screen.findByText('A page in this workspace')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Open' })).toBeTruthy();
    expect(switchWorkspace).not.toHaveBeenCalled();
  });
});

describe('following a page link', () => {
  it('opens a page of this workspace in the editor, with no switch', async () => {
    render(<OpenButton id={FIXTURE_DOCUMENT_ID} />, { wrapper: Workspaces });
    fireEvent.click(screen.getByRole('button', { name: `Follow ${FIXTURE_DOCUMENT_ID}` }));
    await waitFor(() => expect(screen.getByTestId('open').textContent).toBe(FIXTURE_DOCUMENT_ID));
    expect(switchWorkspace).not.toHaveBeenCalled();
  });

  it('switches to the workspace of a page that is in another one', async () => {
    render(<OpenButton id={LAB_DOCUMENT_ID} />, { wrapper: Workspaces });
    fireEvent.click(screen.getByRole('button', { name: `Follow ${LAB_DOCUMENT_ID}` }));
    await waitFor(() => expect(switchWorkspace).toHaveBeenCalledWith(LAB_WORKSPACE_ID, { documentId: LAB_DOCUMENT_ID, reason: 'link' }));
  });

  it('says a link it cannot open is not available, and changes nothing', async () => {
    render(<OpenButton id="66f0c0ffee000000000000ff" />, { wrapper: Workspaces });
    fireEvent.click(screen.getByRole('button', { name: 'Follow 66f0c0ffee000000000000ff' }));
    expect(await screen.findByText('This page isn’t available')).toBeTruthy();
    expect(screen.getByTestId('open').textContent).toBe('none');
    expect(switchWorkspace).not.toHaveBeenCalled();
  });

  it('recognises this app’s page links, and nothing else', () => {
    expect(pageIdOf(`${window.location.origin}/?doc=${LAB_DOCUMENT_ID}`)).toBe(LAB_DOCUMENT_ID);
    expect(pageIdOf(`/?ws=${LAB_WORKSPACE_ID}&doc=${LAB_DOCUMENT_ID}`)).toBe(LAB_DOCUMENT_ID);
    expect(pageIdOf(`https://elsewhere.example/?doc=${LAB_DOCUMENT_ID}`)).toBeNull();
    expect(pageIdOf(`${window.location.origin}/?view=settings`)).toBeNull();
  });
});
