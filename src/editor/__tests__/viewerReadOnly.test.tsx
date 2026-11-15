import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, waitFor } from '@testing-library/react';
import { QueryClientProvider, type QueryClient } from '@tanstack/react-query';
import { createRef, useImperativeHandle } from 'react';
import { createTestQueryClient } from '@/__tests__/queryClient';
import { pathOf, recordRequests } from '@/__tests__/server';
import { TestWorkspace } from '@/__tests__/workspace';
import { EditorProvider } from '@/editor';
import { loadUnsavedDraft } from '@/editor/storage';
import type { Workspace, WorkspaceRole } from '@/data/workspaces';
import {
  LAB_DOCUMENT_ID,
  LAB_WORKSPACE_ID,
  VIEWER_DOCUMENT_ID,
  VIEWER_WORKSPACE_ID,
  fixtures,
  setRoleElsewhere,
  workspaceSummary,
} from '@/dev/msw/fixtures';
import { useEditorProbe } from './editorHarness';

/**
 * M6.UI-2: a viewer's page is read-only. The session never writes it, every
 * edit is refused, and a demotion while the page is open keeps the edits the
 * server never got on this device and says so.
 */

const editorRef = createRef<ReturnType<typeof useEditorProbe>>();

function CaptureEditor() {
  const editor = useEditorProbe();
  useImperativeHandle(editorRef, () => editor, [editor]);
  return null;
}

function editor() {
  if (!editorRef.current) throw new Error('The editor is not mounted');
  return editorRef.current;
}

function rowOf(workspaceId: string, role?: WorkspaceRole): Workspace {
  const stored = fixtures.workspaces.get(workspaceId);
  if (!stored) throw new Error(`No workspace ${workspaceId}`);
  const row = workspaceSummary(stored);
  return role ? { ...row, role } : row;
}

let client: QueryClient;

function Page({ workspace, documentId }: { workspace: Workspace; documentId: string }) {
  return (
    <QueryClientProvider client={client}>
      <TestWorkspace workspace={workspace} initialDocumentId={documentId}>
        <EditorProvider>
          <CaptureEditor />
        </EditorProvider>
      </TestWorkspace>
    </QueryClientProvider>
  );
}

const writes = (sent: Request[]) => sent.filter((request) => request.method !== 'GET');

beforeEach(() => {
  localStorage.clear();
  client = createTestQueryClient();
});

afterEach(() => {
  vi.useRealTimers();
  cleanup();
});

describe('the read-only editor (M6.UI-2)', () => {
  it('reads a viewer’s page and never writes it: no edit, no autosave, no save', async () => {
    const sent = recordRequests();
    render(<Page workspace={rowOf(VIEWER_WORKSPACE_ID)} documentId={VIEWER_DOCUMENT_ID} />);
    await waitFor(() => expect(editor().doc.name).toBe('Week 4: attention variants'));
    expect(editor().readOnly).toBe(true);

    vi.useFakeTimers({ shouldAdvanceTime: true });
    act(() => editor().setDocName('Renamed by a viewer'));
    expect(editor().doc.name).toBe('Week 4: attention variants');
    act(() => editor().save());
    await act(async () => {
      expect(await editor().flushPendingSave()).toBe(true);
      await vi.advanceTimersByTimeAsync(6000);
    });
    expect(writes(sent)).toEqual([]);
    // A viewer's draft never becomes a page either.
    expect(await editor().ensureRemoteDocument()).toBe(VIEWER_DOCUMENT_ID);
  });

  it('turns read-only on a demotion, keeping the edits the server never got on this device', async () => {
    const sent = recordRequests();
    const view = render(<Page workspace={rowOf(LAB_WORKSPACE_ID)} documentId={LAB_DOCUMENT_ID} />);
    await waitFor(() => expect(editor().doc.name).toBe('Lab meeting notes'));
    expect(editor().readOnly).toBe(false);

    act(() => editor().setDocName('Written just before the demotion'));
    // The next workspace read says viewer.
    setRoleElsewhere(LAB_WORKSPACE_ID, 'viewer');
    view.rerender(<Page workspace={rowOf(LAB_WORKSPACE_ID)} documentId={LAB_DOCUMENT_ID} />);

    await waitFor(() => expect(editor().editsKeptReadOnly).toBe(true));
    expect(editor().readOnly).toBe(true);
    // Still on screen, kept on this device, and never sent.
    expect(editor().doc.name).toBe('Written just before the demotion');
    expect(loadUnsavedDraft(LAB_WORKSPACE_ID, LAB_DOCUMENT_ID)?.doc.name).toBe('Written just before the demotion');
    // Nothing is pending: leaving the page asks nothing, the edits are kept.
    expect(editor().hasPendingEdits()).toBe(false);
    vi.useFakeTimers({ shouldAdvanceTime: true });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(6000);
    });
    expect(writes(sent)).toEqual([]);
  });

  it('turns read-only when the server refuses a save for the role, before the workspace read says so', async () => {
    const sent = recordRequests();
    render(<Page workspace={rowOf(LAB_WORKSPACE_ID)} documentId={LAB_DOCUMENT_ID} />);
    await waitFor(() => expect(editor().doc.name).toBe('Lab meeting notes'));

    // Demoted elsewhere; this tab has not read the workspace since.
    setRoleElsewhere(LAB_WORKSPACE_ID, 'viewer');
    vi.useFakeTimers({ shouldAdvanceTime: true });
    act(() => editor().setDocName('Written after the demotion'));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });

    await waitFor(() => expect(editor().readOnly).toBe(true));
    const puts = sent.filter((request) => request.method === 'PUT');
    expect(puts).toHaveLength(1);
    // Not a failure to retry: no error, no second attempt, the edits kept.
    expect(editor().saveError).toBeNull();
    expect(editor().editsKeptReadOnly).toBe(true);
    expect(loadUnsavedDraft(LAB_WORKSPACE_ID, LAB_DOCUMENT_ID)?.doc.name).toBe('Written after the demotion');
    // The role is read again.
    await waitFor(() => expect(sent.some((request) => request.method === 'GET' && pathOf(request).endsWith(`/workspaces/${LAB_WORKSPACE_ID}`))).toBe(true));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });
    expect(sent.filter((request) => request.method === 'PUT')).toHaveLength(1);
  });

  it('saves the kept edits once the role comes back', async () => {
    const sent = recordRequests();
    const view = render(<Page workspace={rowOf(LAB_WORKSPACE_ID)} documentId={LAB_DOCUMENT_ID} />);
    await waitFor(() => expect(editor().doc.name).toBe('Lab meeting notes'));
    act(() => editor().setDocName('Kept through a demotion'));
    view.rerender(<Page workspace={rowOf(LAB_WORKSPACE_ID, 'viewer')} documentId={LAB_DOCUMENT_ID} />);
    await waitFor(() => expect(editor().readOnly).toBe(true));

    vi.useFakeTimers({ shouldAdvanceTime: true });
    view.rerender(<Page workspace={rowOf(LAB_WORKSPACE_ID, 'editor')} documentId={LAB_DOCUMENT_ID} />);
    await waitFor(() => expect(editor().readOnly).toBe(false));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });
    await waitFor(() => expect(sent.filter((request) => request.method === 'PUT')).toHaveLength(1));
    await waitFor(() => expect(loadUnsavedDraft(LAB_WORKSPACE_ID, LAB_DOCUMENT_ID)).toBeNull());
    expect(fixtures.documents.get(LAB_DOCUMENT_ID)?.name).toBe('Kept through a demotion');
  });
});
