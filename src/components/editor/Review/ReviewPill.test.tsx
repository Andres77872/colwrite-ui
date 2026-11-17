import { itemAt } from '@/lib/itemAt';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildChangeSet, markChanges, type ChangeSet } from '@/editor/proposals';
import type { Block, ToolOperation } from '@/editor/types';

/**
 * What a screen reader hears from the suggestions pill: one sentence when
 * suggestions arrive, and nothing for the author's own decisions.
 */

const editorState = { blocks: [] as Block[] };
const reviewState = {
  sets: [] as ChangeSet[],
  pendingCount: 0,
  acceptAll: vi.fn(),
  acceptWording: vi.fn(),
  acceptGroup: vi.fn(),
  rejectGroup: vi.fn(),
  rejectAll: vi.fn(),
  focusChange: vi.fn(),
  focusedChangeId: null,
};

vi.mock('@/editor', async () => ({
  ...(await vi.importActual<Record<string, unknown>>('@/editor')),
  useEditorDoc: () => editorState,
}));
vi.mock('@/editor/proposalsContextState', () => ({ useProposals: () => reviewState }));
const confirm = vi.fn(async () => true);
vi.mock('@/components/ui/confirmContext', () => ({ useConfirm: () => confirm }));

const { ReviewPill } = await import('./ReviewPill');

const para = (id: string): Block => ({ id, type: 'paragraph', html: id, children: [], columns: 1 });

function batch(count: number, callId: string): ChangeSet {
  const actions: ToolOperation[] = Array.from({ length: count }, (_, index) => ({
    op: 'write_blocks',
    position: 'append',
    blockId: null,
    blocks: [para(`${callId}-${index}`)],
  }));
  return buildChangeSet({
    toolCallId: callId,
    documentId: 'doc-1',
    status: 'proposed',
    actions,
    changeSetId: `cs-${callId}`,
  });
}

function show(sets: ChangeSet[]) {
  reviewState.sets = sets;
  reviewState.pendingCount = sets.flatMap((set) => set.changes).filter((change) => change.status === 'pending').length;
}

const announcer = () => document.querySelector('[data-review-announcer]')?.textContent;

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  editorState.blocks = [para('A')];
  show([]);
});

describe('group controls', () => {
  it('offers only stored groups and keeps new information out of bulk acceptance', async () => {
    const set = batch(3, 'grouped');
    set.groups = [
      { kind: 'wording', label: 'Wording', operations: [0, 1] },
      { kind: 'new_content', label: 'New content', operations: [2] },
    ];
    itemAt(set.changes, 1).op.newInformation = true;
    itemAt(set.changes, 2).op.newInformation = true;
    show([set]);
    render(<ReviewPill />);
    fireEvent.click(screen.getByRole('button', { name: /suggestions/ }));
    expect(screen.getByText('Wording (2)')).toBeTruthy();
    expect(screen.getByText('New content (1)')).toBeTruthy();
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Accept new content group' }).disabled).toBe(true);
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Accept wording changes' })));
    expect(confirm).toHaveBeenCalledWith(expect.objectContaining({ confirmLabel: 'Accept wording changes' }));
    expect(reviewState.acceptWording).toHaveBeenCalledOnce();
    expect(reviewState.acceptAll).not.toHaveBeenCalled();
  });

  it('routes a group decision by set identity and the stored kind', async () => {
    const set = batch(1, 'grouped');
    set.groups = [{ kind: 'citations', label: 'Citations', operations: [0] }];
    show([set]);
    render(<ReviewPill />);
    fireEvent.click(screen.getByRole('button', { name: /suggestion/ }));
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Reject citations group' })));
    expect(reviewState.rejectGroup).toHaveBeenCalledWith(set.id, 'citations');
  });
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('announcing suggestions', () => {
  it('says once how many arrived, and nothing for the author’s own decisions', () => {
    const view = render(<ReviewPill />);
    expect(announcer()).toBe('');

    const first = batch(3, 'call_1');
    show([first]);
    view.rerender(<ReviewPill />);
    expect(announcer()).toBe('3 suggestions to review.');

    // The same suggestions on the next render say nothing new.
    view.rerender(<ReviewPill />);
    expect(announcer()).toBe('3 suggestions to review.');

    act(() => {
      vi.advanceTimersByTime(6000);
    });
    expect(announcer()).toBe('');

    // Accepting one is the author's own action: no announcement.
    const decided = markChanges([first], new Set([itemAt(first.changes, 0).id]), 'accepted');
    show(decided);
    view.rerender(<ReviewPill />);
    expect(announcer()).toBe('');

    // More arrive while two are still open.
    show([...decided, batch(2, 'call_2')]);
    view.rerender(<ReviewPill />);
    expect(announcer()).toBe('2 new suggestions, 4 to review.');
  });

  it('treats what is already pending when it mounts as known', () => {
    show([batch(2, 'call_1')]);
    render(<ReviewPill />);
    expect(announcer()).toBe('');
  });

  it('keeps its live region in the page while nothing is pending', () => {
    render(<ReviewPill />);
    // A region added together with its text is often not read at all.
    const region = document.querySelector('[data-review-announcer]');
    expect(region?.getAttribute('aria-live')).toBe('polite');
  });
});
