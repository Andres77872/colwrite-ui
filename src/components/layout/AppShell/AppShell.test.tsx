import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';

const panelState = {
  leftWidth: 400,
  setLeftWidth: vi.fn(),
  rightWidth: 640,
  setRightWidth: vi.fn(),
  leftCollapsed: false,
  isOpen: true,
  close: vi.fn(),
  isDesktop: true,
  mobileNavOpen: false,
  setMobileNavOpen: vi.fn(),
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
    renderShell();

    const sheet = screen.getByRole('dialog', { name: 'Tools' });
    expect(sheet.className).toContain('w-full');
    expect(screen.getByText('Right sidebar content')).toBeTruthy();
    expect(screen.queryByRole('complementary', { name: 'Tools' })).toBeNull();
  });
});
