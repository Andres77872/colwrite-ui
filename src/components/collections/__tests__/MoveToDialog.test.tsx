import { act, cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderWithQueryClient as render } from '@/__tests__/queryClient';
import { TREE } from '@/dev/msw/fixtures';
import { MoveToDialog, type MoveSubject } from '../MoveToDialog';

afterEach(cleanup);

function renderDialog(subject: MoveSubject, onChoose = vi.fn().mockResolvedValue(undefined)) {
  const onOpenChange = vi.fn();
  render(<MoveToDialog open subject={subject} onOpenChange={onOpenChange} onChoose={onChoose} />);
  return { onChoose, onOpenChange };
}

const item = (name: RegExp) => screen.findByRole('treeitem', { name });

describe('MoveToDialog', () => {
  it('is an APG tree read a branch at a time, with one tab stop and the arrow keys', async () => {
    renderDialog({ kind: 'page', name: 'Outline', collectionId: TREE.thesis });

    const archive = await item(/Archive/);
    const items = screen.getAllByRole('treeitem');
    expect(items.map((row) => row.getAttribute('aria-level'))).toEqual(['1', '1', '1', '1']);
    expect(items.map((row) => row.getAttribute('aria-posinset'))).toEqual(['1', '2', '3', '4']);
    expect(items.filter((row) => row.tabIndex === 0)).toEqual([archive]);
    // Only a collection with collections inside opens; nothing in a picker can be dragged.
    expect(archive.getAttribute('aria-expanded')).toBe('false');
    expect((await item(/Reading notes/)).hasAttribute('aria-expanded')).toBe(false);
    expect(document.querySelector('[draggable="true"]')).toBeNull();

    archive.focus();
    fireEvent.keyDown(archive, { key: 'ArrowRight' });
    const year = await item(/2025/);
    expect(year.getAttribute('aria-level')).toBe('2');
    fireEvent.keyDown(archive, { key: 'ArrowDown' });
    await waitFor(() => expect(document.activeElement).toBe(year));
  });

  it('shows where a page is as "Already here", and moves it to the collection chosen', async () => {
    const { onChoose } = renderDialog({ kind: 'page', name: 'Outline', collectionId: TREE.thesis });

    const thesis = await item(/Thesis/);
    expect(thesis.getAttribute('aria-disabled')).toBe('true');
    expect(within(thesis).getByText('Already here')).toBeTruthy();
    fireEvent.click(thesis);
    expect(screen.getByRole('button', { name: 'Move here' }).hasAttribute('disabled')).toBe(true);

    fireEvent.click(await item(/Lecture notes/));
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Move here' }));
    });
    expect(onChoose).toHaveBeenCalledWith({ kind: 'collection', collectionId: TREE.lectures, name: 'Lecture notes' });
  });

  it('offers a PDF Unfiled and this page, and a page already at the top level no top level', async () => {
    renderDialog({ kind: 'pdf', name: 'paper.pdf', location: { kind: 'unfiled' }, pageId: 'doc-1' });
    expect(screen.getByRole('radio', { name: /This page/ }).getAttribute('aria-disabled')).toBeNull();
    expect(screen.getByRole('radio', { name: /Unfiled/ }).getAttribute('aria-disabled')).toBe('true');
    cleanup();

    renderDialog({ kind: 'page', name: 'Notes', collectionId: null });
    expect(screen.getByRole('radio', { name: /Top level/ }).getAttribute('aria-disabled')).toBe('true');
  });

  it('chooses a collection for this page to use, and needs one chosen first', async () => {
    const { onChoose } = renderDialog({ kind: 'grant' });

    expect(screen.getByRole('heading', { name: 'Use PDFs from a collection' })).toBeTruthy();
    expect(screen.queryByRole('radiogroup', { name: 'Move destination' })).toBeNull();
    const confirm = screen.getByRole('button', { name: 'Use on this page' });
    expect(confirm.hasAttribute('disabled')).toBe(true);
    fireEvent.click(await item(/Reading notes/));
    await act(async () => {
      fireEvent.click(confirm);
    });
    expect(onChoose).toHaveBeenCalledWith({ kind: 'collection', collectionId: TREE.readingNotes, name: 'Reading notes' });
  });

  it('finds a destination by its path', async () => {
    const { onChoose } = renderDialog({ kind: 'page', name: 'Outline', collectionId: TREE.thesis });
    fireEvent.change(screen.getByRole('searchbox', { name: 'Find a collection by its path' }), { target: { value: 'week' } });

    const results = await screen.findByRole('radiogroup', { name: 'Matching collections' });
    const week = await within(results).findByRole('radio', { name: /^Week 3/ });
    expect(within(week).getByText('Archive › 2025 › Spring term')).toBeTruthy();
    // "Drafts" is inside Week 3, so its path matches too.
    expect(within(results).getByRole('radio', { name: /^Drafts/ })).toBeTruthy();
    fireEvent.click(week);
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Move here' }));
    });
    expect(onChoose).toHaveBeenCalledWith({ kind: 'collection', collectionId: 8, name: 'Week 3' });
  });

  it.each([
    'A collection cannot be moved into itself or its descendants',
    'Collection depth cannot exceed 32',
  ])('shows the server’s refusal and stays open: %s', async (message) => {
    const { onOpenChange } = renderDialog(
      { kind: 'collection', name: 'Methods', collectionId: 99, parentId: TREE.thesis },
      vi.fn().mockRejectedValue(new Error(message)),
    );

    fireEvent.click(screen.getByRole('radio', { name: /Top level/ }));
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Move here' }));
    });
    expect(await screen.findByText(message)).toBeTruthy();
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
  });
});
