import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { Block } from '@/editor/types';

/**
 * The options menu is driven entirely by editor state, so mounting it open is
 * just a matter of pointing `openMenuBlockId` at the block under test — no
 * pointer choreography needed to get the menu on screen.
 */

const editorMocks = vi.hoisted(() => ({
  moveBlock: vi.fn(),
  setParagraphColumns: vi.fn(),
  setHeadingLevel: vi.fn(),
  toggleAiHidden: vi.fn(),
  toggleLocked: vi.fn(),
  toggleCollapsed: vi.fn(),
  removeBlock: vi.fn(),
  addBlockAfter: vi.fn(() => 'new-id'),
  setBlockMenu: vi.fn(),
  state: {
    blocks: [
      { id: 'p1', type: 'paragraph', html: 'one', children: [], columns: 1 },
      { id: 'p2', type: 'paragraph', html: 'two', children: [], columns: 2 },
      { id: 'h1', type: 'heading', level: 3, html: 'three' },
    ] as Block[],
    openMenuBlockId: null as string | null,
    openMenuType: null as 'add' | 'options' | null,
    refs: { current: {} as Record<string, HTMLElement | null> },
  },
}));

vi.mock('@/editor', () => ({
  BLOCK_TYPES: [],
  blockTypeLabel: (type: string) => type,
  useEditor: () => ({
    ...editorMocks.state,
    moveBlock: editorMocks.moveBlock,
    setParagraphColumns: editorMocks.setParagraphColumns,
    setHeadingLevel: editorMocks.setHeadingLevel,
    toggleAiHidden: editorMocks.toggleAiHidden,
    toggleLocked: editorMocks.toggleLocked,
    toggleCollapsed: editorMocks.toggleCollapsed,
    removeBlock: editorMocks.removeBlock,
    addBlockAfter: editorMocks.addBlockAfter,
    setBlockMenu: editorMocks.setBlockMenu,
  }),
}));

const { BlockControls } = await import('./BlockControls');

function renderOptionsOpen(id: string) {
  editorMocks.state.openMenuBlockId = id;
  editorMocks.state.openMenuType = 'options';
  return render(<BlockControls id={id} />);
}

beforeEach(() => {
  vi.clearAllMocks();
  editorMocks.state.openMenuBlockId = null;
  editorMocks.state.openMenuType = null;
});

afterEach(cleanup);

describe('BlockControls segmented choices', () => {
  it('renders column choices as menu radio items the menu can rove over', () => {
    renderOptionsOpen('p2');

    // Raw buttons inside menu content are unreachable: Tab is preventDefaulted
    // and the arrow keys only visit registered menu items.
    const choices = screen.getAllByRole('menuitemradio');
    expect(choices.map((choice) => choice.textContent)).toEqual(['1', '2', '3', '4']);
    expect(screen.getByRole('menuitemradio', { name: '2' }).getAttribute('aria-checked')).toBe('true');
    expect(screen.getByRole('menuitemradio', { name: '1' }).getAttribute('aria-checked')).toBe('false');
  });

  it('applies a pick without closing the menu', () => {
    renderOptionsOpen('p2');

    fireEvent.click(screen.getByRole('menuitemradio', { name: '4' }));

    expect(editorMocks.setParagraphColumns).toHaveBeenCalledWith('p2', 4);
    expect(screen.getByRole('menu')).toBeTruthy();
  });

  it('renders heading levels as radio items with the current level checked', () => {
    renderOptionsOpen('h1');

    expect(screen.getByRole('menuitemradio', { name: 'H3' }).getAttribute('aria-checked')).toBe('true');
    fireEvent.click(screen.getByRole('menuitemradio', { name: 'H1' }));
    expect(editorMocks.setHeadingLevel).toHaveBeenCalledWith('h1', 1);
  });
});

describe('BlockControls drag handle', () => {
  /**
   * The regression this guards is subtle and total: the handle used to be the
   * options menu's trigger as well, and Radix opens a menu on `pointerdown`
   * with `event.preventDefault()`. Preventing that default is precisely what
   * stops the browser from starting a native drag, so pressing the handle
   * opened the menu and drag-to-reorder never fired once.
   */
  it('leaves pointerdown alone, so the browser can start a drag', () => {
    render(<BlockControls id="p2" />);
    const handle = screen.getByRole('button', { name: /drag to reorder/i });

    expect(handle.getAttribute('draggable')).toBe('true');
    // A menu trigger would announce itself, and would be the thing that
    // swallows the gesture.
    expect(handle.getAttribute('aria-haspopup')).toBeNull();

    const notPrevented = fireEvent.pointerDown(handle, { button: 0 });
    expect(notPrevented).toBe(true);
  });

  it('carries the block id on the drag, under both types the canvas reads', () => {
    render(<BlockControls id="p2" />);
    const handle = screen.getByRole('button', { name: /drag to reorder/i });

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
    expect(editorMocks.setBlockMenu).toHaveBeenCalledWith(null, null);
  });

  it('keeps the options menu on its own trigger', () => {
    render(<BlockControls id="p2" />);
    const trigger = screen.getByRole('button', { name: /options/i });

    expect(trigger.getAttribute('aria-haspopup')).toBe('menu');
    expect(trigger.getAttribute('draggable')).toBeNull();
  });
});

describe('BlockControls keyboard reorder', () => {
  it('moves the block from the menu, one step at a time', () => {
    renderOptionsOpen('p2');

    // Drag to reorder is pointer-only; these items are the keyboard path.
    fireEvent.click(screen.getByRole('menuitem', { name: 'Move up' }));
    expect(editorMocks.moveBlock).toHaveBeenCalledWith('p2', -1);

    fireEvent.click(screen.getByRole('menuitem', { name: 'Move down' }));
    expect(editorMocks.moveBlock).toHaveBeenCalledWith('p2', 1);
  });

  it('disables the direction that has nowhere to go', () => {
    renderOptionsOpen('p1');
    expect(screen.getByRole('menuitem', { name: 'Move up' }).getAttribute('aria-disabled')).toBe('true');
    expect(screen.getByRole('menuitem', { name: 'Move down' }).getAttribute('aria-disabled')).toBeNull();
    cleanup();

    renderOptionsOpen('h1');
    expect(screen.getByRole('menuitem', { name: 'Move up' }).getAttribute('aria-disabled')).toBeNull();
    expect(screen.getByRole('menuitem', { name: 'Move down' }).getAttribute('aria-disabled')).toBe('true');
  });
});
