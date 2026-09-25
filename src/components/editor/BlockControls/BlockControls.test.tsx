import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { Block } from '@/editor/types';

/**
 * The block menu is driven by editor state, so mounting it open is a matter
 * of passing `menuOpen` — no pointer choreography needed to get it on screen.
 * The pure block-kind helpers are the real ones; only the actions are mocked.
 */

const actions = vi.hoisted(() => ({
  duplicateBlock: vi.fn(() => 'copy-id'),
  insertBlocksAfter: vi.fn(() => ['new-id']),
  insertBlockBeforeExact: vi.fn(),
  moveBlock: vi.fn(),
  removeBlock: vi.fn(),
  selectBlocks: vi.fn(),
  setBlockKind: vi.fn(),
  setBlockMenu: vi.fn(),
  setHeadingLevel: vi.fn(),
  setParagraphColumns: vi.fn(),
  toggleAiHidden: vi.fn(),
  toggleCollapsed: vi.fn(),
  toggleLocked: vi.fn(),
  refs: { current: {} as Record<string, HTMLElement | null> },
}));

vi.mock('@/editor', async () => {
  const actual = await vi.importActual<typeof import('@/editor')>('@/editor');
  // The menu footer reads when the page was last saved.
  return { ...actual, useEditorActions: () => actions, useEditor: () => ({ lastSavedAt: null }) };
});
vi.mock('@/components/ui/toastContext', () => ({ useToast: () => ({ toast: vi.fn() }) }));

const { BlockControls } = await import('./BlockControls');

const BLOCKS: Record<string, Block> = {
  p1: { id: 'p1', type: 'paragraph', html: 'one', children: [], columns: 1 },
  p2: { id: 'p2', type: 'paragraph', html: 'two', children: [], columns: 2 },
  h1: { id: 'h1', type: 'heading', level: 3, html: 'three' },
  todo: { id: 'todo', type: 'paragraph', html: 'task', children: [], columns: 1, variant: 'todo', checked: false },
  locked: { id: 'locked', type: 'paragraph', html: 'fixed', children: [], columns: 1, locked: true },
};

function renderControls(id: string, options: { open?: boolean; first?: boolean; last?: boolean } = {}) {
  return render(
    <BlockControls
      block={BLOCKS[id]}
      isFirst={options.first ?? false}
      isLast={options.last ?? false}
      menuOpen={options.open ?? false}
    />,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(cleanup);

/** Columns and heading level sit under More, set once in a while. */
function openMore() {
  fireEvent.click(screen.getByRole('menuitem', { name: /More/ }));
}

describe('BlockControls segmented choices', () => {
  it('renders column choices as menu radio items the menu can rove over', () => {
    renderControls('p2', { open: true });
    openMore();

    const choices = screen.getAllByRole('menuitemradio');
    expect(choices.map((choice) => choice.textContent)).toEqual(['1', '2', '3', '4']);
    expect(screen.getByRole('menuitemradio', { name: '2' }).getAttribute('aria-checked')).toBe('true');
  });

  it('applies a pick without closing the menu', () => {
    renderControls('p2', { open: true });
    openMore();

    fireEvent.click(screen.getByRole('menuitemradio', { name: '4' }));

    expect(actions.setParagraphColumns).toHaveBeenCalledWith('p2', 4);
    expect(screen.getAllByRole('menu').length).toBeGreaterThan(0);
    expect(screen.getByRole('menuitemradio', { name: '4' })).toBeTruthy();
  });

  it('renders heading levels as radio items with the current level checked', () => {
    renderControls('h1', { open: true });
    openMore();

    expect(screen.getByRole('menuitemradio', { name: 'H3' }).getAttribute('aria-checked')).toBe('true');
    fireEvent.click(screen.getByRole('menuitemradio', { name: 'H1' }));
    expect(actions.setHeadingLevel).toHaveBeenCalledWith('h1', 1);
  });

  it('offers no columns on a list item', () => {
    renderControls('todo', { open: true });
    openMore();
    expect(screen.queryByRole('menuitemradio', { name: '2' })).toBeNull();
  });
});

describe('BlockControls handle', () => {
  /**
   * The handle drags on press and opens the menu on click. Radix's trigger
   * opens on pointerdown with `preventDefault()`, which is precisely what stops
   * the browser from starting a native drag — so the handle is not a Radix
   * trigger, and pointerdown must stay un-prevented.
   */
  it('leaves pointerdown alone, so the browser can start a drag', () => {
    renderControls('p2');
    const handle = screen.getByRole('button', { name: /drag to move/i });

    expect(handle.getAttribute('draggable')).toBe('true');
    const notPrevented = fireEvent.pointerDown(handle, { button: 0 });
    expect(notPrevented).toBe(true);
  });

  it('carries the block id on the drag, under both types the canvas reads', () => {
    renderControls('p2');
    const handle = screen.getByRole('button', { name: /drag to move/i });

    const data: Record<string, string> = {};
    const dataTransfer = {
      setData: (type: string, value: string) => { data[type] = value; },
      effectAllowed: '',
    };
    fireEvent.dragStart(handle, { dataTransfer });

    expect(data['application/x-block-id']).toBe('p2');
    expect(data['text/plain']).toBe('p2');
    expect(dataTransfer.effectAllowed).toBe('move');
    // An open menu would portal an overlay across the drop target.
    expect(actions.setBlockMenu).toHaveBeenCalledWith(null, null);
  });

  it('does not drag a locked block, which Move up/down refuse to move too', () => {
    renderControls('locked');
    const handle = screen.getByRole('button', { name: /locked: click for options/i });

    expect(handle.getAttribute('draggable')).toBe('false');
    expect(screen.queryByRole('button', { name: /drag to move/i })).toBeNull();
    fireEvent.click(handle);
    expect(actions.setBlockMenu).toHaveBeenCalledWith('locked', 'options');
  });

  it('opens the block menu on click', () => {
    renderControls('p2');
    const handle = screen.getByRole('button', { name: /click for options/i });

    expect(handle.getAttribute('aria-haspopup')).toBe('menu');
    fireEvent.mouseDown(handle);
    fireEvent.click(handle);

    expect(actions.setBlockMenu).toHaveBeenCalledWith('p2', 'options');
  });

  it('does not open the menu when the press became a drag', () => {
    renderControls('p2');
    const handle = screen.getByRole('button', { name: /click for options/i });

    fireEvent.mouseDown(handle);
    fireEvent.dragStart(handle, { dataTransfer: { setData: () => {}, effectAllowed: '' } });
    vi.clearAllMocks();
    fireEvent.click(handle);

    expect(actions.setBlockMenu).not.toHaveBeenCalled();
  });

  it('adds a line below from the plus button', () => {
    renderControls('p1');
    fireEvent.click(screen.getByRole('button', { name: 'Add a block below' }));
    expect(actions.insertBlocksAfter).toHaveBeenCalledWith('p1', [
      expect.objectContaining({ type: 'paragraph', html: '' }),
    ]);
  });
});

describe('BlockControls menu commands', () => {
  it('moves the block from the menu, one step at a time', () => {
    renderControls('p2', { open: true });

    fireEvent.click(screen.getByRole('menuitem', { name: /Move up/ }));
    expect(actions.moveBlock).toHaveBeenCalledWith('p2', -1);

    fireEvent.click(screen.getByRole('menuitem', { name: /Move down/ }));
    expect(actions.moveBlock).toHaveBeenCalledWith('p2', 1);
  });

  it('disables the direction that has nowhere to go', () => {
    renderControls('p1', { open: true, first: true });
    expect(screen.getByRole('menuitem', { name: /Move up/ }).getAttribute('aria-disabled')).toBe('true');
    expect(screen.getByRole('menuitem', { name: /Move down/ }).getAttribute('aria-disabled')).toBeNull();
    cleanup();

    renderControls('h1', { open: true, last: true });
    expect(screen.getByRole('menuitem', { name: /Move up/ }).getAttribute('aria-disabled')).toBeNull();
    expect(screen.getByRole('menuitem', { name: /Move down/ }).getAttribute('aria-disabled')).toBe('true');
  });

  it('duplicates the block', () => {
    renderControls('p1', { open: true });
    fireEvent.click(screen.getByRole('menuitem', { name: /Duplicate/ }));
    expect(actions.duplicateBlock).toHaveBeenCalledWith('p1');
  });

  it('protects a locked block from delete, move and turn into', () => {
    renderControls('locked', { open: true });
    expect(screen.getByRole('menuitem', { name: /Delete/ }).getAttribute('aria-disabled')).toBe('true');
    expect(screen.getByRole('menuitem', { name: /Move up/ }).getAttribute('aria-disabled')).toBe('true');
    expect(screen.getByRole('menuitem', { name: /Turn into/ }).getAttribute('aria-disabled')).toBe('true');
    // Unlocking stays available: it is how the author gets out.
    expect(screen.getByRole('menuitem', { name: /Unlock block/ }).getAttribute('aria-disabled')).toBeNull();
  });

  it('names the block by its kind', () => {
    renderControls('todo', { open: true });
    expect(screen.getByRole('menu').textContent).toContain('To-do list');
  });
});

describe('BlockControls menu search', () => {
  it('narrows the menu to matching actions as you type', () => {
    renderControls('p1', { open: true });
    const search = screen.getByRole('textbox', { name: 'Search actions' });

    fireEvent.change(search, { target: { value: 'dup' } });

    const items = screen.getAllByRole('menuitem');
    expect(items.map((item) => item.textContent)).toEqual([expect.stringContaining('Duplicate')]);
  });

  it('finds Turn into targets and runs the first match on Enter', () => {
    renderControls('p1', { open: true });
    const search = screen.getByRole('textbox', { name: 'Search actions' });

    fireEvent.change(search, { target: { value: 'heading 2' } });
    fireEvent.keyDown(search, { key: 'Enter' });

    expect(actions.setBlockKind).toHaveBeenCalledWith('p1', 'h2');
  });

  it('says so when nothing matches', () => {
    renderControls('p1', { open: true });
    fireEvent.change(screen.getByRole('textbox', { name: 'Search actions' }), { target: { value: 'zzz' } });
    expect(screen.getByText('No matching actions')).toBeTruthy();
  });

  it('keeps Copy as Markdown and Collapse under More', () => {
    renderControls('p1', { open: true });
    expect(screen.queryByRole('menuitem', { name: /Copy as Markdown/ })).toBeNull();
    expect(screen.getByRole('menuitem', { name: /More/ })).toBeTruthy();
  });
});
