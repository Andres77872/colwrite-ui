import { itemAt, takeItems } from '@/lib/itemAt';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { createRef } from 'react';
import { createPortal } from 'react-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TreeView, type TreeViewHandle } from './TreeView';
import type { TreeRow, TreeRowBase } from './types';

type Row = TreeRowBase & { kind: 'item' };

const row = (key: string, level: number, parentKey: string | null, extra: Partial<Row> = {}): Row => ({
  key, kind: 'item', label: key, level, parentKey, position: 1, setSize: 1, ...extra,
});

function renderTree(rows: TreeRow<Row>[], props: { onExpandedChange?: (row: Row, open: boolean) => void } = {}) {
  const onActivate = vi.fn();
  const onExpandedChange = props.onExpandedChange ?? vi.fn();
  render(
    <TreeView
      rows={rows}
      ariaLabel="Things"
      selectedKey="a"
      onActivate={onActivate}
      onExpandedChange={onExpandedChange}
      renderRow={(item) => <span>{item.label}</span>}
    />,
  );
  return { onActivate, onExpandedChange };
}

afterEach(cleanup);

describe('TreeView', () => {
  it('keeps one tab stop and walks the rows with the arrow keys, skipping notes', () => {
    renderTree([
      row('a', 1, null),
      { kind: 'note', key: 'loading', level: 2, tone: 'loading', text: 'Loading…' },
      row('b', 1, null),
    ]);
    const items = screen.getAllByRole('treeitem');
    expect(items.map((item) => item.tabIndex)).toEqual([0, -1]);
    expect(screen.getByText('Loading…').closest('[aria-hidden="true"]')).toBeTruthy();

    fireEvent.keyDown(itemAt(items, 0), { key: 'ArrowDown' });
    expect(screen.getAllByRole('treeitem').map((item) => item.tabIndex)).toEqual([-1, 0]);
  });

  it('opens a closed row with ArrowRight', () => {
    const { onExpandedChange } = renderTree([row('a', 1, null, { expandable: true, expanded: false })]);
    const parent = screen.getByRole('treeitem');
    expect(parent.getAttribute('aria-expanded')).toBe('false');
    fireEvent.keyDown(parent, { key: 'ArrowRight' });
    expect(onExpandedChange).toHaveBeenCalledWith(expect.objectContaining({ key: 'a' }), true);
  });

  it('moves into an open row with ArrowRight, and back to its parent with ArrowLeft', () => {
    renderTree([row('a', 1, null, { expandable: true, expanded: true }), row('child', 2, 'a')]);
    const tabStops = () => screen.getAllByRole('treeitem').map((item) => item.tabIndex);
    const [parent, child] = takeItems(screen.getAllByRole('treeitem'), 2);
    fireEvent.keyDown(parent, { key: 'ArrowRight' });
    expect(tabStops()).toEqual([-1, 0]);
    fireEvent.keyDown(child, { key: 'ArrowLeft' });
    expect(tabStops()).toEqual([0, -1]);
  });

  it('activates a row with Enter, but not a disabled one', () => {
    const { onActivate } = renderTree([row('a', 1, null), row('b', 1, null, { disabled: true })]);
    const [first, second] = takeItems(screen.getAllByRole('treeitem'), 2);
    fireEvent.keyDown(first, { key: 'Enter' });
    fireEvent.keyDown(second, { key: 'Enter' });
    expect(onActivate).toHaveBeenCalledTimes(1);
    expect(second.getAttribute('aria-disabled')).toBe('true');
  });

  it('never marks an action row as selected', () => {
    renderTree([row('a', 1, null, { selectable: false })]);
    expect(screen.getByRole('treeitem').getAttribute('aria-selected')).toBe('false');
  });

  it('marks the open page with aria-current, apart from selection', () => {
    renderTree([row('a', 1, null), row('b', 1, null, { current: true })]);
    const [first, second] = takeItems(screen.getAllByRole('treeitem'), 2);
    expect(first.getAttribute('aria-current')).toBeNull();
    expect(second.getAttribute('aria-current')).toBe('page');
  });

  it('moves to the next row whose name starts with what was typed', async () => {
    renderTree([row('Alpha', 1, null), row('Beta', 1, null), row('Bravo', 1, null), row('Charlie', 1, null)]);
    const [alpha, beta, bravo] = takeItems(screen.getAllByRole('treeitem'), 3);

    fireEvent.keyDown(alpha, { key: 'b' });
    await waitFor(() => expect(document.activeElement).toBe(beta));
    // Each repeat of one letter cycles through the rows that start with it.
    fireEvent.keyDown(beta, { key: 'b' });
    await waitFor(() => expect(document.activeElement).toBe(bravo));
  });

  it('puts focus on a row when asked from outside', async () => {
    const handle = createRef<TreeViewHandle>();
    render(
      <TreeView
        rows={[row('a', 1, null), row('b', 1, null)]}
        ariaLabel="Things"
        selectedKey="a"
        onActivate={vi.fn()}
        onExpandedChange={vi.fn()}
        renderRow={(item) => <span>{item.label}</span>}
        handleRef={handle}
      />,
    );
    act(() => {
      expect(handle.current?.focusRow('b')).toBe(true);
    });
    await waitFor(() => expect(document.activeElement).toBe(itemAt(screen.getAllByRole('treeitem'), 1)));
    expect(handle.current?.focusRow('missing')).toBe(false);
  });

  it('takes a drop inside a row or in the gap beside it, as the row allows', () => {
    const onDrop = vi.fn();
    const transfer = { types: ['application/x-test'], dropEffect: 'none' } as unknown as DataTransfer;
    render(
      <TreeView
        rows={[row('folder', 1, null, { droppable: true }), row('page', 1, null, { droppable: true })]}
        ariaLabel="Things"
        selectedKey={null}
        onActivate={vi.fn()}
        onExpandedChange={vi.fn()}
        renderRow={(item) => <span>{item.label}</span>}
        drop={{
          accepts: () => true,
          placements: (item) => (item.key === 'folder' ? ['inside', 'before', 'after'] : ['before', 'after']),
          onDrop,
        }}
      />,
    );
    const [folder, page] = takeItems(screen.getAllByRole('treeitem'), 2);
    const box = { top: 0, height: 40, bottom: 40, left: 0, right: 100, width: 100, x: 0, y: 0, toJSON: () => ({}) };
    folder.getBoundingClientRect = () => box;
    page.getBoundingClientRect = () => box;
    const at = (target: HTMLElement, type: string, clientY: number) => {
      const event = new MouseEvent(type, { bubbles: true, cancelable: true, clientY });
      Object.defineProperty(event, 'dataTransfer', { value: transfer });
      act(() => {
        target.dispatchEvent(event);
      });
    };

    at(folder, 'dragover', 20);
    expect(folder.getAttribute('data-drop')).toBe('inside');
    at(folder, 'dragover', 38);
    expect(folder.getAttribute('data-drop')).toBe('after');
    at(page, 'dragover', 10);
    expect(page.getAttribute('data-drop')).toBe('before');
    at(page, 'drop', 10);
    expect(onDrop).toHaveBeenCalledWith(expect.objectContaining({ key: 'page' }), 'before', transfer);
  });

  it('opens a closed row a drag rests on after a pause', async () => {
    vi.useFakeTimers();
    const onExpandedChange = vi.fn();
    const transfer = { types: ['x'], dropEffect: 'none' } as unknown as DataTransfer;
    render(
      <TreeView
        rows={[row('folder', 1, null, { droppable: true, expandable: true, expanded: false })]}
        ariaLabel="Things"
        selectedKey={null}
        onActivate={vi.fn()}
        onExpandedChange={onExpandedChange}
        renderRow={(item) => <span>{item.label}</span>}
        drop={{ accepts: () => true, placements: () => ['inside'], onDrop: vi.fn() }}
      />,
    );
    fireEvent.dragOver(screen.getByRole('treeitem'), { dataTransfer: transfer });
    act(() => {
      vi.advanceTimersByTime(599);
    });
    expect(onExpandedChange).not.toHaveBeenCalled();
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(onExpandedChange).toHaveBeenCalledWith(expect.objectContaining({ key: 'folder' }), true);
    vi.useRealTimers();
  });

  it('ignores a click that only bubbled through a row from a portaled menu', () => {
    const onActivate = vi.fn();
    render(
      <TreeView
        rows={[row('a', 1, null)]}
        ariaLabel="Things"
        selectedKey={null}
        onActivate={onActivate}
        onExpandedChange={vi.fn()}
        renderRow={(item) => (
          <>
            <span>{item.label}</span>
            {createPortal(<div role="menuitem">Move to…</div>, document.body)}
          </>
        )}
      />,
    );
    // React bubbles a portal's events through its owner: the row must not take it.
    fireEvent.click(screen.getByRole('menuitem'));
    expect(onActivate).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('treeitem'));
    expect(onActivate).toHaveBeenCalledTimes(1);
  });
});
