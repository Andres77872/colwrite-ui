import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import { renderWithQueryClient as render } from '@/__tests__/queryClient';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import { TooltipProvider } from '@/components/ui/tooltip';
import { WorkspaceContext, type WorkspaceContextValue } from '@/components/workspace/workspaceContextState';
import { takeRequestedSettingsPane } from '@/components/profile/settingsPane';
import { LAB_WORKSPACE_ID, OWNED_WORKSPACE_ID, PERSONAL_WORKSPACE_ID, VIEWER_WORKSPACE_ID } from '@/dev/msw/fixtures';
import type { Workspace } from '@/data/workspaces';

const mocks = vi.hoisted(() => ({
  logout: vi.fn(),
  setView: vi.fn(),
  setPreference: vi.fn(),
  createAndSwitch: vi.fn(),
  switchWorkspace: vi.fn(),
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
  useView: () => ({ view: 'editor', setView: mocks.setView }),
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
  DEFAULT_DOCUMENT_TITLE: 'Untitled page',
  focusPageTitle: () => true,
  useDocumentActions: () => ({ createAndSwitch: mocks.createAndSwitch }),
  useDocumentSession: () => ({ creatingDocument: false, loadingDocumentId: null, documentId: null }),
}));
vi.mock('@/components/ui/toastContext', () => ({
  useToast: () => ({ toast: mocks.toast }),
}));
vi.mock('./PagesTree/PagesTree', () => ({
  PagesTree: () => <section aria-label="Pages" />,
}));
vi.mock('./PagesTree/Recent', () => ({
  Recent: () => <section aria-label="Recent" />,
}));

const { Sidebar } = await import('./Sidebar');

const onOpenPalette = vi.fn();
const onShowShortcuts = vi.fn();
const onOpenTrash = vi.fn();

const PERSONAL = { id: PERSONAL_WORKSPACE_ID, name: 'Personal', kind: 'personal', role: 'owner', icon: null, last_opened_at: null, member_count: 1 } as const;
const LAB = { id: LAB_WORKSPACE_ID, name: 'Lab workspace', kind: 'shared', role: 'editor', icon: '🧪', last_opened_at: null, member_count: 3 } as const;

/** A shared workspace nobody else joined yet, owned by the account. */
const ALONE = { id: OWNED_WORKSPACE_ID, name: 'Side project', kind: 'shared', role: 'owner', icon: null, last_opened_at: null, member_count: 1 } as const;
/** A shared workspace the account is a viewer in (M6). */
const READING = { id: VIEWER_WORKSPACE_ID, name: 'Reading group', kind: 'shared', role: 'viewer', icon: null, last_opened_at: null, member_count: 3 } as const;

/** The account's workspaces, `shown` shown (the personal one by default). */
function workspacesShowing(shown: Workspace = PERSONAL) {
  return function Workspaces({ children }: { children: ReactNode }) {
    const value: WorkspaceContextValue = {
      workspaces: [PERSONAL, LAB, ALONE, READING],
      deleted: [],
      workspace: shown,
      multiWorkspace: true,
      switchWorkspace: mocks.switchWorkspace,
    };
    return <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>;
  };
}

function renderSidebar(shown?: Workspace) {
  return render(
    <TooltipProvider>
      <Sidebar onOpenPalette={onOpenPalette} onShowShortcuts={onShowShortcuts} onOpenTrash={onOpenTrash} />
    </TooltipProvider>,
    { wrapper: workspacesShowing(shown) },
  );
}

const switcher = () => screen.getByRole('button', { name: /^Workspace and account menu/ });

function openAccountMenu() {
  fireEvent.pointerDown(switcher(), {
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
  it('opens with the workspace switcher instead of a global header', () => {
    renderSidebar();

    const trigger = switcher();
    // The workspace shown, by name, and a chevron that says it switches.
    expect(trigger.getAttribute('aria-label')).toBe('Workspace and account menu, Personal');
    expect(trigger.textContent).toContain('Personal');
    expect(trigger.querySelector('svg')).toBeTruthy();
    expect(screen.getByRole('region', { name: 'Pages' })).toBeTruthy();
  });

  it('lists the workspaces as radio items, the shown one checked, and switches on a pick', () => {
    renderSidebar();
    openAccountMenu();

    const personal = screen.getByRole('menuitemradio', { name: /Personal/ });
    const lab = screen.getByRole('menuitemradio', { name: /Lab workspace/ });
    expect(personal.getAttribute('aria-checked')).toBe('true');
    expect(lab.getAttribute('aria-checked')).toBe('false');
    // A shared workspace says so in words, not only by colour.
    expect(lab.textContent).toContain('Shared');
    fireEvent.click(lab);
    expect(mocks.switchWorkspace).toHaveBeenCalledWith(LAB_WORKSPACE_ID);
  });

  it('says "Shared" where someone else is in a workspace, and the account’s role where it is not the owner (M6)', () => {
    renderSidebar();
    openAccountMenu();
    expect(screen.getByRole('menuitemradio', { name: /Lab workspace/ }).textContent).toContain('Shared · Editor');
    expect(screen.getByRole('menuitemradio', { name: /Reading group/ }).textContent).toContain('Shared · Viewer');
    // Shared by kind, but with nobody else in it yet: no badge.
    expect(screen.getByRole('menuitemradio', { name: /Side project/ }).textContent).not.toMatch(/Shared|Owner/);
    expect(screen.getByRole('menuitemradio', { name: /Personal/ }).textContent).not.toContain('Shared');
  });

  it('offers a viewer nothing that creates pages, and Members but no invitations', () => {
    renderSidebar(READING);
    expect(switcher().getAttribute('aria-label')).toBe('Workspace and account menu, Reading group, Shared · Viewer');
    expect(screen.queryByRole('button', { name: /New page/ })).toBeNull();
    openAccountMenu();
    expect(screen.queryByRole('menuitem', { name: 'Invite people…' })).toBeNull();
    fireEvent.click(screen.getByRole('menuitem', { name: 'Members' }));
    expect(takeRequestedSettingsPane()).toBe('members');
  });

  it('offers the owner of a shared workspace Invite people…', async () => {
    renderSidebar(ALONE);
    openAccountMenu();
    fireEvent.click(screen.getByRole('menuitem', { name: 'Invite people…' }));
    expect(await screen.findByRole('dialog', { name: 'Invite people to Side project' })).toBeTruthy();
  });

  it('offers a new workspace, and opens Settings on the Workspace pane', async () => {
    renderSidebar();
    openAccountMenu();
    fireEvent.click(screen.getByRole('menuitem', { name: 'New workspace…' }));
    expect(await screen.findByRole('dialog', { name: 'New workspace' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    openAccountMenu();
    fireEvent.click(screen.getByRole('menuitem', { name: 'Workspace settings' }));
    expect(mocks.setView).toHaveBeenCalledWith('settings');
    expect(takeRequestedSettingsPane()).toBe('workspace');
  });

  it('routes the quick rows to search, the assistant and a new page', async () => {
    renderSidebar();

    fireEvent.click(screen.getByRole('button', { name: /^Search/ }));
    expect(onOpenPalette).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole('button', { name: 'Ask AI' }));
    expect(mocks.panels.setAssistantOpen).toHaveBeenCalledWith(true);

    fireEvent.click(screen.getByRole('button', { name: 'New page' }));
    await waitFor(() =>
      expect(mocks.createAndSwitch).toHaveBeenCalledWith({ name: 'Untitled page', blocks: [] }, { collectionId: null }),
    );
  });

  it('has one create row and no header pencil', () => {
    renderSidebar();
    expect(screen.getAllByRole('button', { name: /new page/i })).toHaveLength(1);
    expect(screen.queryByRole('button', { name: 'Create a new page' })).toBeNull();
  });

  it('keeps the library and settings one click away at the bottom', () => {
    renderSidebar();

    fireEvent.click(screen.getByRole('button', { name: 'Library' }));
    expect(mocks.panels.setTool).toHaveBeenCalledWith('library');

    fireEvent.click(screen.getByRole('button', { name: 'Settings' }));
    expect(mocks.setView).toHaveBeenCalledWith('settings');
  });

  it('opens the Trash from its row, which counts what is in it', async () => {
    renderSidebar();

    // The seeded Trash holds a collection and a page: two roots.
    const row = await screen.findByRole('button', { name: 'Trash, 2 items' });
    fireEvent.click(row);
    expect(onOpenTrash).toHaveBeenCalledTimes(1);
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

  it('holds the version and sign-out in the account menu', () => {
    renderSidebar();
    openAccountMenu();

    expect(screen.getByText('ada@example.com')).toBeTruthy();
    expect(screen.getByText(/v0\.1/)).toBeTruthy();
    fireEvent.click(screen.getByRole('menuitem', { name: 'Sign out' }));
    expect(mocks.logout).toHaveBeenCalledTimes(1);
  });

  it('offers Settings once, as the footer row; the workspace menu holds only Workspace settings', () => {
    renderSidebar();
    expect(screen.getAllByRole('button', { name: /^settings$/i })).toHaveLength(1);

    openAccountMenu();
    expect(screen.getByRole('menuitem', { name: 'Sign out' })).toBeTruthy();
    expect(screen.getAllByRole('menuitem', { name: /settings/i }).map((item) => item.textContent)).toEqual(['Workspace settings']);
  });

  it('shows the New page chord beside its row', () => {
    renderSidebar();

    const row = screen.getByRole('button', { name: 'New page' });
    // Hidden from the name: the row is "New page", the keycaps are a hint.
    expect([...row.querySelectorAll('kbd')].map((key) => key.textContent)).toEqual(['Ctrl', 'Alt', 'N']);
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
