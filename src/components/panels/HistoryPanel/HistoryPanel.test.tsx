import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { cleanup, render, screen, fireEvent, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { HistoryPanel } from './HistoryPanel';
import { EditorContext, type EditorContextValue } from '@/editor/editorContextState';
import { ConfirmContext } from '@/components/ui/confirmContext';
import { ToastContext } from '@/components/ui/toastContext';
import type { Doc } from '@/editor/types';
import * as historyService from '@/services/documentHistory';
import { ApiError } from '@/services/contracts';

/**
 * The panel is the author's window into the server-side timeline. These tests
 * pin its contract: rows describe who saved what and when, restore asks first
 * and then adopts exactly what the server returned, and a stale timeline
 * refreshes itself instead of stranding the author on old data.
 */

vi.mock('@/services/documentHistory', async () => {
  const actual = await vi.importActual<typeof historyService>('@/services/documentHistory');
  return {
    ...actual,
    fetchDocumentHead: vi.fn(),
    listRevisions: vi.fn(),
    getRevision: vi.fn(),
    diffRevision: vi.fn(),
    restoreRevision: vi.fn(),
  };
});

const mocked = vi.mocked(historyService);

afterEach(cleanup);

const DOC_ID = 'doc-1';
const currentDoc: Doc = {
  version: 3,
  name: 'Findings',
  blocks: [{ id: 'p1', type: 'paragraph', html: 'Hello world', children: [], columns: 1 }],
};

const adoptRestoredDocument = vi.fn();
const saveRemote = vi.fn(async () => {});
const waitForReady = vi.fn(async () => ({ ready: true, status: 'ready' }));
let pendingEdits = false;

function editorValue(documentId: string | null): EditorContextValue {
  return {
    documentId,
    doc: currentDoc,
    hasPendingEdits: () => pendingEdits,
    saveRemote,
    adoptRestoredDocument,
    documentListRevision: 0,
    waitForReady,
  } as unknown as EditorContextValue;
}

const toast = vi.fn(() => 'toast-1');
let confirmAnswer = true;
const confirm = vi.fn(async () => confirmAnswer);

function renderPanel(documentId: string | null = DOC_ID) {
  return render(
    <EditorContext.Provider value={editorValue(documentId)}>
      <ConfirmContext.Provider value={confirm}>
        <ToastContext.Provider value={{ toast, dismiss: () => {} }}>
          <HistoryPanel />
        </ToastContext.Provider>
      </ConfirmContext.Provider>
    </EditorContext.Provider>,
  ) as { container: HTMLElement } & { unmount: () => void; rerender: (ui: ReactNode) => void };
}

function revision(over: Partial<historyService.RevisionSummary> = {}): historyService.RevisionSummary {
  return {
    revisionId: 'rev-3',
    revisionNo: 3,
    parentRevisionId: 'rev-2',
    kind: 'save',
    actorType: 'human',
    origin: 'human',
    createdAt: '2026-08-01T12:00:00Z',
    byteSize: 512,
    contentHash: 'hash-3',
    restoredFromRevisionId: null,
    summary: null,
    ...over,
  };
}

function head(over: Partial<historyService.DocumentHead> = {}): historyService.DocumentHead {
  return {
    documentId: DOC_ID,
    headSeq: 3,
    revisionNo: 3,
    revisionId: 'rev-3',
    createdAt: '2026-07-01T09:00:00Z',
    updatedAt: '2026-08-01T12:00:00Z',
    deletedAt: null,
    content: currentDoc,
    etag: 'cw:3',
    ...over,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  pendingEdits = false;
  confirmAnswer = true;
  mocked.fetchDocumentHead.mockResolvedValue(head());
  mocked.listRevisions.mockResolvedValue({
    revisions: [
      revision(),
      revision({
        revisionId: 'rev-2',
        revisionNo: 2,
        parentRevisionId: 'rev-1',
        kind: 'semantic_edit',
        origin: 'agent',
        summary: 'Tightened the intro',
      }),
    ],
    nextCursor: null,
  });
});

describe('HistoryPanel', () => {
  it('lists revisions newest first with kind, origin, and current markers', async () => {
    renderPanel();

    expect(await screen.findByText('v3')).toBeTruthy();
    expect(screen.getByText('v2')).toBeTruthy();
    expect(screen.getByText('Current')).toBeTruthy();
    expect(screen.getByText('Assistant')).toBeTruthy();
    expect(screen.getByText('Tightened the intro')).toBeTruthy();
    expect(mocked.listRevisions).toHaveBeenCalledWith(DOC_ID, expect.objectContaining({ limit: 30 }));
  });

  it('shows the empty state without a saved document and calls nothing', () => {
    renderPanel(null);
    expect(screen.getByText('No saved versions yet')).toBeTruthy();
    expect(mocked.listRevisions).not.toHaveBeenCalled();
  });

  it('expands a revision and loads what that save changed against its parent', async () => {
    mocked.diffRevision.mockResolvedValue({
      baseRevisionId: 'rev-1',
      targetRevisionId: 'rev-2',
      targetHeadSeq: null,
      changes: [
        {
          entity: 'block',
          change: 'changed',
          entityId: 'p1',
          entityType: 'paragraph',
          parentId: null,
          previousParentId: null,
          fromIndex: null,
          toIndex: null,
          fields: ['html'],
        },
      ],
    });
    mocked.getRevision.mockImplementation(async (_docId, revisionId) => ({
      ...revision({ revisionId }),
      content: {
        version: 1,
        name: 'Findings',
        blocks: [
          {
            id: 'p1',
            type: 'paragraph',
            html: revisionId === 'rev-1' ? 'Hello there' : 'Hello world',
            children: [],
            columns: 1,
          },
        ],
      },
    }));

    renderPanel();
    fireEvent.click(await screen.findByText('v2'));

    await waitFor(() => {
      expect(mocked.diffRevision).toHaveBeenCalledWith(
        DOC_ID,
        'rev-1',
        'rev-2',
        expect.anything(),
      );
    });
    expect(await screen.findByText('Paragraph changed')).toBeTruthy();
  });

  it('restores after confirmation and adopts the returned head', async () => {
    mocked.diffRevision.mockResolvedValue({
      baseRevisionId: 'rev-1',
      targetRevisionId: 'rev-2',
      targetHeadSeq: null,
      changes: [],
    });
    mocked.getRevision.mockResolvedValue({ ...revision(), content: currentDoc });
    const restoredDoc: Doc = { version: 1, name: 'Findings', blocks: [] };
    mocked.restoreRevision.mockResolvedValue(head({ headSeq: 4, revisionId: 'rev-4', content: restoredDoc }));

    renderPanel();
    fireEvent.click(await screen.findByText('v2'));
    fireEvent.click(await screen.findByRole('button', { name: /Restore/ }));

    await waitFor(() => {
      expect(mocked.restoreRevision).toHaveBeenCalledWith(DOC_ID, 'rev-2', {
        summary: 'Restored version 2',
      });
    });
    expect(confirm).toHaveBeenCalled();
    expect(adoptRestoredDocument).toHaveBeenCalledWith(restoredDoc, 4);
    expect(toast).toHaveBeenCalledWith(
      expect.objectContaining({ variant: 'success' }),
    );
  });

  it('saves pending edits before restoring so nothing is lost', async () => {
    pendingEdits = true;
    mocked.diffRevision.mockResolvedValue({
      baseRevisionId: 'rev-1',
      targetRevisionId: 'rev-2',
      targetHeadSeq: null,
      changes: [],
    });
    mocked.getRevision.mockResolvedValue({ ...revision(), content: currentDoc });
    mocked.restoreRevision.mockResolvedValue(head({ headSeq: 5 }));

    renderPanel();
    fireEvent.click(await screen.findByText('v2'));
    fireEvent.click(await screen.findByRole('button', { name: /Restore/ }));

    await waitFor(() => expect(mocked.restoreRevision).toHaveBeenCalled());
    expect(saveRemote).toHaveBeenCalled();
    expect(saveRemote.mock.invocationCallOrder[0]).toBeLessThan(
      mocked.restoreRevision.mock.invocationCallOrder[0],
    );
  });

  it('does nothing when the confirmation is declined', async () => {
    confirmAnswer = false;
    mocked.diffRevision.mockResolvedValue({
      baseRevisionId: 'rev-1',
      targetRevisionId: 'rev-2',
      targetHeadSeq: null,
      changes: [],
    });
    mocked.getRevision.mockResolvedValue({ ...revision(), content: currentDoc });

    renderPanel();
    fireEvent.click(await screen.findByText('v2'));
    fireEvent.click(await screen.findByRole('button', { name: /Restore/ }));

    await waitFor(() => expect(confirm).toHaveBeenCalled());
    expect(mocked.restoreRevision).not.toHaveBeenCalled();
    expect(adoptRestoredDocument).not.toHaveBeenCalled();
  });

  it('lets projections catch up before restoring', async () => {
    mocked.diffRevision.mockResolvedValue({
      baseRevisionId: 'rev-1',
      targetRevisionId: 'rev-2',
      targetHeadSeq: null,
      changes: [],
    });
    mocked.getRevision.mockResolvedValue({ ...revision(), content: currentDoc });
    mocked.restoreRevision.mockResolvedValue(head({ headSeq: 4 }));

    renderPanel();
    fireEvent.click(await screen.findByText('v2'));
    fireEvent.click(await screen.findByRole('button', { name: /Restore/ }));
    await waitFor(() => expect(mocked.restoreRevision).toHaveBeenCalled());

    expect(waitForReady).toHaveBeenCalledWith({ save: false, timeoutMs: 4000 });
    expect(waitForReady.mock.invocationCallOrder[0]).toBeLessThan(
      mocked.restoreRevision.mock.invocationCallOrder[0],
    );
  });

  it('auto-polls a bounded number of times while history is being prepared', async () => {
    vi.useFakeTimers();
    try {
      mocked.fetchDocumentHead.mockRejectedValue(
        new ApiError('pending', 503, { code: 'projection_pending', retryable: true }),
      );
      mocked.listRevisions.mockRejectedValue(
        new ApiError('pending', 503, { code: 'projection_pending', retryable: true }),
      );

      renderPanel();
      await vi.waitFor(() =>
        expect(
          screen.getByText('The history for this document is still being prepared.'),
        ).toBeTruthy(),
      );
      expect(screen.getByRole('button', { name: 'Check again' })).toBeTruthy();
      const callsAfterFirstLoad = mocked.fetchDocumentHead.mock.calls.length;

      // The panel retries by itself while the server prepares the timeline…
      await vi.advanceTimersByTimeAsync(1000);
      await vi.waitFor(() =>
        expect(mocked.fetchDocumentHead.mock.calls.length).toBeGreaterThan(
          callsAfterFirstLoad,
        ),
      );

      // …and stops adding attempts once the budget is spent.
      await vi.advanceTimersByTimeAsync(60_000);
      const settled = mocked.fetchDocumentHead.mock.calls.length;
      await vi.advanceTimersByTimeAsync(60_000);
      expect(mocked.fetchDocumentHead.mock.calls.length).toBe(settled);
      expect(settled).toBeLessThanOrEqual(1 + 5);
    } finally {
      vi.useRealTimers();
    }
  });

  it('surfaces a failed load with a retry action', async () => {
    mocked.fetchDocumentHead.mockRejectedValue(new Error('boom'));
    mocked.listRevisions.mockRejectedValue(new Error('boom'));

    renderPanel();

    expect(await screen.findByText('boom')).toBeTruthy();
    mocked.fetchDocumentHead.mockResolvedValue(head());
    mocked.listRevisions.mockResolvedValue({ revisions: [revision()], nextCursor: null });
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByText('v3')).toBeTruthy();
  });
});
