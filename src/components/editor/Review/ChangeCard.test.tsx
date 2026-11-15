import { itemAt } from '@/lib/itemAt';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildChangeSet, type ChangeSet, type ProposedChange } from '@/editor/proposals';
import type { Block, ToolOperation } from '@/editor/types';

/**
 * The review card on its own: what it offers, what it says when it cannot
 * offer Accept, and the keys that decide it while it has focus.
 */

const accept = vi.fn();
const reject = vi.fn();
const confirm = vi.fn<(options: { title: string; description?: unknown }) => Promise<boolean>>();

const editorState = {
  blocks: [] as Block[],
  doc: { version: 1, blocks: [] as Block[] },
};
const reviewState = {
  sets: [] as ChangeSet[],
  pending: [] as ProposedChange[],
  pendingCount: 0,
  accept,
  reject,
  acceptAll: vi.fn(),
  rejectAll: vi.fn(),
  ready: (_change: ProposedChange) => true,
  focusChange: vi.fn(),
  focusedChangeId: null,
  invites: [],
  dismissInvite: vi.fn(),
  error: null,
  clearError: vi.fn(),
};

vi.mock('@/editor', async () => ({
  ...(await vi.importActual<Record<string, unknown>>('@/editor')),
  useEditorDoc: () => editorState,
}));
vi.mock('@/editor/proposalsContextState', () => ({ useProposals: () => reviewState }));
vi.mock('@/components/ui/confirmContext', () => ({ useConfirm: () => confirm }));

const { ChangeCard } = await import('./ChangeCard');

const para = (id: string, html = id): Block => ({ id, type: 'paragraph', html, children: [], columns: 1 });

function stage(actions: ToolOperation[], blocks: Block[]): ChangeSet {
  const set = buildChangeSet(
    { tool: 'doc_edit', toolCallId: 'call_1', documentId: 'doc-1', status: 'proposed', actions, changeSetId: 'cs-1' },
    blocks,
  );
  reviewState.sets = [set];
  reviewState.pending = set.changes;
  reviewState.pendingCount = set.changes.length;
  return set;
}

beforeEach(() => {
  editorState.blocks = [para('p', 'Body text')];
  reviewState.ready = () => true;
  accept.mockReset();
  reject.mockReset();
  confirm.mockReset();
});

afterEach(cleanup);

describe('deciding from the keyboard', () => {
  it('accepts with Mod+Enter and rejects with Mod+Backspace while the card has focus', async () => {
    const set = stage([{ op: 'replace_block', blockId: 'p', block: { html: 'New text' } }], editorState.blocks);
    const change = itemAt(set.changes, 0);
    render(<ChangeCard change={change} />);
    const card = screen.getByRole('group');
    card.focus();

    fireEvent.keyDown(card, { key: 'Enter', ctrlKey: true });
    expect(accept).toHaveBeenCalledWith(change.id);

    await act(async () => {
      fireEvent.keyDown(card, { key: 'Backspace', metaKey: true });
    });
    expect(reject).toHaveBeenCalledWith(change.id);
  });

  it('leaves plain keys alone, so nothing is decided by accident', () => {
    const set = stage([{ op: 'replace_block', blockId: 'p', block: { html: 'New text' } }], editorState.blocks);
    render(<ChangeCard change={itemAt(set.changes, 0)} />);
    const card = screen.getByRole('group');

    fireEvent.keyDown(card, { key: 'Enter' });
    fireEvent.keyDown(card, { key: 'Backspace' });
    fireEvent.keyDown(card, { key: 'Enter', ctrlKey: true, shiftKey: true });
    expect(accept).not.toHaveBeenCalled();
    expect(reject).not.toHaveBeenCalled();
  });

  it('does not accept from the keyboard when Accept is not offered', () => {
    const set = stage([{ op: 'replace_block', blockId: 'p', block: { html: 'New text' } }], editorState.blocks);
    reviewState.ready = () => false;
    render(<ChangeCard change={itemAt(set.changes, 0)} />);

    fireEvent.keyDown(screen.getByRole('group'), { key: 'Enter', ctrlKey: true });
    expect(accept).not.toHaveBeenCalled();
  });

  it('names the keys on the buttons', () => {
    const set = stage([{ op: 'replace_block', blockId: 'p', block: { html: 'New text' } }], editorState.blocks);
    render(<ChangeCard change={itemAt(set.changes, 0)} />);

    const acceptButton = screen.getByRole('button', { name: /^Accept:/ });
    const rejectButton = screen.getByRole('button', { name: /^Reject:/ });
    expect(acceptButton.getAttribute('aria-keyshortcuts')).toBe('Control+Enter');
    expect(rejectButton.getAttribute('aria-keyshortcuts')).toBe('Control+Backspace Control+Delete');
    expect(acceptButton.getAttribute('title')).toBe('Accept (Ctrl+Enter)');
  });
});

describe('when Accept is not offered', () => {
  it('says the text changed since the suggestion, and still offers Reject', () => {
    const set = stage([{ op: 'replace_block', blockId: 'p', block: { html: 'New text' } }], editorState.blocks);
    // The author edits the paragraph after the suggestion arrived.
    editorState.blocks = [para('p', 'Body text, edited')];
    reviewState.ready = () => false;
    render(<ChangeCard change={itemAt(set.changes, 0)} />);

    expect(screen.getByText('The text changed after this was suggested.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /^Accept:/ })).toBeNull();
    expect(screen.getByRole('button', { name: /^Reject:/ })).toBeTruthy();
    expect(screen.getByRole('group').getAttribute('data-stale')).toBe('true');
  });

  it('says either decision on the paragraph above unlocks a continuation', () => {
    const set = stage(
      [
        { op: 'insert_block_after', referenceId: 'p', block: para('x') },
        { op: 'insert_block_after', referenceId: 'x', block: para('y') },
      ],
      editorState.blocks,
    );
    reviewState.ready = () => false;
    render(<ChangeCard change={itemAt(set.changes, 1)} />);

    expect(screen.getByText('This continues the addition above. Accept or reject that one first.')).toBeTruthy();
  });
});

describe('rejecting an addition', () => {
  it('rejects at once when only continuations depend on it, since they stay', async () => {
    const set = stage(
      [
        { op: 'insert_block_after', referenceId: 'p', block: para('x') },
        { op: 'insert_block_after', referenceId: 'x', block: para('y') },
      ],
      editorState.blocks,
    );
    render(<ChangeCard change={itemAt(set.changes, 0)} />);

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /^Reject:/ }));
    });
    expect(confirm).not.toHaveBeenCalled();
    expect(reject).toHaveBeenCalledWith(itemAt(set.changes, 0).id);
  });

  it('asks first when a change to the added block would go with it', async () => {
    const set = stage(
      [
        { op: 'insert_block_after', referenceId: 'p', block: para('x') },
        { op: 'replace_block', blockId: 'x', block: { html: 'x, rewritten' } },
      ],
      editorState.blocks,
    );
    render(<ChangeCard change={itemAt(set.changes, 0)} />);

    confirm.mockResolvedValueOnce(false);
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /^Reject:/ }));
    });
    expect(confirm).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Reject this addition and the change to it?' }),
    );
    expect(reject).not.toHaveBeenCalled();

    confirm.mockResolvedValueOnce(true);
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /^Reject:/ }));
    });
    expect(reject).toHaveBeenCalledWith(itemAt(set.changes, 0).id);
  });
});
