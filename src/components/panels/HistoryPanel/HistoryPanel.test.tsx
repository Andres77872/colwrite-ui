import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { cleanup, render, screen, fireEvent, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { HistoryPanel } from './HistoryPanel';
import { buildVersionGraph } from './versionGraph';
import { EditorActionsContext, EditorContext, type EditorContextValue } from '@/editor/editorContextState';
import { ConfirmContext, type ConfirmOptions } from '@/components/ui/confirmContext';
import { ToastContext } from '@/components/ui/toastContext';
import type { Doc } from '@/editor/types';
import * as historyService from '@/services/documentHistory';

/**
 * The panel is the author's window into the server-side version tree. These
 * tests pin its contract: rows describe who saved what and when, the current
 * marker follows the head's pointer rather than the newest revision, restore
 * asks first and then adopts exactly what the server returned without adding a
 * row, and a stale timeline refreshes itself instead of stranding the author
 * on old data.
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
let pendingEdits = false;

function editorValue(documentId: string | null): EditorContextValue {
  return {
    documentId,
    doc: currentDoc,
    hasPendingEdits: () => pendingEdits,
    saveRemote,
    adoptRestoredDocument,
    documentListRevision: 0,
  } as unknown as EditorContextValue;
}

const toast = vi.fn(() => 'toast-1');
let confirmAnswer = true;
const confirm = vi.fn(async (_options: ConfirmOptions) => confirmAnswer);

function renderPanel(documentId: string | null = DOC_ID) {
  const value = editorValue(documentId);
  return render(
    // The fake carries both state and actions, so it feeds both halves of the
    // split context.
    <EditorContext.Provider value={value}>
      <EditorActionsContext.Provider value={value}>
        <ConfirmContext.Provider value={confirm}>
          <ToastContext.Provider value={{ toast, dismiss: () => {} }}>
            <HistoryPanel />
          </ToastContext.Provider>
        </ConfirmContext.Provider>
      </EditorActionsContext.Provider>
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
    currentRevisionId: 'rev-3',
    createdAt: '2026-07-01T09:00:00Z',
    updatedAt: '2026-08-01T12:00:00Z',
    deletedAt: null,
    content: currentDoc,
    etag: 'cw:3',
    ...over,
  };
}

/** The `vN` label of the row carrying the "Current" badge. */
function currentRowLabel(): string {
  const row = screen.getByText('Current').closest('button');
  if (!row) throw new Error('The current badge is not inside a revision row.');
  return row.textContent ?? '';
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
    expect(screen.getByText('AI')).toBeTruthy();
    expect(screen.getByText('Tightened the intro')).toBeTruthy();
    expect(mocked.listRevisions).toHaveBeenCalledWith(DOC_ID, expect.objectContaining({ limit: 30 }));
  });

  it('marks the version the head points at, not the newest one', async () => {
    // After a restore the pointer sits on an older node while the newest
    // revision keeps its place at the top of the list.
    mocked.fetchDocumentHead.mockResolvedValue(
      head({ headSeq: 4, revisionId: 'rev-3', currentRevisionId: 'rev-2' }),
    );

    renderPanel();

    expect(await screen.findByText('v3')).toBeTruthy();
    expect(currentRowLabel()).toContain('v2');
    expect(currentRowLabel()).not.toContain('v3');
  });

  it('shows the empty state without a saved document and calls nothing', () => {
    renderPanel(null);
    expect(screen.getByText('No saved versions yet')).toBeTruthy();
    expect(mocked.listRevisions).not.toHaveBeenCalled();
  });

  it('says so and pages toward the pointer when the current version is off-page', async () => {
    // The document sits on rev-1, which is beyond the first loaded page.
    mocked.fetchDocumentHead.mockResolvedValue(
      head({ headSeq: 7, revisionId: 'rev-6', currentRevisionId: 'rev-1' }),
    );
    mocked.listRevisions.mockImplementation(async (_docId, options) =>
      options?.cursor === 'older'
        ? {
            revisions: [
              revision({ revisionId: 'rev-2', revisionNo: 2, parentRevisionId: 'rev-1' }),
              revision({ revisionId: 'rev-1', revisionNo: 1, parentRevisionId: null, kind: 'create' }),
            ],
            nextCursor: null,
          }
        : {
            revisions: [
              revision({ revisionId: 'rev-6', revisionNo: 6, parentRevisionId: 'rev-5' }),
              revision({ revisionId: 'rev-5', revisionNo: 5, parentRevisionId: 'rev-4' }),
            ],
            nextCursor: 'older',
          },
    );

    renderPanel();

    // Nothing on screen is current, and the panel must say why.
    expect(await screen.findByText(/older version that isn't shown yet/)).toBeTruthy();
    expect(screen.queryByText('Current')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Show current version' }));

    expect(await screen.findByText('v1')).toBeTruthy();
    expect(currentRowLabel()).toContain('v1');
    expect(screen.queryByText(/older version that isn't shown yet/)).toBeNull();
  });

  it('keeps paged-in rows across the refresh a restore triggers', async () => {
    mocked.listRevisions.mockImplementation(async (_docId, options) =>
      options?.cursor === 'older'
        ? {
            revisions: [
              revision({ revisionId: 'rev-1', revisionNo: 1, parentRevisionId: null, kind: 'create' }),
            ],
            nextCursor: null,
          }
        : {
            revisions: [
              revision(),
              revision({ revisionId: 'rev-2', revisionNo: 2, parentRevisionId: 'rev-1' }),
            ],
            nextCursor: 'older',
          },
    );
    mocked.getRevision.mockResolvedValue({ ...revision(), content: currentDoc });
    mocked.diffRevision.mockResolvedValue({
      baseRevisionId: 'rev-3',
      targetRevisionId: 'rev-1',
      targetHeadSeq: null,
      changes: [],
    });
    mocked.restoreRevision.mockImplementation(async () => {
      // The server has moved the pointer; the refresh must observe that.
      mocked.fetchDocumentHead.mockResolvedValue(
        head({ headSeq: 4, currentRevisionId: 'rev-1' }),
      );
      return head({ headSeq: 4, currentRevisionId: 'rev-1' });
    });

    renderPanel();
    fireEvent.click(await screen.findByRole('button', { name: 'Show older versions' }));
    fireEvent.click(await screen.findByText('v1'));
    fireEvent.click(await screen.findByRole('button', { name: /Restore/ }));

    await waitFor(() => {
      expect(mocked.restoreRevision).toHaveBeenCalled();
    });
    // The refreshed first page must merge into — not replace — the loaded
    // rows: the restored-to row stays visible and carries the marker.
    expect(await screen.findByText('v1')).toBeTruthy();
    await waitFor(() => {
      expect(currentRowLabel()).toContain('v1');
    });
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

  it('shows inline equations in a revision diff as equations, not as a ▦ glyph', async () => {
    const block = (revisionId: string, id: string, words: string) => ({
      id,
      type: 'paragraph' as const,
      html: `${words} token <span data-child-id="${id}-eq"></span> ${revisionId === 'rev-1' ? 'goes to' : 'reaches'} an expert`,
      children: [{ id: `${id}-eq`, type: 'equation' as const, latex: 'x_t' }],
      columns: 1,
    });
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
        {
          entity: 'block',
          change: 'moved',
          entityId: 'p2',
          entityType: 'paragraph',
          parentId: null,
          previousParentId: null,
          fromIndex: 1,
          toIndex: 0,
          fields: [],
        },
      ],
    });
    mocked.getRevision.mockImplementation(async (_docId, revisionId) => ({
      ...revision({ revisionId }),
      content: {
        version: 1,
        name: 'Findings',
        blocks: [block(revisionId, 'p1', 'The router assigns'), block(revisionId, 'p2', 'Each')],
      },
    }));

    renderPanel();
    fireEvent.click(await screen.findByText('v2'));

    expect(await screen.findByText('Paragraph changed')).toBeTruthy();
    expect(await screen.findByText(/moved from position/)).toBeTruthy();
    // One equation in the word diff, one in the moved block's snippet.
    expect(screen.getAllByRole('img', { name: 'Equation: x_t' })).toHaveLength(2);
    expect(document.body.textContent).not.toContain('\u25A6');
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
    mocked.restoreRevision.mockResolvedValue(
      head({ headSeq: 4, currentRevisionId: 'rev-2', content: restoredDoc }),
    );

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

  it('explains that switching versions writes nothing and branches on save', async () => {
    mocked.diffRevision.mockResolvedValue({
      baseRevisionId: 'rev-1',
      targetRevisionId: 'rev-2',
      targetHeadSeq: null,
      changes: [],
    });
    mocked.getRevision.mockResolvedValue({ ...revision(), content: currentDoc });
    mocked.restoreRevision.mockResolvedValue(head({ headSeq: 4, currentRevisionId: 'rev-2' }));

    renderPanel();
    fireEvent.click(await screen.findByText('v2'));
    fireEvent.click(await screen.findByRole('button', { name: /Restore/ }));

    await waitFor(() => expect(confirm).toHaveBeenCalled());
    const description = String(confirm.mock.calls[0][0].description);
    expect(description).toContain('does not create a new version');
    expect(description).toContain('new branch');
  });

  it('moves the current marker on restore without adding a revision row', async () => {
    mocked.diffRevision.mockResolvedValue({
      baseRevisionId: 'rev-1',
      targetRevisionId: 'rev-2',
      targetHeadSeq: null,
      changes: [],
    });
    mocked.getRevision.mockResolvedValue({ ...revision(), content: currentDoc });
    // Restore is a pointer move: same revisions, new head_seq, pointer on the
    // restored node. The panel refetches the head to pick that up.
    mocked.restoreRevision.mockResolvedValue(head({ headSeq: 4, currentRevisionId: 'rev-2' }));

    renderPanel();
    expect(await screen.findByText('v3')).toBeTruthy();
    expect(currentRowLabel()).toContain('v3');
    const headReadsBefore = mocked.fetchDocumentHead.mock.calls.length;
    mocked.fetchDocumentHead.mockResolvedValue(
      head({ headSeq: 4, currentRevisionId: 'rev-2' }),
    );

    fireEvent.click(screen.getByText('v2'));
    fireEvent.click(await screen.findByRole('button', { name: /Restore/ }));

    await waitFor(() => expect(currentRowLabel()).toContain('v2'));
    // The head is re-read rather than inferred from a row the restore did not write.
    expect(mocked.fetchDocumentHead.mock.calls.length).toBeGreaterThan(headReadsBefore);
    expect(screen.getAllByRole('listitem')).toHaveLength(2);
    expect(screen.queryByText('v4')).toBeNull();
  });

  it('offers no restore on the version the document is already on', async () => {
    mocked.diffRevision.mockResolvedValue({
      baseRevisionId: 'rev-2',
      targetRevisionId: 'rev-3',
      targetHeadSeq: null,
      changes: [],
    });
    mocked.getRevision.mockResolvedValue({ ...revision(), content: currentDoc });

    renderPanel();
    fireEvent.click(await screen.findByText('v3'));

    expect(await screen.findByText('The document is on this version')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Restore/ })).toBeNull();
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

  it('flags a fork point where two loaded versions share a parent', async () => {
    mocked.listRevisions.mockResolvedValue({
      revisions: [
        revision({ revisionId: 'rev-3', revisionNo: 3, parentRevisionId: 'rev-1' }),
        revision({ revisionId: 'rev-2', revisionNo: 2, parentRevisionId: 'rev-1' }),
        revision({ revisionId: 'rev-1', revisionNo: 1, parentRevisionId: null, kind: 'create' }),
      ],
      nextCursor: null,
    });

    renderPanel();

    expect(await screen.findByText('2 branches')).toBeTruthy();
    const forkRow = screen.getByText('2 branches').closest('button');
    expect(forkRow?.textContent).toContain('v1');
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

/**
 * The rail is decoration, but its lane math is what makes a branch legible.
 * These cover the two shapes the flat list cannot express on its own: a fork,
 * and a parent that lives on a page nobody has loaded yet.
 */
describe('buildVersionGraph', () => {
  it('keeps a straight line of saves in a single lane', () => {
    const graph = buildVersionGraph([
      { revisionId: 'c', parentRevisionId: 'b' },
      { revisionId: 'b', parentRevisionId: 'a' },
      { revisionId: 'a', parentRevisionId: null },
    ]);

    expect(graph.laneCount).toBe(1);
    expect(graph.rows.map((row) => row.lane)).toEqual([0, 0, 0]);
    expect(graph.rows.map((row) => row.parentLane)).toEqual([0, 0, null]);
    expect(graph.rows.map((row) => row.hasChildAbove)).toEqual([false, true, true]);
    expect(graph.rows.every((row) => !row.isFork)).toBe(true);
    expect(graph.rows.every((row) => !row.parentDangling)).toBe(true);
    // The oldest row is a root: nothing continues past the list.
    expect(graph.danglingLanes).toEqual([]);
  });

  it('gives the second child of a fork its own lane and curves it into the parent', () => {
    // `root` was restored, then saved again: two children, newest first.
    const graph = buildVersionGraph([
      { revisionId: 'branch-b', parentRevisionId: 'root' },
      { revisionId: 'branch-a', parentRevisionId: 'root' },
      { revisionId: 'root', parentRevisionId: null },
    ]);
    const [newest, sibling, root] = graph.rows;

    expect(graph.laneCount).toBe(2);
    // The newest child holds the lane the parent will inherit.
    expect(newest.lane).toBe(0);
    expect(newest.parentLane).toBe(0);
    // The older sibling opens a lane of its own and bends back into lane 0.
    expect(sibling.lane).toBe(1);
    expect(sibling.parentLane).toBe(0);
    expect(sibling.through).toEqual([{ lane: 0, dangling: false }]);
    // The fork point is the parent, and it keeps the inherited lane.
    expect(root.lane).toBe(0);
    expect(root.childCount).toBe(2);
    expect(root.isFork).toBe(true);
    expect(root.hasChildAbove).toBe(true);
    expect(root.parentLane).toBeNull();
    expect(root.through).toEqual([]);
  });

  it('marks an edge dangling when the parent is not on a loaded page', () => {
    const graph = buildVersionGraph([
      { revisionId: 'newest', parentRevisionId: 'older-page' },
      { revisionId: 'orphan-branch', parentRevisionId: 'older-page' },
    ]);
    const [newest, sibling] = graph.rows;

    expect(newest.parentLane).toBe(0);
    expect(newest.parentDangling).toBe(true);
    expect(newest.isFork).toBe(false);
    // Sharing an unloaded parent still shares its lane, and the whole edge
    // fades toward "Show older versions".
    expect(sibling.lane).toBe(1);
    expect(sibling.parentLane).toBe(0);
    expect(sibling.parentDangling).toBe(true);
    expect(sibling.through).toEqual([{ lane: 0, dangling: true }]);
    // Only lane 0 leaves the bottom of the list — lane 1 folded into it.
    expect(graph.danglingLanes).toEqual([0]);
  });

  it('never reports a parent listed above the child as resolved', () => {
    // Defensive: pages arrive newest-first, so a parent above its child is
    // corrupt input, not a lineage the rail can draw.
    const graph = buildVersionGraph([
      { revisionId: 'parent', parentRevisionId: null },
      { revisionId: 'child', parentRevisionId: 'parent' },
    ]);

    expect(graph.rows[0].isFork).toBe(false);
    expect(graph.rows[0].childCount).toBe(0);
    expect(graph.rows[1].parentDangling).toBe(true);
  });

  it('returns nothing to draw for an empty timeline', () => {
    expect(buildVersionGraph([])).toEqual({ rows: [], laneCount: 0, danglingLanes: [] });
  });
});
