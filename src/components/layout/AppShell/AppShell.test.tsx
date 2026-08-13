import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';

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

vi.mock('@/components/panels/panelsContextState', () => ({
  usePanels: () => panelState,
}));

const { AppShell } = await import('./AppShell');

beforeEach(() => {
  panelState.isDesktop = true;
  panelState.isOpen = true;
});

afterEach(cleanup);

describe('AppShell', () => {
  it('protects the editor measure while docked panels shrink to their minima', () => {
    render(
      <AppShell
        left={<div>Documents</div>}
        main={<div>Document canvas</div>}
        aside={<div>Research tools</div>}
        right={<div>Tools rail</div>}
      />,
    );

    const main = screen.getByRole('main');
    const workspace = screen.getByRole('navigation', { name: 'Workspace navigation' });
    const tools = screen.getByRole('complementary', { name: 'Tools' });

    expect(main.className).toContain('min-w-[32rem]');
    expect(workspace.style.minWidth).toBe('200px');
    expect(tools.style.minWidth).toBe('280px');
  });

  it('gives the full row to the canvas when a tablet uses drawer mode', () => {
    panelState.isDesktop = false;
    panelState.isOpen = false;

    render(
      <AppShell
        left={<div>Documents</div>}
        main={<div>Document canvas</div>}
        aside={<div>Research tools</div>}
        right={<div>Tools rail</div>}
      />,
    );

    const main = screen.getByRole('main');
    expect(main.className).toContain('min-w-0');
    expect(main.className).not.toContain('min-w-[32rem]');
    expect(screen.queryByRole('navigation', { name: 'Workspace navigation' })).toBeNull();
    expect(screen.queryByRole('complementary', { name: 'Tools' })).toBeNull();
  });

  it('keeps the tool chooser reachable inside the drawer', () => {
    panelState.isDesktop = false;
    panelState.isOpen = true;

    render(
      <AppShell
        main={<div>Document canvas</div>}
        aside={<div>Research tools</div>}
        right={<div>Tool buttons</div>}
      />,
    );

    expect(screen.getByRole('dialog', { name: 'Tools' })).toBeTruthy();
    expect(screen.getByRole('navigation', { name: 'Tool chooser' })).toBeTruthy();
    expect(screen.getByText('Tool buttons')).toBeTruthy();
    expect(screen.getByText('Research tools')).toBeTruthy();
  });
});
