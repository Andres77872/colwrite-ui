import { itemAt } from '@/lib/itemAt';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { renderWithQueryClient } from '@/__tests__/queryClient';
import { TooltipProvider } from '@/components/ui/tooltip';
import { FIXTURE_DOCUMENT_ID } from '@/dev/msw/fixtures';
import { recordRequests } from '@/__tests__/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { acceptBlocker, buildChangeSet, linkAcrossSets, linkPrecedence, type AcceptBlocker, type ChangeSet, type ProposedChange } from '@/editor/proposals';
import type { Block, Doc, ToolOperation } from '@/editor/types';
import { deleteBlocks, moveBlock, rewrite, setMeta, writeAfter } from '@/editor/__tests__/operations';
import { reference } from '@/__tests__/agentSource';

/**
 * The review card on its own: what it offers, what it says when it cannot
 * offer Accept, and the keys that decide it while it has focus.
 */

const accept = vi.fn();
const reject = vi.fn();
const confirm = vi.fn<(options: { title: string; description?: unknown }) => Promise<boolean>>();

const editorState: { blocks: Block[]; doc: Doc } = {
  blocks: [],
  doc: { blocks: [] },
};
const reviewState = {
  sets: [] as ChangeSet[],
  pending: [] as ProposedChange[],
  pendingCount: 0,
  accept,
  reject,
  acceptAll: vi.fn(),
  rejectAll: vi.fn(),
  /** The review's own rule, over the staged sets and the page. */
  blocker: (change: ProposedChange): AcceptBlocker | null =>
    acceptBlocker(change, reviewState.sets, editorState.blocks, linkPrecedence(reviewState.sets)),
  ready: (change: ProposedChange) => reviewState.blocker(change) === null,
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
  useDocumentId: () => FIXTURE_DOCUMENT_ID,
}));
vi.mock('@/editor/proposalsContextState', () => ({ useProposals: () => reviewState }));
vi.mock('@/components/ui/confirmContext', () => ({ useConfirm: () => confirm }));

const { ChangeCard } = await import('./ChangeCard');

const para = (id: string, html = id): Block => ({ id, type: 'paragraph', html, children: [], columns: 1 });

function stage(actions: ToolOperation[], blocks: Block[]): ChangeSet {
  const set = buildChangeSet(
    { toolCallId: 'call_1', documentId: 'doc-1', status: 'proposed', actions, changeSetId: 'cs-1' },
    blocks,
  );
  reviewState.sets = [set];
  reviewState.pending = set.changes;
  reviewState.pendingCount = set.changes.length;
  return set;
}

beforeEach(() => {
  editorState.blocks = [para('p', 'Body text')];
  editorState.doc = { blocks: editorState.blocks };
  reviewState.blocker = (change) =>
    acceptBlocker(change, reviewState.sets, editorState.blocks, linkPrecedence(reviewState.sets));
  reviewState.focusChange.mockReset();
  accept.mockReset();
  reject.mockReset();
  confirm.mockReset();
});

afterEach(cleanup);

describe('deciding from the keyboard', () => {
  it('accepts with Mod+Enter and rejects with Mod+Backspace while the card has focus', async () => {
    const set = stage([rewrite('p', { type: 'paragraph', html: 'New text', children: [] })], editorState.blocks);
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
    const set = stage([rewrite('p', { type: 'paragraph', html: 'New text', children: [] })], editorState.blocks);
    render(<ChangeCard change={itemAt(set.changes, 0)} />);
    const card = screen.getByRole('group');

    fireEvent.keyDown(card, { key: 'Enter' });
    fireEvent.keyDown(card, { key: 'Backspace' });
    fireEvent.keyDown(card, { key: 'Enter', ctrlKey: true, shiftKey: true });
    expect(accept).not.toHaveBeenCalled();
    expect(reject).not.toHaveBeenCalled();
  });

  it('does not accept from the keyboard when Accept is not offered', () => {
    const set = stage([rewrite('p', { type: 'paragraph', html: 'New text', children: [] })], editorState.blocks);
    reviewState.blocker = () => ({ reason: 'locked' });
    render(<ChangeCard change={itemAt(set.changes, 0)} />);

    fireEvent.keyDown(screen.getByRole('group'), { key: 'Enter', ctrlKey: true });
    expect(accept).not.toHaveBeenCalled();
  });

  it('names the keys on the buttons', () => {
    const set = stage([rewrite('p', { type: 'paragraph', html: 'New text', children: [] })], editorState.blocks);
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
    const set = stage([rewrite('p', { type: 'paragraph', html: 'New text', children: [] })], editorState.blocks);
    // The author edits the paragraph after the suggestion arrived.
    editorState.blocks = [para('p', 'Body text, edited')];
    render(<ChangeCard change={itemAt(set.changes, 0)} />);

    expect(screen.getByText('The text changed after this was suggested.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /^Accept:/ })).toBeNull();
    expect(screen.getByRole('button', { name: /^Reject:/ })).toBeTruthy();
    expect(screen.getByRole('group').getAttribute('data-stale')).toBe('true');
  });

  it('names the addition a continuation builds on, and goes to it', () => {
    const set = stage(
      [
        writeAfter('p', para('x', 'First added')),
        writeAfter('x', para('y', 'Second added')),
      ],
      editorState.blocks,
    );
    render(<ChangeCard change={itemAt(set.changes, 1)} />);

    expect(screen.getByText('Accept this first:')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Go to the suggestion to decide first: Add paragraph “First added”' }));
    expect(reviewState.focusChange).toHaveBeenCalledWith(itemAt(set.changes, 0).id);
    expect(screen.queryByRole('button', { name: /^Accept:/ })).toBeNull();
  });

  it('names the suggestion a move waits on, wherever it is on the page', () => {
    editorState.blocks = [para('a', 'Alpha'), para('b', 'Beta'), para('c', 'Gamma')];
    const set = stage(
      [
        writeAfter('a', para('x', 'Added after alpha')),
        moveBlock('c', 'after', 'a'),
      ],
      editorState.blocks,
    );
    render(<ChangeCard change={itemAt(set.changes, 1)} />);

    expect(screen.getByText('Decide this first:')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Go to the suggestion to decide first: Add paragraph “Added after alpha”' })).toBeTruthy();
  });

  it('offers Accept on a move that shares no block with a change it cannot accept', () => {
    editorState.blocks = [para('a', 'Alpha'), para('b', 'Beta'), para('c', 'Gamma'), para('d', 'Delta')];
    const set = stage([deleteBlocks('b'), moveBlock('d', 'before', 'a')], editorState.blocks);
    // The author edits the paragraph the deletion was written for.
    editorState.blocks = [para('a', 'Alpha'), para('b', 'Beta, edited'), para('c', 'Gamma'), para('d', 'Delta')];
    render(<ChangeCard change={itemAt(set.changes, 1)} />);

    expect(screen.getByRole('button', { name: /^Accept:/ })).toBeTruthy();
  });

  it('shows a rewrite of a block an earlier batch of the run adds against that block', () => {
    const first = buildChangeSet(
      { toolCallId: 'call_1', documentId: 'doc-1', status: 'proposed', actions: [writeAfter('p', para('x', 'Drafted sentence'))], changeSetId: 'cs-1' },
      editorState.blocks,
    );
    const second = linkAcrossSets(buildChangeSet(
      { toolCallId: 'call_2', documentId: 'doc-1', status: 'proposed', actions: [rewrite('x', { type: 'paragraph', html: 'Drafted sentence, tightened', children: [] })], changeSetId: 'cs-2' },
      editorState.blocks,
    ), [first]);
    reviewState.sets = [first, second];
    reviewState.pending = [...first.changes, ...second.changes];
    render(<ChangeCard change={itemAt(second.changes, 0)} />);

    expect(screen.queryByText(/no longer on the page/)).toBeNull();
    expect(screen.getByText('Accept this first:')).toBeTruthy();
    expect(screen.getByRole('group').getAttribute('aria-label')).toBe('Rewrite paragraph “Drafted sentence”');
  });
});

describe('rejecting an addition', () => {
  it('rejects at once when only continuations depend on it, since they stay', async () => {
    const set = stage(
      [
        writeAfter('p', para('x')),
        writeAfter('x', para('y')),
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
        writeAfter('p', para('x')),
        rewrite('x', { type: 'paragraph', html: 'x, rewritten', children: [] }),
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

describe('what a change rests on', () => {
  const card = (operation: ToolOperation) => {
    const set = stage([operation], editorState.blocks);
    render(<ChangeCard change={itemAt(set.changes, 0)} />);
  };

  it('says in plain words when it adds something the page does not hold', () => {
    card({ ...writeAfter('p', para('n', 'Accuracy rose to 97 percent.')), newInformation: true });
    expect(screen.getByText(/Adds a number, claim, or citation the page doesn’t have yet/)).toBeTruthy();
    expect(screen.getByText('No source recorded.')).toBeTruthy();
    expect(screen.getByText('Passage not recorded.')).toBeTruthy();
  });

  it('distinguishes adding sources from adding claims and displays escaped web titles as text', () => {
    const key = 'url:https://example.org/research';
    card({
      op: 'add_sources',
      sources: [reference(key, { title: 'Research &amp; Writing' })],
      basis: [key],
      newInformation: true,
    });
    expect(screen.getByText('Research & Writing')).toBeTruthy();
    expect(screen.getByText('Adds new sources. Check them before accepting.')).toBeTruthy();
    expect(screen.queryByText(/Based on|Passage not recorded/)).toBeNull();
  });

  it('shows a flagged operation’s exact recorded passage without treating it as proof of support', async () => {
    const set = stage([{
      op: 'write_blocks', position: 'replace', blockId: 'p', newInformation: true,
      blocks: [{ id: 'p', type: 'paragraph', html: 'A new claim <span data-child-id="cite"></span>.',
        children: [{ id: 'cite', type: 'citation', keys: ['url:https://example.org/work'],
          passage: { id: 'S3.1', level: 'snippet', chat_id: 'chat-related' } }] }],
    }], editorState.blocks);
    const sent = recordRequests();
    renderWithQueryClient(<TooltipProvider><ChangeCard change={itemAt(set.changes, 0)} /></TooltipProvider>);
    expect(sent).toHaveLength(0);
    fireEvent.click(screen.getByRole('button', { name: 'Read passage S3.1' }));
    expect(await screen.findByText('Mixture of Experts enable models to be pretrained with far less compute.')).toBeTruthy();
    expect(screen.getByText(/not a guarantee that it supports/)).toBeTruthy();
    expect(sent).toHaveLength(1);
  });

  it('names the sources it draws on, by their titles in the page’s library', () => {
    editorState.doc = { blocks: editorState.blocks, sources: [reference('doi:10.1/a', { title: 'Attention Is All You Need' })] };
    card({ ...rewrite('p', { type: 'paragraph', html: 'Cited text', children: [] }), basis: ['doi:10.1/a', 'doi:10.1/b'], newInformation: false });
    expect(screen.getByText('Based on Attention Is All You Need; doi:10.1/b')).toBeTruthy();
    expect(screen.queryByText(/doesn’t have yet/)).toBeNull();
  });

  it('says nothing for a change that only rewords the author’s text', () => {
    card({ ...rewrite('p', { type: 'paragraph', html: 'Reworded', children: [] }), basis: ['author'], newInformation: false });
    expect(screen.queryByText(/Based on|doesn’t have yet/)).toBeNull();
  });
});

describe('the cards of the other operations', () => {
  const card = (operation: ToolOperation, blocks = editorState.blocks) => {
    const set = stage([operation], blocks);
    render(<ChangeCard change={itemAt(set.changes, 0)} />);
  };

  it('names where a move goes by the block it goes next to', () => {
    editorState.blocks = [para('p', 'Body text'), para('q', 'Closing words')];
    card(moveBlock('p', 'after', 'q'));
    expect(screen.getByText('Suggested move')).toBeTruthy();
    expect(screen.getByText(/Move below “Closing words”/)).toBeTruthy();
  });

  it('shows a citation style the page would switch to', () => {
    card(setMeta({ citationStyle: 'apa' }));
    expect(screen.getByText('Suggested citation style')).toBeTruthy();
    expect(screen.getByText('Citation style: APA 7th edition')).toBeTruthy();
  });

  it('lists the sources it adds to the library, and those it removes', () => {
    card({ op: 'add_sources', sources: [reference('doi:10.1/c', { title: 'Later work' })] });
    expect(screen.getByText(/Adds to the page’s sources/)).toBeTruthy();
    expect(screen.getByText('Later work')).toBeTruthy();
    cleanup();
    editorState.doc = { blocks: editorState.blocks, sources: [reference('doi:10.1/d', { title: 'Unused paper' })] };
    card({ op: 'remove_sources', keys: ['doi:10.1/d'] });
    expect(screen.getByRole('button', { name: /^Accept: Remove a source from the page’s sources/ })).toBeTruthy();
    expect(screen.getByText('Unused paper')).toBeTruthy();
  });

  it('says what a refresh of the page’s references changes in each', () => {
    const before = reference('doi:10.1234/e', { title: 'Old title', authors: 'Ada Lovelace', year: 2020, state: 'unchecked' });
    editorState.doc = { blocks: editorState.blocks, sources: [before] };
    card({ op: 'update_sources', sources: [{ ...reference('doi:10.1234/e', { title: 'New title', authors: 'Ada Lovelace', year: 2021, state: 'verified' }), flags: ['retracted'] }] });
    expect(screen.getByText('Refreshes these references from the registries:')).toBeTruthy();
    expect(screen.getByText('Old title', { selector: '.font-medium' })).toBeTruthy();
    const lines = screen.getAllByRole('listitem').map((item) => item.textContent);
    expect(lines).toEqual(expect.arrayContaining([
      'Title: Old title → New title', 'Year: 2020 → 2021', 'State: not checked → verified', 'Marks: none → retracted',
    ]));
    expect(lines.some((line) => line?.startsWith('Authors'))).toBe(false);
    expect(screen.getByRole('button', { name: /^Accept: Refresh a reference from the registries/ })).toBeTruthy();
  });

  it('names a deletion of several blocks by their count', () => {
    editorState.blocks = [para('p', 'Body text'), para('q', 'Closing words')];
    card(deleteBlocks('p', 'q'));
    expect(screen.getByRole('button', { name: 'Reject: Delete 2 blocks “Body text”' })).toBeTruthy();
  });

  it('shows every block an insert adds', () => {
    card(writeAfter('p', para('a', 'First added'), para('b', 'Second added')));
    expect(screen.getByText('First added')).toBeTruthy();
    expect(screen.getByText('Second added')).toBeTruthy();
  });
});
