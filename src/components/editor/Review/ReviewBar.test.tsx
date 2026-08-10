import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ProposedChange } from '@/editor/proposals';

const switchTo = vi.fn<(_id: string) => Promise<boolean>>();
const dismissInvite = vi.fn();
const editorState = {
  blocks: [],
  loadingDocumentId: null as string | null,
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
};

vi.mock('@/editor', () => ({
  useEditor: () => ({ ...editorState, switchTo }),
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
    expect(screen.getByText('The assistant created a new document.')).toBeTruthy();
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
    const card = screen.getByRole('group', { name: 'Rename document' });
    expect(card.getAttribute('tabindex')).toBe('-1');
    expect(card).toBe(container.querySelector('[data-change-id="chg-1"]'));
  });
});
