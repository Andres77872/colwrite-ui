import { cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  newPage: vi.fn(async () => 'page-2'),
  newPageDisabled: false,
  setPanel: vi.fn(),
}));

vi.mock('@/editor', () => ({
  useDocumentActions: () => ({ save: vi.fn() }),
  useEditorActions: () => ({ undo: vi.fn(), redo: vi.fn() }),
}));
vi.mock('@/actions/useNewPage', () => ({
  useNewPage: () => ({ newPage: mocks.newPage, creating: false, disabled: mocks.newPageDisabled }),
}));
vi.mock('@/components/panels/panelsContextState', () => ({
  usePanels: () => ({ toggle: vi.fn(), toggleAssistant: vi.fn(), activePanel: 'assistant', setPanel: mocks.setPanel }),
}));
vi.mock('@/components/layout/useShellLayout', () => ({
  useSidebarToggle: () => ({ toggle: vi.fn() }),
}));

const { inForeignTextField, useAppShortcuts } = await import('../useAppShortcuts');

afterEach(() => {
  cleanup();
  document.body.innerHTML = '';
});

function mount(html: string): HTMLElement {
  document.body.innerHTML = html;
  return document.querySelector<HTMLElement>('[data-target]')!;
}

describe('whose undo Mod+Z is', () => {
  it('is the document’s inside a block', () => {
    const block = mount('<div class="canvas"><div class="editable" contenteditable="true" data-target></div></div>');
    expect(inForeignTextField(block)).toBe(false);
  });

  it('is the title’s own inside the page title, although it sits in the canvas', () => {
    // The title commits on blur; the document journal has no entry for what
    // is being typed there, so its undo would rewind the body instead.
    const title = mount(
      '<div class="canvas"><h1><span data-page-title contenteditable="plaintext-only" data-target></span></h1></div>',
    );
    expect(inForeignTextField(title)).toBe(true);
  });

  it('is the field’s own in inputs, textareas and editables outside the page', () => {
    expect(inForeignTextField(mount('<input data-target />'))).toBe(true);
    expect(inForeignTextField(mount('<textarea data-target></textarea>'))).toBe(true);
    expect(inForeignTextField(mount('<aside><div contenteditable="true" data-target></div></aside>'))).toBe(true);
  });

  it('is the document’s when no text field has focus', () => {
    expect(inForeignTextField(mount('<button data-target>Save</button>'))).toBe(false);
    expect(inForeignTextField(null)).toBe(false);
  });
});

function Shortcuts() {
  useAppShortcuts({ onShowHelp: vi.fn(), onOpenPalette: vi.fn() });
  return null;
}

function press(init: KeyboardEventInit): KeyboardEvent {
  const event = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init });
  window.dispatchEvent(event);
  return event;
}

describe('the app shortcuts', () => {
  beforeEach(() => {
    mocks.newPage.mockClear();
    mocks.setPanel.mockClear();
    mocks.newPageDisabled = false;
  });

  it('creates a page with Mod+Alt+N through the shared New page action', () => {
    render(<Shortcuts />);

    const event = press({ key: 'n', code: 'KeyN', ctrlKey: true, altKey: true });
    expect(mocks.newPage).toHaveBeenCalledTimes(1);
    expect(event.defaultPrevented).toBe(true);
  });

  it('claims Mod+Alt+N but creates nothing while a creation or a switch owns the editor', () => {
    mocks.newPageDisabled = true;
    render(<Shortcuts />);

    const event = press({ key: 'Dead', code: 'KeyN', metaKey: true, altKey: true });
    expect(mocks.newPage).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(true);
  });

  it('opens the Library with Mod+Shift+L', () => {
    render(<Shortcuts />);

    press({ key: 'L', ctrlKey: true, shiftKey: true });
    expect(mocks.setPanel).toHaveBeenCalledWith('library');
  });

  it('stands down behind a dialog', () => {
    render(<Shortcuts />);
    const dialog = document.createElement('div');
    dialog.setAttribute('role', 'dialog');
    dialog.dataset.state = 'open';
    document.body.append(dialog);

    press({ key: 'n', code: 'KeyN', ctrlKey: true, altKey: true });
    press({ key: 'l', ctrlKey: true, shiftKey: true });
    expect(mocks.newPage).not.toHaveBeenCalled();
    expect(mocks.setPanel).not.toHaveBeenCalled();
  });
});
