import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ConfirmProvider } from '@/components/ui/confirm-dialog';
import { ToastProvider } from '@/components/ui/toast';
import { TooltipProvider } from '@/components/ui/tooltip';
import { FIXTURE_DOCUMENT_ID, LAB_WORKSPACE_ID, PERSONAL_WORKSPACE_ID } from '@/dev/msw/fixtures';
import { lastPageKey } from '@/lib/storageKeys';

/**
 * Switching workspaces in the whole app, against the mock API's workspaces
 * (11 §5, M5.UI-1): after a switch from the switcher, nothing of the
 * workspace left is shown in the sidebar's tree, in Recent or in the
 * palette; the palette switches back; and the switch is in the history.
 * The page canvas and the right sidebar are left out: what they show comes
 * from the same keyed scope.
 */

vi.mock('@/components/auth/authContextState', () => ({
  useAuth: () => ({
    user: { name: 'Ada Author', email: 'ada@example.org' },
    status: 'authenticated',
    openAuth: vi.fn(),
    closeAuth: vi.fn(),
    logout: vi.fn(),
    endSession: vi.fn(),
    loginWithCredentials: vi.fn(),
  }),
  AuthContext: { Provider: ({ children }: { children: React.ReactNode }) => children },
}));
vi.mock('@/components/layout/AppShell', () => ({
  AppShell: ({ left, main }: { left?: React.ReactNode; main: React.ReactNode }) => (
    <div>
      <aside>{left}</aside>
      <main>{main}</main>
    </div>
  ),
}));
vi.mock('@/components/editor/Canvas', () => ({ Canvas: () => null }));
vi.mock('@/components/editor/DocumentChrome', () => ({ PageTopbar: () => null }));
vi.mock('@/components/editor/FloatingToolbar', () => ({ FloatingToolbar: () => null }));
vi.mock('@/components/editor/SlashMenu', () => ({ SlashMenu: () => null }));
vi.mock('@/components/landing', () => ({ LandingPage: () => null }));

const { default: App } = await import('@/App');

async function renderApp() {
  render(
    <ToastProvider>
      <ConfirmProvider>
        <TooltipProvider>
          <App />
        </TooltipProvider>
      </ConfirmProvider>
    </ToastProvider>,
  );
  await act(() => vi.dynamicImportSettled());
}

const tree = () => screen.getByRole('tree', { name: /Pages/ });
const switcher = () => screen.getByRole('button', { name: /^Workspace and account menu/ });

function openSwitcher() {
  fireEvent.pointerDown(switcher(), { button: 0, ctrlKey: false });
}

beforeEach(() => {
  localStorage.clear();
  window.history.replaceState(null, '', '/');
  localStorage.setItem(lastPageKey(PERSONAL_WORKSPACE_ID), FIXTURE_DOCUMENT_ID);
  // jsdom lays nothing out; the palette scrolls its active row into view.
  Element.prototype.scrollIntoView = vi.fn();
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: /min-width/.test(query),
    media: query,
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(() => false),
  }));
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  localStorage.clear();
  window.history.replaceState(null, '', '/');
});

describe('switching workspaces in the app', () => {
  it('shows nothing of the workspace left in the tree, Recent or the palette, and Back returns', async () => {
    await renderApp();
    await waitFor(() => expect(within(tree()).getByText('Thesis')).toBeTruthy());
    expect(switcher().textContent).toContain('Personal');

    openSwitcher();
    await act(async () => {
      fireEvent.click(screen.getByRole('menuitemradio', { name: /Lab workspace/ }));
    });

    await waitFor(() => expect(switcher().textContent).toContain('Lab workspace'));
    await waitFor(() => expect(within(tree()).getByText('Lab meeting notes')).toBeTruthy());
    expect(new URLSearchParams(window.location.search).get('ws')).toBe(LAB_WORKSPACE_ID);
    // The personal workspace's pages are nowhere in the sidebar.
    const sidebar = screen.getByRole('complementary');
    expect(within(sidebar).queryByText('Thesis')).toBeNull();
    expect(within(sidebar).queryByText('Reading notes')).toBeNull();
    // Recent lists the lab's pages only.
    const recent = within(sidebar).getByRole('region', { name: 'Recent' });
    await waitFor(() => expect(within(recent).getByText('Lab meeting notes')).toBeTruthy());
    expect(within(recent).queryByText(/Sparse Routing/)).toBeNull();

    // The palette searches this workspace only, and offers the way back.
    fireEvent.click(screen.getByRole('button', { name: /^Search/ }));
    const palette = await screen.findByRole('dialog', { name: 'Search' });
    const options = await within(palette).findAllByRole('option');
    const labels = options.map((option) => option.textContent ?? '');
    expect(labels.some((label) => label.includes('Thesis'))).toBe(false);
    const group = within(palette).getByRole('group', { name: 'Switch workspace' });
    expect(within(group).getByRole('option', { name: /Personal/ })).toBeTruthy();
    expect(within(group).queryByRole('option', { name: /Lab workspace/ })).toBeNull();
    fireEvent.keyDown(within(palette).getByRole('combobox'), { key: 'Escape' });

    await act(async () => {
      window.history.back();
      await new Promise<void>((resolve) => window.addEventListener('popstate', () => resolve(), { once: true }));
    });
    await waitFor(() => expect(switcher().textContent).toContain('Personal'));
    await waitFor(() => expect(within(tree()).getByText('Thesis')).toBeTruthy());
    expect(within(screen.getByRole('complementary')).queryByText('Lab meeting notes')).toBeNull();
  });
});
