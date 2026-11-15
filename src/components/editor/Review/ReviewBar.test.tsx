import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ProposedChange } from '@/editor/proposals';

const switchTo = vi.fn<(_id: string) => Promise<boolean>>();
const dismissInvite = vi.fn();
const editorState = {
  blocks: [],
  loadingDocumentId: null as string | null,
  readOnly: false,
};
const reviewState = {
  sets: [],
  pending: [],
  pendingCount: 0,
  accept: vi.fn(),
  reject: vi.fn(),
  acceptAll: vi.fn(),
  rejectAll: vi.fn(),
  ready: () => true,
  focusChange: vi.fn(),
  focusedChangeId: null,
  invites: [{ id: 'invite-1', documentId: 'created-doc', receivedAt: 1 }],
  dismissInvite,
  error: null,
  clearError: vi.fn(),
  waiting: [] as ProposedChange[],
  applyWaiting: vi.fn(),
};

vi.mock('@/editor', () => ({
  useEditorDoc: () => editorState,
  useDocumentSession: () => editorState,
  useDocumentActions: () => ({ switchTo }),
  usePageReadOnly: () => editorState.readOnly,
}));
vi.mock('@/editor/proposalsContextState', () => ({ useProposals: () => reviewState }));
vi.mock('@/components/ui/confirmContext', () => ({ useConfirm: () => vi.fn() }));

const { ReviewBar } = await import('./ReviewBar');
const { ChangeCard } = await import('./ChangeCard');

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

beforeEach(() => {
  editorState.loadingDocumentId = null;
  editorState.readOnly = false;
  reviewState.accept.mockReset();
  reviewState.reject.mockReset();
  switchTo.mockReset();
  dismissInvite.mockReset();
});

afterEach(cleanup);

describe('assistant-created document invitations', () => {
  it('shows opening feedback and dismisses only after a successful commit', async () => {
    const opening = deferred<boolean>();
    switchTo.mockReturnValue(opening.promise);
    const view = render(<ReviewBar />);

    fireEvent.click(screen.getByRole('button', { name: 'Open it' }));
    expect(dismissInvite).not.toHaveBeenCalled();

    editorState.loadingDocumentId = 'created-doc';
    view.rerender(<ReviewBar />);
    expect(screen.getByRole('button', { name: 'Opening…' })).toBeTruthy();

    await act(async () => {
      opening.resolve(true);
      await opening.promise;
    });
    expect(dismissInvite).toHaveBeenCalledWith('invite-1');
  });

  it('keeps the invitation after a failed load', async () => {
    switchTo.mockRejectedValue(new Error('Not found'));
    render(<ReviewBar />);

    fireEvent.click(screen.getByRole('button', { name: 'Open it' }));
    await waitFor(() => expect(switchTo).toHaveBeenCalledWith('created-doc'));
    expect(dismissInvite).not.toHaveBeenCalled();
    expect(screen.getByText('The assistant created a new page.')).toBeTruthy();
  });
});

describe('changes an Auto turn left waiting', () => {
  const rename = (id: string): ProposedChange => ({
    id,
    order: 0,
    kind: 'rename',
    op: { op: 'update_meta', meta: { name: 'A better title' } },
    anchorBlockId: null,
    placement: null,
    producesBlockId: null,
    dependsOn: [],
    status: 'pending',
  });

  beforeEach(() => {
    const waiting = [rename('w-1'), { ...rename('w-2'), order: 1 }];
    Object.assign(reviewState, {
      invites: [],
      waiting,
      sets: [{ id: 'set-1', tool: 'doc_edit', toolCallId: 'c', documentId: 'doc-1', version: 1, receivedAt: 1, changes: waiting, changeSetId: 'cs-1', autoWaiting: true }],
    });
    reviewState.applyWaiting.mockReset();
    reviewState.focusChange.mockReset();
  });
  afterEach(() => {
    Object.assign(reviewState, { invites: [{ id: 'invite-1', documentId: 'created-doc', receivedAt: 1 }], waiting: [], sets: [] });
  });

  it('says how many are waiting, and offers Apply all and Review', () => {
    render(<ReviewBar />);
    expect(screen.getByRole('status').textContent).toContain('2 changes from an Auto turn are waiting');

    fireEvent.click(screen.getByRole('button', { name: 'Apply all' }));
    expect(reviewState.applyWaiting).toHaveBeenCalledOnce();

    fireEvent.click(screen.getByRole('button', { name: 'Review' }));
    expect(reviewState.focusChange).toHaveBeenCalledWith('w-1');
  });

  it('is gone when nothing is waiting', () => {
    Object.assign(reviewState, { waiting: [], sets: [] });
    const { container } = render(<ReviewBar />);
    expect(container.textContent).toBe('');
  });
});

describe('ChangeCard', () => {
  it('is a focusable group, so Next/Previous can land keyboard focus on it', () => {
    const change: ProposedChange = {
      id: 'chg-1',
      order: 0,
      kind: 'rename',
      op: { op: 'update_meta', meta: { name: 'A better title' } },
      anchorBlockId: null,
      placement: null,
      producesBlockId: null,
      dependsOn: [],
      status: 'pending',
    };
    const { container } = render(<ChangeCard change={change} />);

    // `focusChange` scrolls *and focuses* the card (see reveal.ts): a plain
    // div cannot take DOM focus, so without this the scroll was sighted-only.
    const card = screen.getByRole('group', { name: 'Rename page' });
    expect(card.getAttribute('tabindex')).toBe('-1');
    expect(card).toBe(container.querySelector('[data-change-id="chg-1"]'));
  });

  it('shows a viewer the suggestion with Accept and Reject disabled, saying why (M6.UI-2)', () => {
    editorState.readOnly = true;
    const change: ProposedChange = {
      id: 'chg-2', order: 0, kind: 'rename', op: { op: 'update_meta', meta: { name: 'A better title' } },
      anchorBlockId: null, placement: null, producesBlockId: null, dependsOn: [], status: 'pending',
    };
    render(<ChangeCard change={change} />);
    const card = screen.getByRole('group', { name: 'Rename page' });
    const accept = screen.getByRole('button', { name: 'Accept: Rename page' }) as HTMLButtonElement;
    const reject = screen.getByRole('button', { name: 'Reject: Rename page' }) as HTMLButtonElement;
    expect(accept.disabled).toBe(true);
    expect(reject.disabled).toBe(true);
    expect(card.textContent).toContain('Viewers can’t accept or reject changes');
    // Nor from the keyboard.
    fireEvent.keyDown(card, { key: 'Enter', ctrlKey: true });
    fireEvent.keyDown(card, { key: 'Backspace', ctrlKey: true });
    expect(reviewState.accept).not.toHaveBeenCalled();
    expect(reviewState.reject).not.toHaveBeenCalled();
  });
});
