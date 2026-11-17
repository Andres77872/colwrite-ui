import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, renderHook } from '@testing-library/react';

const panels = {
  isOpen: true,
  isDesktop: true,
  panelsDocked: true,
  leftWidth: 280,
  rightWidth: 420,
  leftCollapsed: false,
};
const media = { sidebarDocked: true };

vi.mock('@/components/panels/panelsContextState', () => ({
  usePanels: () => panels,
}));
vi.mock('@/hooks/useMediaQuery', () => ({
  useMediaQuery: () => media.sidebarDocked,
}));

const { useLeftSidebarAutoHidden, setLeftSidebarOverride } = await import('../useShellLayout');

function width(value: number) {
  Object.defineProperty(window, 'innerWidth', { configurable: true, value });
}

beforeEach(() => {
  Object.assign(panels, { isOpen: true, isDesktop: true, panelsDocked: true, leftCollapsed: false });
  media.sidebarDocked = true;
  setLeftSidebarOverride(false);
});
afterEach(() => cleanup());

describe('useLeftSidebarAutoHidden', () => {
  it('keeps both sidebars on a window wide enough for a readable page', () => {
    width(1440);
    expect(renderHook(() => useLeftSidebarAutoHidden()).result.current).toBe(false);
  });

  it('steps the left sidebar aside on a narrow desktop while the right one is open', () => {
    width(1100);
    expect(renderHook(() => useLeftSidebarAutoHidden()).result.current).toBe(true);

    panels.isOpen = false;
    expect(renderHook(() => useLeftSidebarAutoHidden()).result.current).toBe(false);
  });

  it('always steps aside for the right sidebar docked on a tablet', () => {
    // 900–1023px: the left sidebar docks, and so does the right one, at a
    // fixed share of the window. The two never leave a readable page.
    width(1000);
    Object.assign(panels, { isDesktop: false, panelsDocked: true });
    expect(renderHook(() => useLeftSidebarAutoHidden()).result.current).toBe(true);
  });

  it('leaves the left sidebar alone when the author asked for it back', () => {
    width(1000);
    Object.assign(panels, { isDesktop: false, panelsDocked: true });
    setLeftSidebarOverride(true);
    expect(renderHook(() => useLeftSidebarAutoHidden()).result.current).toBe(false);
  });

  it('has nothing to hide where the left sidebar is a drawer', () => {
    width(800);
    media.sidebarDocked = false;
    Object.assign(panels, { isDesktop: false, panelsDocked: true });
    expect(renderHook(() => useLeftSidebarAutoHidden()).result.current).toBe(false);
  });
});
