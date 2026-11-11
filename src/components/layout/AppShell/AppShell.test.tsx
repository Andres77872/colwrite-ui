import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { setInputModalityForTesting } from '@/lib/inputModality';

const panelState = {
  leftWidth: 400,
  setLeftWidth: vi.fn(),
  rightWidth: 640,
  setRightWidth: vi.fn(),
  leftCollapsed: false,
  isOpen: true,
  close: vi.fn(),
  isDesktop: true,
  toolsDocked: true,
  mobileNavOpen: false,
  setMobileNavOpen: vi.fn(),
  activeTool: 'sources' as const,
};
const layout = { sidebarDocked: true, leftAutoHidden: false };

vi.mock('@/components/panels/panelsContextState', () => ({
  usePanels: () => panelState,
}));
vi.mock('../useShellLayout', () => ({
  useSidebarDocked: () => layout.sidebarDocked,
  useLeftSidebarAutoHidden: () => layout.leftAutoHidden,
  setLeftSidebarOverride: () => {},
}));

const { AppShell } = await import('./AppShell');

function renderShell() {
  return render(
    <AppShell
      left={<div>Documents</div>}
      main={<div>Document canvas</div>}
      aside={<div>Right sidebar content</div>}
    />,
  );
}

beforeEach(() => {
  panelState.isDesktop = true;
  panelState.toolsDocked = true;
  panelState.isOpen = true;
  panelState.leftCollapsed = false;
  panelState.mobileNavOpen = false;
  layout.sidebarDocked = true;
});

afterEach(cleanup);

describe('AppShell', () => {
  it('lays the three regions edge to edge, separated by hairlines rather than cards', () => {
    const { container } = renderShell();

    const frame = container.firstElementChild as HTMLElement;
    expect(frame.className).not.toMatch(/\bp-2\b|\bgap-2\b/);

    const sidebar = screen.getByRole('navigation', { name: 'Workspace navigation' });
    const main = screen.getByRole('main');
    const aside = screen.getByRole('complementary', { name: 'Tools' });
    for (const region of [sidebar, main, aside]) {
      expect(region.className).not.toContain('rounded');
    }
    expect(sidebar.className).toContain('bg-sidebar');
    expect(sidebar.style.minWidth).toBe('240px');
    expect(aside.className).toContain('border-l');
    expect(aside.style.minWidth).toBe('340px');
    expect(main.className).toContain('min-w-0');
  });

  it('keeps both regions resizable from their hairlines', () => {
    renderShell();

    expect(screen.getByRole('separator', { name: 'Resize sidebar' })).toBeTruthy();
    expect(screen.getByRole('separator', { name: 'Resize right sidebar' })).toBeTruthy();
  });

  it('collapses the sidebar to nothing, leaving only an inert peek panel', () => {
    panelState.leftCollapsed = true;
    renderShell();

    // The only copy is the off-screen peek panel, which assistive tech skips.
    const peek = screen.getByRole('navigation', { name: 'Workspace navigation', hidden: true });
    expect(peek.hasAttribute('inert')).toBe(true);
    expect(peek.className).toContain('fixed');
    expect(screen.queryByRole('separator', { name: 'Resize sidebar' })).toBeNull();
  });

  it('peeks the collapsed sidebar from the edge and closes it however the pointer leaves', () => {
    vi.useFakeTimers();
    try {
      panelState.leftCollapsed = true;
      renderShell();
      const peek = screen.getByRole('navigation', { name: 'Workspace navigation', hidden: true });
      const edge = screen.getByTestId('sidebar-peek-edge');
      // Level with the panel, below the topbar row and its » button.
      expect(edge.className).toContain('top-12');

      // Brushing past the edge does not open it; resting on it does.
      fireEvent.mouseEnter(edge);
      fireEvent.mouseLeave(edge, { relatedTarget: document.body });
      act(() => void vi.advanceTimersByTime(300));
      expect(peek.hasAttribute('inert')).toBe(true);

      fireEvent.mouseEnter(edge);
      act(() => void vi.advanceTimersByTime(300));
      expect(peek.hasAttribute('inert')).toBe(false);

      // Leaving the edge for the topbar, without ever entering the panel,
      // still closes it.
      fireEvent.mouseLeave(edge, { relatedTarget: document.body });
      act(() => void vi.advanceTimersByTime(400));
      expect(peek.hasAttribute('inert')).toBe(true);

      // Escape closes it too.
      fireEvent.mouseEnter(edge);
      act(() => void vi.advanceTimersByTime(300));
      expect(peek.hasAttribute('inert')).toBe(false);
      fireEvent.keyDown(document, { key: 'Escape' });
      expect(peek.hasAttribute('inert')).toBe(true);

      // And so does a press on the page.
      fireEvent.mouseEnter(edge);
      act(() => void vi.advanceTimersByTime(300));
      fireEvent.pointerDown(screen.getByText('Document canvas'));
      expect(peek.hasAttribute('inert')).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it('steps the sidebar aside for a docked right sidebar when both would squeeze the page', () => {
    layout.leftAutoHidden = true;
    renderShell();

    // Docked, not a modal sheet: the page stays editable beside it.
    expect(screen.getByRole('complementary', { name: 'Tools' })).toBeTruthy();
    expect(screen.queryByRole('dialog')).toBeNull();
    // The sidebar is only the edge peek until the right sidebar closes.
    const peek = screen.getByRole('navigation', { name: 'Workspace navigation', hidden: true });
    expect(peek.hasAttribute('inert')).toBe(true);
    layout.leftAutoHidden = false;
  });

  it('starts the tab order with a way past the chrome to the page', () => {
    renderShell();

    const skip = screen.getByRole('link', { name: 'Skip to page' });
    expect(skip.className).toContain('sr-only');
    expect(skip.className).toContain('focus:not-sr-only');
  });

  it('docks nothing beside the page when the right sidebar is closed', () => {
    panelState.isOpen = false;
    renderShell();

    expect(screen.queryByRole('complementary', { name: 'Tools' })).toBeNull();
    expect(screen.queryByText('Right sidebar content')).toBeNull();
  });

  it('moves the sidebar into a drawer on narrow windows', () => {
    layout.sidebarDocked = false;
    panelState.mobileNavOpen = true;
    renderShell();

    expect(screen.getByRole('dialog', { name: 'Workspace navigation' })).toBeTruthy();
    expect(screen.getByText('Documents')).toBeTruthy();
  });

  it('opens the right sidebar as a full-screen sheet below the docked width', () => {
    panelState.isDesktop = false;
    panelState.toolsDocked = false;
    renderShell();

    const sheet = screen.getByRole('dialog', { name: 'Tools' });
    expect(sheet.className).toContain('w-full');
    expect(screen.getByText('Right sidebar content')).toBeTruthy();
    expect(screen.queryByRole('complementary', { name: 'Tools' })).toBeNull();
  });

  it('takes focus into the phone sheet, which Escape closes', async () => {
    panelState.isDesktop = false;
    panelState.toolsDocked = false;
    panelState.isOpen = false;
    const { rerender } = render(
      <AppShell main={<button type="button">Open Sources</button>} aside={<button type="button">Inside</button>} />,
    );
    const opener = screen.getByRole('button', { name: 'Open Sources' });
    opener.focus();

    panelState.isOpen = true;
    rerender(<AppShell main={<button type="button">Open Sources</button>} aside={<button type="button">Inside</button>} />);
    const sheet = await screen.findByRole('dialog', { name: 'Tools' });
    await waitFor(() => expect(sheet.contains(document.activeElement)).toBe(true));

    fireEvent.keyDown(document.activeElement as HTMLElement, { key: 'Escape' });
    expect(panelState.close).toHaveBeenCalled();
  });
});

/**
 * 768–1023px: a tablet in portrait. Research, Sources and History used to
 * open as a modal sheet over the page there.
 */
describe('AppShell on a tablet', () => {
  function installTabletWidth() {
    vi.stubGlobal('matchMedia', (query: string) => ({
      matches: query === '(min-width: 768px)',
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
    }));
  }

  /** Whether a list (a reference picker, say) is open inside the panel. */
  const listOpen = { value: false };

  function shell() {
    return (
      <AppShell
        left={<div>Documents</div>}
        // The topbar button that opened Sources.
        main={<button type="button" aria-label="Sources">Sources button</button>}
        aside={
          <div role="tabpanel" data-state="active" aria-label="Sources">
            <input aria-label="Filter sources" />
            {listOpen.value && <div role="listbox" aria-label="Open list" />}
          </div>
        }
      />
    );
  }

  beforeEach(() => {
    installTabletWidth();
    panelState.isDesktop = false;
    panelState.toolsDocked = true;
    panelState.isOpen = true;
    listOpen.value = false;
    layout.sidebarDocked = false;
    vi.mocked(panelState.close).mockClear();
    setInputModalityForTesting('keyboard');
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    layout.sidebarDocked = true;
  });

  it('docks the panel beside the page, narrower and without a modal layer', () => {
    render(shell());

    const aside = screen.getByRole('complementary', { name: 'Tools' });
    expect(aside.getAttribute('data-dock')).toBe('tablet');
    // The page is still there and usable: no dialog, no backdrop, no trap.
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.getByRole('main').getAttribute('aria-hidden')).toBeNull();
    // A fixed share of the window, not the desktop's resizable width.
    expect(screen.queryByRole('separator', { name: 'Resize right sidebar' })).toBeNull();
    expect(aside.style.getPropertyValue('--tools-dock-width')).toBe(
      'clamp(18rem, calc((100% - 0px) * 0.4), 24rem)',
    );
  });

  it('sizes the dock from what a docked left sidebar leaves', () => {
    layout.sidebarDocked = true;
    render(shell());

    expect(
      screen.getByRole('complementary', { name: 'Tools' }).style.getPropertyValue('--tools-dock-width'),
    ).toBe('clamp(18rem, calc((100% - 400px) * 0.4), 24rem)');
  });

  it('closes on an Escape nothing inside the panel used', () => {
    render(shell());
    const field = screen.getByRole('textbox', { name: 'Filter sources' });

    fireEvent.keyDown(field, { key: 'Escape' });
    expect(panelState.close).toHaveBeenCalledTimes(1);
  });

  it('leaves Escape to whatever inside the panel claimed it', () => {
    render(shell());
    const field = screen.getByRole('textbox', { name: 'Filter sources' });

    // A run being stopped, a rename being cancelled: the handler prevents it.
    field.addEventListener('keydown', (event) => event.preventDefault(), { once: true });
    fireEvent.keyDown(field, { key: 'Escape' });
    // A field whose list is open.
    field.setAttribute('aria-expanded', 'true');
    fireEvent.keyDown(field, { key: 'Escape' });
    field.removeAttribute('aria-expanded');

    expect(panelState.close).not.toHaveBeenCalled();
  });

  it('leaves Escape to an open list or menu inside the panel', () => {
    listOpen.value = true;
    render(shell());

    fireEvent.keyDown(screen.getByRole('textbox', { name: 'Filter sources' }), { key: 'Escape' });
    expect(panelState.close).not.toHaveBeenCalled();
  });

  it('takes keyboard focus into the panel when it opens from the topbar', async () => {
    panelState.isOpen = false;
    const { rerender } = render(shell());
    const opener = screen.getByRole('button', { name: 'Sources' });
    opener.focus();

    panelState.isOpen = true;
    rerender(shell());

    const field = screen.getByRole('textbox', { name: 'Filter sources' });
    await waitFor(() => expect(document.activeElement).toBe(field));
  });

  it('leaves the caret in the page when the panel opens with the pointer', async () => {
    setInputModalityForTesting('pointer');
    panelState.isOpen = false;
    const { rerender } = render(shell());
    const opener = screen.getByRole('button', { name: 'Sources' });
    opener.focus();

    panelState.isOpen = true;
    rerender(shell());
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));

    expect(document.activeElement).toBe(opener);
  });

  it('gives focus back to where it came from when it closes holding focus', async () => {
    const { rerender } = render(shell());
    const opener = screen.getByRole('button', { name: 'Sources' });
    act(() => opener.focus());
    act(() => screen.getByRole('textbox', { name: 'Filter sources' }).focus());

    // The close button or Escape: the column unmounts with focus inside,
    // which would leave it on <body>.
    panelState.isOpen = false;
    rerender(shell());
    expect(screen.queryByRole('complementary', { name: 'Tools' })).toBeNull();

    await waitFor(() => expect(document.activeElement).toBe(opener));
  });
});
