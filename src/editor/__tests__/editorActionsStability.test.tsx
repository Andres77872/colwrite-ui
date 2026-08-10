import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render } from '@testing-library/react';
import { createRef, useEffect, useImperativeHandle } from 'react';
import type { Block } from '../types';
import type { EditorActionsContextValue, EditorStateContextValue } from '../editorContextState';

vi.mock('@/services', () => ({
  createDocument: vi.fn(async () => ({ document_id: 'created-doc', version: 1 })),
  saveDocument: vi.fn(async () => ({ status: 'ok', message: '', version: 2 })),
  loadDocument: vi.fn(async () => ({ version: 1, blocks: [], name: 'Doc' })),
  deleteDocument: vi.fn(async () => ({ status: 'ok', message: '' })),
  listDocuments: vi.fn(async () => ({ documents: [], count: 0, status: 'ok', message: '' })),
}));

const { EditorProvider, useEditorActions, useEditorState } = await import('@/editor');

const actionsRef = createRef<EditorActionsContextValue>();
const stateRef = createRef<EditorStateContextValue>();

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
  const state = useEditorState();
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
    'colwrite:doc:local',
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
