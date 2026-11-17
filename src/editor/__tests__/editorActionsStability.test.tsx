import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mockDocumentList } from '@/data/__tests__/documentFixtures';
import { act, cleanup } from '@testing-library/react';
import { renderWithQueryClient as render } from '@/__tests__/queryClient';
import { createRef, useEffect, useImperativeHandle } from 'react';
import type { Block } from '../types';
import type { EditorActionsContextValue } from '../editorContextState';
import type { EditorDocValue } from '../documentSessionState';
import { TEST_WORKSPACE_ID } from '@/__tests__/workspace';

vi.mock('@/data/documents', async () => ({
  ...(await vi.importActual<typeof import('@/data/documents')>('@/data/documents')),
  createDocument: vi.fn(async () => ({ id: 'created-doc', doc: { blocks: [], name: 'Doc' }, etag: 'cw:1', updatedAt: null, placement: { documentId: 'created-doc', collectionId: null, sortKey: 'V', placementEtag: '"cwp:1"', treeVersion: null } })),
  saveDocument: vi.fn(async () => ({ etag: 'cw:2', updatedAt: null })),
  getDocument: vi.fn(async () => ({ doc: { blocks: [], name: 'Doc' }, etag: 'cw:1', updatedAt: null, placement: { documentId: 'doc', collectionId: null, sortKey: 'V', placementEtag: '"cwp:1"', treeVersion: null } })),
  deleteDocument: vi.fn(async () => {}),
}));

// The first-run probe reads the server's page list: there is none yet.
beforeEach(() => {
  mockDocumentList();
});
afterEach(() => {
  vi.restoreAllMocks();
});

const { EditorProvider, useEditorActions, useEditorDoc } = await import('@/editor');

const actionsRef = createRef<EditorActionsContextValue>();
const stateRef = createRef<EditorDocValue>();

/**
 * Committed renders per subscription. Counted in an effect rather than the
 * render body so the count only moves for renders that actually commit.
 */
const renders = { actions: 0, state: 0 };

function ActionsProbe() {
  const actions = useEditorActions();
  useImperativeHandle(actionsRef, () => actions, [actions]);
  useEffect(() => {
    renders.actions += 1;
  });
  return null;
}

function StateProbe() {
  const state = useEditorDoc();
  useImperativeHandle(stateRef, () => state, [state]);
  useEffect(() => {
    renders.state += 1;
  });
  return null;
}

function currentActions() {
  if (!actionsRef.current) throw new Error('Actions probe is not mounted');
  return actionsRef.current;
}

function currentState() {
  if (!stateRef.current) throw new Error('State probe is not mounted');
  return stateRef.current;
}

beforeEach(() => {
  localStorage.clear();
  window.history.replaceState(null, '', '/');
  renders.actions = 0;
  renders.state = 0;
  localStorage.setItem(
    `colwrite:ws:${TEST_WORKSPACE_ID}:doc:local`,
    JSON.stringify({
      documentId: null,
      doc: {
        version: 1,
        blocks: [{ id: 'p1', type: 'paragraph', html: 'Hello', children: [] } satisfies Block],
      },
    }),
  );
});

afterEach(() => {
  cleanup();
  window.history.replaceState(null, '', '/');
});

describe('EditorActionsContext stability', () => {
  // The split exists for this: a keystroke replaces the document state, and
  // before the split that re-rendered every consumer of the merged context —
  // including components that only ever dispatch actions.
  it('does not re-render actions-only consumers when the document changes', () => {
    render(
      <EditorProvider>
        <ActionsProbe />
        <StateProbe />
      </EditorProvider>,
    );
    expect(renders.actions).toBe(1);
    expect(renders.state).toBe(1);

    const actionsBefore = currentActions();
    const stateRendersBefore = renders.state;

    act(() => currentActions().updateHtml('p1', 'Changed'));

    // The edit landed (the state context propagated it)…
    expect(renders.state).toBeGreaterThan(stateRendersBefore);
    expect(currentState().blocks[0]).toMatchObject({ html: 'Changed' });
    // …while the actions-only probe neither re-rendered nor saw a new value.
    expect(renders.actions).toBe(1);
    expect(currentActions()).toBe(actionsBefore);
  });
});
