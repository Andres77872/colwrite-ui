import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  listRemote: vi.fn(),
  switchTo: vi.fn(),
  createAndSwitch: vi.fn(),
  setTool: vi.fn(),
  setAssistantOpen: vi.fn(),
  setView: vi.fn(),
  setPreference: vi.fn(),
}));

vi.mock('@/editor', () => ({
  DEFAULT_DOCUMENT_TITLE: 'Untitled document',
  focusPageTitle: () => true,
  htmlToText: (html: string) => html,
  useEditorState: () => ({
    documentId: 'current',
    blocks: [{ id: 'h1', type: 'heading', level: 2, html: 'Related work' }],
  }),
  useEditorActions: () => ({
    listRemote: mocks.listRemote,
    switchTo: mocks.switchTo,
    markRecentlyChanged: vi.fn(),
  }),
  useEditor: () => ({ createAndSwitch: mocks.createAndSwitch, loadingDocumentId: null }),
}));
vi.mock('@/components/panels/panelsContextState', () => ({
  usePanels: () => ({
    setTool: mocks.setTool,
    toggle: vi.fn(),
    setAssistantOpen: mocks.setAssistantOpen,
    toggleLeftCollapsed: vi.fn(),
    setMobileNavOpen: vi.fn(),
  }),
}));
vi.mock('@/components/preferences', () => ({
  useAgentTools: () => ({ isSourceEnabled: () => false }),
}));
vi.mock('../viewContextState', () => ({
  useView: () => ({ view: 'workspace', setView: mocks.setView }),
}));
vi.mock('../useShellLayout', () => ({
  useSidebarDocked: () => true,
  useSidebarToggle: () => ({ toggle: vi.fn() }),
}));
vi.mock('@/lib/theme', () => ({
  useTheme: () => ({ preference: 'system', resolved: 'light', setPreference: mocks.setPreference }),
}));
vi.mock('@/components/ui/toastContext', () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

const { CommandPalette } = await import('./CommandPalette');

function summary(id: string, name: string) {
  return { id, name, version: 1, tags: [], createdAt: '2026-09-01T00:00:00Z', updatedAt: '2026-09-20T00:00:00Z' };
}

function renderPalette() {
  return render(<CommandPalette open onOpenChange={vi.fn()} onShowShortcuts={vi.fn()} />);
}

beforeEach(() => {
  vi.clearAllMocks();
  // jsdom does no layout; the palette keeps the active row in view.
  Element.prototype.scrollIntoView = vi.fn();
  mocks.listRemote.mockResolvedValue({
    documents: [summary('current', 'Open now'), summary('a', 'Thesis draft'), summary('b', 'Reading list')],
    count: 3,
  });
  mocks.createAndSwitch.mockResolvedValue('new-doc');
});

afterEach(cleanup);

describe('CommandPalette', () => {
  it('starts with recent documents and commands, not the outline of the open page', async () => {
    renderPalette();

    const recent = await screen.findByRole('group', { name: 'Recent' });
    expect(within(recent).getAllByRole('option').map((option) => option.textContent)).toEqual([
      expect.stringContaining('Thesis draft'),
      expect.stringContaining('Reading list'),
    ]);
    expect(screen.queryByRole('group', { name: 'In this document' })).toBeNull();
    // Commands carry their shortcut.
    const askAi = within(screen.getByRole('group', { name: 'Commands' })).getByRole('option', { name: /Ask AI/ });
    expect(askAi.textContent).toContain('J');
  });

  it('searches headings, documents and the sidebar once something is typed', async () => {
    renderPalette();
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'related' } });

    expect(await screen.findByRole('group', { name: 'In this document' })).toBeTruthy();
    await waitFor(() =>
      expect(mocks.listRemote).toHaveBeenLastCalledWith(
        expect.objectContaining({ query: 'related' }),
        expect.anything(),
      ),
    );
  });

  it('keeps the open page in search results, marked as the current page', async () => {
    renderPalette();
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'open' } });

    const documents = await screen.findByRole('group', { name: 'Documents' });
    const current = within(documents).getByRole('option', { name: /Open now/ });
    expect(current.textContent).toContain('Current page');
  });

  it('creates a new page through the flushing create path', async () => {
    renderPalette();
    fireEvent.click(await screen.findByRole('option', { name: 'New page' }));

    await waitFor(() =>
      expect(mocks.createAndSwitch).toHaveBeenCalledWith({ version: 1, name: 'Untitled document', blocks: [] }),
    );
  });

  it('opens a recent document with the keyboard', async () => {
    renderPalette();
    await screen.findByRole('group', { name: 'Recent' });

    fireEvent.keyDown(screen.getByRole('combobox'), { key: 'ArrowDown' });
    fireEvent.keyDown(screen.getByRole('combobox'), { key: 'Enter' });
    expect(mocks.switchTo).toHaveBeenCalledWith('b', { source: 'selection' });
  });
});
