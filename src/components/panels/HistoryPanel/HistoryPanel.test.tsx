import { itemAt, takeItems } from '@/lib/itemAt';
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { cleanup, screen, fireEvent, waitFor } from '@testing-library/react';
import { renderWithQueryClient as render } from '@/__tests__/queryClient';
import type { ReactNode } from 'react';
import { HistoryPanel } from './HistoryPanel';
import { buildVersionGraph } from './versionGraph';
import { FakeEditorProviders, type EditorProbe } from '@/editor/__tests__/editorHarness';
import { ConfirmContext, type ConfirmOptions } from '@/components/ui/confirmContext';
import { ToastContext, type ToastOptions } from '@/components/ui/toastContext';
import { ProposalsContext, type ProposalsContextValue } from '@/editor/proposalsContextState';
import { PanelsContext, type PanelsContextValue, type SidebarTab } from '../panelsContextState';
import type { Block, Doc } from '@/editor/types';
import * as historyService from '@/data/documentHistory';
import { HttpResponse, http, server, serverError } from '@/__tests__/server';
import { documentStateBody, revisionPageBody } from '@/data/__tests__/historyFixtures';
import { TEST_WORKSPACE_ID } from '@/__tests__/workspace';

/**
 * The panel is the author's window into the server-side version tree. These
 * tests pin its contract: rows describe who saved what and when, the current
 * marker follows the head's pointer rather than the newest revision, restore
 * asks first and then adopts exactly what the server returned without adding a
 * row, and a stale timeline refreshes itself instead of stranding the author
 * on old data.
 */

// The panel reads one revision, a diff and a restore itself.
vi.mock('@/data/documentHistory', async () => {
  const actual = await vi.importActual<typeof historyService>('@/data/documentHistory');
  return {
    ...actual,
    getRevision: vi.fn(),
    diffRevision: vi.fn(),
    restoreRevision: vi.fn(),
  };
});

const mocked = vi.mocked(historyService);

/**
 * The server's head and timeline, which the panel reads through the query
 * layer: the head, and a page of revisions by its query (`limit`, `cursor`).
 * A `TypeError` they throw is the network failing; any other error is the
 * server failing with its message.
 */
const history = {
  head: vi.fn<() => Promise<historyService.DocumentHead>>(),
  revisions: vi.fn<(query: Record<string, string>) => Promise<historyService.RevisionPage>>(),
};

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const DOC_ID = 'doc-1';
const currentDoc: Doc = {
  name: 'Findings',
  blocks: [{ id: 'p1', type: 'paragraph', html: 'Hello world', children: [], columns: 1 }],
};

const adoptRestoredDocument = vi.fn();
const saveRemote = vi.fn(async () => {});
let pendingEdits = false;

function editorValue(documentId: string | null, savedAt?: number): EditorProbe {
  return {
    documentId,
    doc: currentDoc,
    lastSavedAt: savedAt ?? null,
    hasPendingEdits: () => pendingEdits,
    saveRemote,
    adoptRestoredDocument,
  } as unknown as EditorProbe;
}

const toast = vi.fn((_options: ToastOptions) => 'toast-1');
let confirmAnswer = true;
const confirm = vi.fn(async (_options: ConfirmOptions) => confirmAnswer);

type PanelOptions = {
  /** When the open page was last saved; a save moves it on. */
  savedAt?: number;
  /** The sidebar's tab, when the panel is mounted inside it. */
  tab?: SidebarTab;
  pendingSuggestions?: number;
};

function panelTree(documentId: string | null, options: PanelOptions = {}): ReactNode {
  const value = editorValue(documentId, options.savedAt);
  // The fake carries every slice, so it feeds every editor context.
  let tree: ReactNode = (
    <FakeEditorProviders value={value}>
      <ConfirmContext.Provider value={confirm}>
        <ToastContext.Provider value={{ toast, dismiss: () => {} }}>
          <HistoryPanel />
        </ToastContext.Provider>
      </ConfirmContext.Provider>
    </FakeEditorProviders>
  );
  if (options.pendingSuggestions !== undefined) {
    tree = (
      <ProposalsContext.Provider value={{ pendingCount: options.pendingSuggestions } as ProposalsContextValue}>
        {tree}
      </ProposalsContext.Provider>
    );
  }
  if (options.tab) {
    tree = (
      <PanelsContext.Provider value={{ isOpen: true, activePanel: options.tab } as PanelsContextValue}>
        {tree}
      </PanelsContext.Provider>
    );
  }
  return tree;
}

function renderPanel(documentId: string | null = DOC_ID, options: PanelOptions = {}) {
  const view = render(panelTree(documentId, options));
  return { ...view, update: (next: PanelOptions) => view.rerender(panelTree(documentId, next)) };
}

/** A one-change diff of block `id`, and the two revisions' blocks it compares. */
function mockChange(
  change: Partial<historyService.RevisionChange> & { entityId: string; fields: string[] },
  before: Block[],
  after: Block[],
) {
  mocked.diffRevision.mockResolvedValue({
    baseRevisionId: 'rev-1',
    targetRevisionId: 'rev-2',
    changes: [
      {
        entity: 'block',
        change: 'changed',
        entityType: 'paragraph',
        parentId: null,
        previousParentId: null,
        fromIndex: null,
        toIndex: null,
        ...change,
      },
    ],
  });
  mocked.getRevision.mockImplementation(async (_workspaceId, _docId, revisionId) => ({
    ...revision({ revisionId }),
    content: { name: 'Findings', blocks: revisionId === 'rev-1' ? before : after },
  }));
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

/** The row of revision `id`; the panel tags each row with its revision id. */
function row(id: string): HTMLElement | null {
  return document.querySelector<HTMLElement>(`[data-revision-id="${id}"]`);
}

function findRow(id: string): Promise<HTMLElement> {
  return waitFor(() => {
    const found = row(id);
    if (!found) throw new Error(`No row for ${id}`);
    return found;
  });
}

/** The revision id of the row carrying the "Current" badge. */
function currentRow(): string {
  const current = screen.getByText('Current').closest<HTMLElement>('[data-revision-id]');
  if (!current) throw new Error('The current badge is not inside a revision row.');
  return current.dataset.revisionId ?? '';
}

beforeEach(() => {
  vi.clearAllMocks();
  pendingEdits = false;
  confirmAnswer = true;
  const failed = (error: unknown) => (error instanceof TypeError ? HttpResponse.error() : serverError(error));
  server.use(
    http.get('/workspaces/{workspace_id}/documents/{document_id}', ({ response }) => history.head().then(
      (current) => response(200).json(documentStateBody(current), { headers: current.etag ? { ETag: current.etag } : {} }),
      (error: unknown) => response.untyped(failed(error)),
    )),
    http.get('/workspaces/{workspace_id}/documents/{document_id}/revisions', ({ request, response }) =>
      history.revisions(Object.fromEntries(new URL(request.url).searchParams)).then(
        (page) => response(200).json(revisionPageBody(page)),
        (error: unknown) => response.untyped(failed(error)),
      )),
  );
  history.head.mockResolvedValue(head());
  history.revisions.mockResolvedValue({
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

    expect(await findRow('rev-3')).toBeTruthy();
    expect(row('rev-2')!).toBeTruthy();
    // The save counter is never shown: "version" means History's versions.
    expect(document.body.textContent).not.toMatch(/\bv\d+\b/);
    expect(screen.getByText('Current')).toBeTruthy();
    expect(screen.getByText('AI')).toBeTruthy();
    expect(screen.getByText('Tightened the intro')).toBeTruthy();
    expect(history.revisions).toHaveBeenCalledWith(expect.objectContaining({ limit: '30' }));
  });

  it('marks the version the head points at, not the newest one', async () => {
    // After a restore the pointer sits on an older node while the newest
    // revision keeps its place at the top of the list.
    history.head.mockResolvedValue(
      head({ etag: 'cw:4', revisionId: 'rev-3', currentRevisionId: 'rev-2' }),
    );

    renderPanel();

    expect(await findRow('rev-3')).toBeTruthy();
    expect(currentRow()).toBe('rev-2');
    expect(currentRow()).not.toBe('rev-3');
  });

  it('shows the empty state without a saved page and calls nothing', () => {
    renderPanel(null);
    expect(screen.getByText('No saved versions yet')).toBeTruthy();
    expect(history.revisions).not.toHaveBeenCalled();
  });

  it('says so and pages toward the pointer when the current version is off-page', async () => {
    // The document sits on rev-1, which is beyond the first loaded page.
    history.head.mockResolvedValue(
      head({ etag: 'cw:7', revisionId: 'rev-6', currentRevisionId: 'rev-1' }),
    );
    history.revisions.mockImplementation(async (query) =>
      query.cursor === 'older'
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

    expect(await findRow('rev-1')).toBeTruthy();
    expect(currentRow()).toBe('rev-1');
    expect(screen.queryByText(/older version that isn't shown yet/)).toBeNull();
  });

  it('keeps paged-in rows across the refresh a restore triggers', async () => {
    history.revisions.mockImplementation(async (query) =>
      query.cursor === 'older'
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
      changes: [],
    });
    mocked.restoreRevision.mockImplementation(async () => {
      // The server has moved the pointer; the refresh must observe that.
      history.head.mockResolvedValue(
        head({ etag: 'cw:4', currentRevisionId: 'rev-1' }),
      );
      return head({ etag: 'cw:4', currentRevisionId: 'rev-1' });
    });

    renderPanel();
    fireEvent.click(await screen.findByRole('button', { name: 'Show older versions' }));
    fireEvent.click(await findRow('rev-1'));
    fireEvent.click(await screen.findByRole('button', { name: /Restore/ }));

    await waitFor(() => {
      expect(mocked.restoreRevision).toHaveBeenCalled();
    });
    // The refreshed first page must merge into — not replace — the loaded
    // rows: the restored-to row stays visible and carries the marker.
    expect(await findRow('rev-1')).toBeTruthy();
    await waitFor(() => {
      expect(currentRow()).toBe('rev-1');
    });
  });

  it('expands a revision and loads what that save changed against its parent', async () => {
    mocked.diffRevision.mockResolvedValue({
      baseRevisionId: 'rev-1',
      targetRevisionId: 'rev-2',
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
    mocked.getRevision.mockImplementation(async (_workspaceId, _docId, revisionId) => ({
      ...revision({ revisionId }),
      content: {
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
    fireEvent.click(await findRow('rev-2'));

    await waitFor(() => {
      expect(mocked.diffRevision).toHaveBeenCalledWith(
        TEST_WORKSPACE_ID, DOC_ID,
        'rev-1',
        'rev-2',
        expect.anything(),
      );
    });
    expect(await screen.findByText('Text changed')).toBeTruthy();
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
    mocked.getRevision.mockImplementation(async (_workspaceId, _docId, revisionId) => ({
      ...revision({ revisionId }),
      content: {
        name: 'Findings',
        blocks: [block(revisionId, 'p1', 'The router assigns'), block(revisionId, 'p2', 'Each')],
      },
    }));

    renderPanel();
    fireEvent.click(await findRow('rev-2'));

    expect(await screen.findByText('Text changed')).toBeTruthy();
    expect(await screen.findByText(/moved from position/)).toBeTruthy();
    // One equation in the word diff, one in the moved block's snippet.
    expect(screen.getAllByRole('img', { name: 'Equation: x_t' })).toHaveLength(2);
    expect(document.body.textContent).not.toContain('\u25A6');
  });

  it('restores after confirmation and adopts the returned head', async () => {
    mocked.diffRevision.mockResolvedValue({
      baseRevisionId: 'rev-1',
      targetRevisionId: 'rev-2',
      changes: [],
    });
    mocked.getRevision.mockResolvedValue({ ...revision(), content: currentDoc });
    const restoredDoc: Doc = { name: 'Findings', blocks: [] };
    mocked.restoreRevision.mockResolvedValue(
      head({ etag: 'cw:4', currentRevisionId: 'rev-2', content: restoredDoc }),
    );

    renderPanel();
    fireEvent.click(await findRow('rev-2'));
    fireEvent.click(await screen.findByRole('button', { name: /Restore/ }));

    await waitFor(() => {
      expect(mocked.restoreRevision).toHaveBeenCalledWith(TEST_WORKSPACE_ID, DOC_ID, 'rev-2', {
        summary: 'Restored version 2',
        etag: 'cw:3',
      });
    });
    expect(confirm).toHaveBeenCalled();
    expect(adoptRestoredDocument).toHaveBeenCalledWith(restoredDoc, 'cw:4');
    expect(toast).toHaveBeenCalledWith(
      expect.objectContaining({ variant: 'success' }),
    );
  });

  it('explains that switching versions writes nothing and branches on save', async () => {
    mocked.diffRevision.mockResolvedValue({
      baseRevisionId: 'rev-1',
      targetRevisionId: 'rev-2',
      changes: [],
    });
    mocked.getRevision.mockResolvedValue({ ...revision(), content: currentDoc });
    mocked.restoreRevision.mockResolvedValue(head({ etag: 'cw:4', currentRevisionId: 'rev-2' }));

    renderPanel();
    fireEvent.click(await findRow('rev-2'));
    fireEvent.click(await screen.findByRole('button', { name: /Restore/ }));

    await waitFor(() => expect(confirm).toHaveBeenCalled());
    const description = String(itemAt(confirm.mock.calls, 0)[0].description);
    expect(description).toContain('does not create a new version');
    expect(description).toContain('new branch');
  });

  it('moves the current marker on restore without adding a revision row', async () => {
    mocked.diffRevision.mockResolvedValue({
      baseRevisionId: 'rev-1',
      targetRevisionId: 'rev-2',
      changes: [],
    });
    mocked.getRevision.mockResolvedValue({ ...revision(), content: currentDoc });
    // Restore is a pointer move: same revisions, new head_seq, pointer on the
    // restored node. The panel refetches the head to pick that up.
    mocked.restoreRevision.mockResolvedValue(head({ etag: 'cw:4', currentRevisionId: 'rev-2' }));

    renderPanel();
    expect(await findRow('rev-3')).toBeTruthy();
    expect(currentRow()).toBe('rev-3');
    const headReadsBefore = history.head.mock.calls.length;
    history.head.mockResolvedValue(
      head({ etag: 'cw:4', currentRevisionId: 'rev-2' }),
    );

    fireEvent.click(row('rev-2')!);
    fireEvent.click(await screen.findByRole('button', { name: /Restore/ }));

    await waitFor(() => expect(currentRow()).toBe('rev-2'));
    // The head is re-read rather than inferred from a row the restore did not write.
    expect(history.head.mock.calls.length).toBeGreaterThan(headReadsBefore);
    expect(screen.getAllByRole('listitem')).toHaveLength(2);
    expect(row('rev-4')).toBeNull();
  });

  it('offers no restore on the version the page is already on', async () => {
    mocked.diffRevision.mockResolvedValue({
      baseRevisionId: 'rev-2',
      targetRevisionId: 'rev-3',
      changes: [],
    });
    mocked.getRevision.mockResolvedValue({ ...revision(), content: currentDoc });

    renderPanel();
    fireEvent.click(await findRow('rev-3'));

    expect(await screen.findByText('The page is on this version')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Restore/ })).toBeNull();
  });

  it('saves pending edits before restoring so nothing is lost', async () => {
    pendingEdits = true;
    mocked.diffRevision.mockResolvedValue({
      baseRevisionId: 'rev-1',
      targetRevisionId: 'rev-2',
      changes: [],
    });
    mocked.getRevision.mockResolvedValue({ ...revision(), content: currentDoc });
    mocked.restoreRevision.mockResolvedValue(head({ etag: 'cw:5' }));

    renderPanel();
    fireEvent.click(await findRow('rev-2'));
    fireEvent.click(await screen.findByRole('button', { name: /Restore/ }));

    await waitFor(() => expect(mocked.restoreRevision).toHaveBeenCalled());
    expect(saveRemote).toHaveBeenCalled();
    expect(saveRemote.mock.invocationCallOrder[0]).toBeLessThan(
      itemAt(mocked.restoreRevision.mock.invocationCallOrder, 0),
    );
  });

  it('does nothing when the confirmation is declined', async () => {
    confirmAnswer = false;
    mocked.diffRevision.mockResolvedValue({
      baseRevisionId: 'rev-1',
      targetRevisionId: 'rev-2',
      changes: [],
    });
    mocked.getRevision.mockResolvedValue({ ...revision(), content: currentDoc });

    renderPanel();
    fireEvent.click(await findRow('rev-2'));
    fireEvent.click(await screen.findByRole('button', { name: /Restore/ }));

    await waitFor(() => expect(confirm).toHaveBeenCalled());
    expect(mocked.restoreRevision).not.toHaveBeenCalled();
    expect(adoptRestoredDocument).not.toHaveBeenCalled();
  });

  it('flags a fork point where two loaded versions share a parent', async () => {
    history.revisions.mockResolvedValue({
      revisions: [
        revision({ revisionId: 'rev-3', revisionNo: 3, parentRevisionId: 'rev-1' }),
        revision({ revisionId: 'rev-2', revisionNo: 2, parentRevisionId: 'rev-1' }),
        revision({ revisionId: 'rev-1', revisionNo: 1, parentRevisionId: null, kind: 'create' }),
      ],
      nextCursor: null,
    });

    renderPanel();

    expect(await screen.findByText('2 branches')).toBeTruthy();
    const forkRow = screen.getByText('2 branches').closest<HTMLElement>('[data-revision-id]');
    expect(forkRow?.dataset.revisionId).toBe('rev-1');
  });

  it('names code, diagram and to-do changes by kind and diffs code text', async () => {
    mocked.diffRevision.mockResolvedValue({
      baseRevisionId: 'rev-1',
      targetRevisionId: 'rev-2',
      changes: [
        { entity: 'block', change: 'changed', entityId: 'c1', entityType: 'code', parentId: null, previousParentId: null, fromIndex: null, toIndex: null, fields: ['text'] },
        { entity: 'block', change: 'changed', entityId: 't1', entityType: 'paragraph', parentId: null, previousParentId: null, fromIndex: null, toIndex: null, fields: ['checked'] },
        { entity: 'block', change: 'inserted', entityId: 'd1', entityType: 'code', parentId: null, previousParentId: null, fromIndex: null, toIndex: 2, fields: [] },
      ],
    });
    const blocks = (revisionId: string): Block[] => [
      { id: 'c1', type: 'code', language: 'python', text: revisionId === 'rev-1' ? 'loss = mse(y, x)' : 'loss = cross_entropy(y, x)' },
      { id: 't1', type: 'paragraph', variant: 'todo', checked: revisionId !== 'rev-1', html: 'Run the ablation', children: [], columns: 1 },
      ...(revisionId === 'rev-1' ? [] : [{ id: 'd1', type: 'code' as const, language: 'mermaid', text: '' }]),
    ];
    mocked.getRevision.mockImplementation(async (_workspaceId, _docId, revisionId) => ({
      ...revision({ revisionId }),
      content: { name: 'Findings', blocks: blocks(revisionId) },
    }));

    renderPanel();
    fireEvent.click(await findRow('rev-2'));

    expect(await screen.findByText('Code changed')).toBeTruthy();
    // The code's text is diffed, not just reported.
    expect(document.querySelector('ins')?.textContent).toContain('cross_entropy');
    expect(document.querySelector('del')?.textContent).toContain('mse');
    expect(screen.getByText('To-do list changed')).toBeTruthy();
    expect(screen.getByText('Ticked.')).toBeTruthy();
    expect(screen.getByText('Diagram added')).toBeTruthy();
    expect(document.body.textContent).not.toMatch(/checked|variant|Paragraph/);
  });

  it('says what a kind change and an indent mean instead of listing field names', async () => {
    mockChange(
      { entityId: 'p1', fields: ['indent', 'variant'] },
      [{ id: 'p1', type: 'paragraph', variant: 'bullet', html: 'Point', children: [], columns: 1 }],
      [{ id: 'p1', type: 'paragraph', variant: 'numbered', indent: 1, html: 'Point', children: [], columns: 1 }],
    );

    renderPanel();
    fireEvent.click(await findRow('rev-2'));

    expect(await screen.findByText('Numbered list changed')).toBeTruthy();
    expect(screen.getByText('Turned into Numbered list, indented.')).toBeTruthy();
  });

  it('warns that suggestions waiting for review are discarded by a restore', async () => {
    mocked.diffRevision.mockResolvedValue({ baseRevisionId: 'rev-1', targetRevisionId: 'rev-2', changes: [] });
    mocked.getRevision.mockResolvedValue({ ...revision(), content: currentDoc });
    confirmAnswer = false;

    renderPanel(DOC_ID, { pendingSuggestions: 3 });
    fireEvent.click(await findRow('rev-2'));
    fireEvent.click(await screen.findByRole('button', { name: /Restore/ }));

    await waitFor(() => expect(confirm).toHaveBeenCalled());
    expect(String(confirm.mock.calls[0]?.[0].description)).toContain(
      '3 suggestions waiting for review will be discarded.',
    );
  });

  it('offers Undo after a restore, which moves back to the version the page was on', async () => {
    mocked.diffRevision.mockResolvedValue({ baseRevisionId: 'rev-1', targetRevisionId: 'rev-2', changes: [] });
    mocked.getRevision.mockResolvedValue({ ...revision(), content: currentDoc });
    const restoredDoc: Doc = { name: 'Findings', blocks: [] };
    mocked.restoreRevision.mockImplementation(async (_workspaceId, _docId, revisionId) =>
      head({ etag: 'cw:4', currentRevisionId: revisionId, content: revisionId === 'rev-2' ? restoredDoc : currentDoc }),
    );

    renderPanel();
    fireEvent.click(await findRow('rev-2'));
    fireEvent.click(await screen.findByRole('button', { name: /Restore/ }));

    // Named by when it was saved, never by its counter.
    const nowOn = /^Now on the version from .+\d/;
    await waitFor(() => expect(toast).toHaveBeenCalledWith(expect.objectContaining({ title: expect.stringMatching(nowOn) })));
    const options = toast.mock.calls.find(([call]) => nowOn.test(String(call.title)))![0];
    expect(options.action?.label).toBe('Undo');

    // The head said the document was on rev-3 before the restore.
    mocked.restoreRevision.mockClear();
    options.action!.onSelect();
    await waitFor(() =>
      expect(mocked.restoreRevision).toHaveBeenCalledWith(
        TEST_WORKSPACE_ID, DOC_ID,
        'rev-3',
        expect.objectContaining({ summary: 'Restored version 3' }),
      ),
    );
    await waitFor(() => expect(adoptRestoredDocument).toHaveBeenLastCalledWith(currentDoc, 'cw:4'));
    expect(toast).toHaveBeenCalledWith(expect.objectContaining({ title: 'Back on the version you were on' }));
  });

  it('shows a failed restore beside its button, not in a toast', async () => {
    mocked.diffRevision.mockResolvedValue({ baseRevisionId: 'rev-1', targetRevisionId: 'rev-2', changes: [] });
    mocked.getRevision.mockResolvedValue({ ...revision(), content: currentDoc });
    mocked.restoreRevision.mockRejectedValue(new Error('Storage is unavailable'));

    renderPanel();
    fireEvent.click(await findRow('rev-2'));
    fireEvent.click(await screen.findByRole('button', { name: /Restore/ }));

    expect((await screen.findByRole('alert')).textContent).toContain('Storage is unavailable');
    expect(toast).not.toHaveBeenCalled();
    expect(adoptRestoredDocument).not.toHaveBeenCalled();
  });

  it('keeps the rows and the open comparison when a refresh fails, with a retry', async () => {
    mockChange(
      { entityId: 'p1', fields: ['html'] },
      [{ id: 'p1', type: 'paragraph', html: 'Hello there', children: [], columns: 1 }],
      [{ id: 'p1', type: 'paragraph', html: 'Hello world', children: [], columns: 1 }],
    );
    const view = renderPanel();
    fireEvent.click(await findRow('rev-2'));
    expect(await screen.findByText('Text changed')).toBeTruthy();

    history.revisions.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    view.update({ savedAt: 4 });

    expect(await screen.findByText('Could not refresh the history.')).toBeTruthy();
    expect(row('rev-3')!).toBeTruthy();
    expect(screen.getByText('Text changed')).toBeTruthy();
    expect(document.body.textContent).not.toContain('Failed to fetch');

    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    await waitFor(() => expect(screen.queryByText('Could not refresh the history.')).toBeNull());
    expect(screen.getByText('Text changed')).toBeTruthy();
  });

  it('does not refetch on saves while its tab is hidden, and catches up when shown', async () => {
    const view = renderPanel(DOC_ID, { tab: 'history' });
    expect(await findRow('rev-3')).toBeTruthy();
    expect(history.revisions).toHaveBeenCalledTimes(1);

    view.update({ tab: 'assistant', savedAt: 4 });
    view.update({ tab: 'assistant', savedAt: 5 });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(history.revisions).toHaveBeenCalledTimes(1);

    view.update({ tab: 'history', savedAt: 5 });
    await waitFor(() => expect(history.revisions).toHaveBeenCalledTimes(2));
  });

  it('surfaces a failed load with a retry action', async () => {
    history.head.mockRejectedValue(new Error('boom'));
    history.revisions.mockRejectedValue(new Error('boom'));

    renderPanel();

    expect(await screen.findByText('boom')).toBeTruthy();
    history.head.mockResolvedValue(head());
    history.revisions.mockResolvedValue({ revisions: [revision()], nextCursor: null });
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await findRow('rev-3')).toBeTruthy();
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
    const [newest, sibling, root] = takeItems(graph.rows, 3);

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
    const [newest, sibling] = takeItems(graph.rows, 2);

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

    expect(graph.rows[0]?.isFork).toBe(false);
    expect(graph.rows[0]?.childCount).toBe(0);
    expect(graph.rows[1]?.parentDangling).toBe(true);
  });

  it('returns nothing to draw for an empty timeline', () => {
    expect(buildVersionGraph([])).toEqual({ rows: [], laneCount: 0, danglingLanes: [] });
  });
});
