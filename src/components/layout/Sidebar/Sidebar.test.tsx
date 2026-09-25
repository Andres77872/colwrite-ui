import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TooltipProvider } from '@/components/ui/tooltip';

const mocks = vi.hoisted(() => ({
  logout: vi.fn(),
  setView: vi.fn(),
  setPreference: vi.fn(),
  createAndSwitch: vi.fn(),
  toast: vi.fn(),
  docked: true,
  panels: {
    leftCollapsed: false,
    toggleLeftCollapsed: vi.fn(),
    setMobileNavOpen: vi.fn(),
    setTool: vi.fn(),
    setAssistantOpen: vi.fn(),
  },
}));

vi.mock('@/components/auth/authContextState', () => ({
  useAuth: () => ({ user: { name: 'Ada Lovelace', email: 'ada@example.com' }, logout: mocks.logout }),
}));
vi.mock('@/components/panels/panelsContextState', () => ({
  usePanels: () => mocks.panels,
}));
vi.mock('../viewContextState', () => ({
  useView: () => ({ view: 'workspace', setView: mocks.setView }),
}));
vi.mock('../useShellLayout', () => ({
  useSidebarDocked: () => mocks.docked,
  useLeftSidebarAutoHidden: () => false,
  useSidebarToggle: () => ({ toggle: vi.fn() }),
}));
vi.mock('@/lib/theme', () => ({
  useTheme: () => ({ preference: 'system', resolved: 'light', setPreference: mocks.setPreference }),
}));
vi.mock('@/editor', () => ({
  DEFAULT_DOCUMENT_TITLE: 'Untitled document',
  focusPageTitle: () => true,
  useEditor: () => ({ createAndSwitch: mocks.createAndSwitch, loadingDocumentId: null }),
}));
vi.mock('@/components/ui/toastContext', () => ({
  useToast: () => ({ toast: mocks.toast }),
}));
vi.mock('@/components/editor/DocumentsMenu', () => ({
  DocumentsMenu: () => <section aria-label="Documents" />,
}));

const { Sidebar } = await import('./Sidebar');

const onOpenPalette = vi.fn();
const onShowShortcuts = vi.fn();

function renderSidebar() {
  return render(
    <TooltipProvider>
      <Sidebar onOpenPalette={onOpenPalette} onShowShortcuts={onShowShortcuts} />
    </TooltipProvider>,
  );
}

function openAccountMenu() {
  fireEvent.pointerDown(screen.getByRole('button', { name: 'Account and workspace menu' }), {
    button: 0,
    ctrlKey: false,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.docked = true;
  mocks.panels.leftCollapsed = false;
  mocks.createAndSwitch.mockResolvedValue('new-doc');
});

afterEach(cleanup);

describe('Sidebar', () => {
  it('opens with the workspace button instead of a global header', () => {
    renderSidebar();

    expect(screen.getByRole('button', { name: 'Account and workspace menu' }).textContent).toContain(
      'Ada’s workspace',
    );
    expect(screen.getByRole('region', { name: 'Documents' })).toBeTruthy();
  });

  it('routes the quick rows to search, the assistant and a new page', async () => {
    renderSidebar();

    fireEvent.click(screen.getByRole('button', { name: /^Search/ }));
    expect(onOpenPalette).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole('button', { name: 'Ask AI' }));
    expect(mocks.panels.setAssistantOpen).toHaveBeenCalledWith(true);

    fireEvent.click(screen.getByRole('button', { name: 'New page' }));
    await waitFor(() =>
      expect(mocks.createAndSwitch).toHaveBeenCalledWith({ version: 1, name: 'Untitled document', blocks: [] }),
    );
  });

  it('keeps the library and settings one click away at the bottom', () => {
    renderSidebar();

    fireEvent.click(screen.getByRole('button', { name: 'Library' }));
    expect(mocks.panels.setTool).toHaveBeenCalledWith('library');

    fireEvent.click(screen.getByRole('button', { name: 'Settings' }));
    expect(mocks.setView).toHaveBeenCalledWith('profile');
  });

  it('collapses from its own header when docked', () => {
    renderSidebar();

    fireEvent.click(screen.getByRole('button', { name: 'Close sidebar' }));
    expect(mocks.panels.toggleLeftCollapsed).toHaveBeenCalledTimes(1);
  });

  it('closes the drawer, rather than collapsing, on narrow screens', () => {
    mocks.docked = false;
    renderSidebar();

    fireEvent.click(screen.getByRole('button', { name: 'Library' }));
    expect(mocks.panels.setMobileNavOpen).toHaveBeenCalledWith(false);
    fireEvent.click(screen.getByRole('button', { name: 'Close sidebar' }));
    expect(mocks.panels.toggleLeftCollapsed).not.toHaveBeenCalled();
  });

  it('has a visible route to the keyboard shortcuts reference in the account menu', () => {
    renderSidebar();
    openAccountMenu();

    // Mod+/ only works for people who already know the chord.
    fireEvent.click(screen.getByRole('menuitem', { name: /Keyboard shortcuts/ }));
    expect(onShowShortcuts).toHaveBeenCalledTimes(1);
  });

  it('holds settings, the version and sign-out in the account menu', () => {
    renderSidebar();
    openAccountMenu();

    expect(screen.getByText('ada@example.com')).toBeTruthy();
    expect(screen.getByText(/v0\.1/)).toBeTruthy();
    fireEvent.click(screen.getByRole('menuitem', { name: 'Settings' }));
    expect(mocks.setView).toHaveBeenCalledWith('profile');

    openAccountMenu();
    fireEvent.click(screen.getByRole('menuitem', { name: 'Sign out' }));
    expect(mocks.logout).toHaveBeenCalledTimes(1);
  });

  it('switches the appearance from the account menu', () => {
    renderSidebar();
    openAccountMenu();

    const appearance = screen.getByRole('menuitem', { name: 'Appearance' });
    // Submenus open from the keyboard in jsdom; hover intent is timing-based.
    fireEvent.keyDown(appearance, { key: 'ArrowRight' });
    const dark = screen.getByRole('menuitemradio', { name: 'Dark' });
    expect(screen.getByRole('menuitemradio', { name: 'System' }).getAttribute('aria-checked')).toBe('true');
    fireEvent.click(dark);
    expect(mocks.setPreference).toHaveBeenCalledWith('dark');
  });
});
