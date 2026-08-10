import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';

vi.mock('@/components/auth/authContextState', () => ({
  useAuth: () => ({ user: { name: 'Ada Lovelace', email: 'ada@example.com' }, logout: vi.fn() }),
}));
vi.mock('@/components/panels/panelsContextState', () => ({
  usePanels: () => ({ isDesktop: true, setMobileNavOpen: vi.fn(), isOpen: true, toggle: vi.fn() }),
}));
vi.mock('@/components/layout/viewContextState', () => ({
  useView: () => ({ view: 'workspace', setView: vi.fn() }),
}));

const { Topbar } = await import('./Topbar');

afterEach(cleanup);

describe('Topbar', () => {
  it('has a visible route to the keyboard shortcuts reference', () => {
    const onOpenShortcuts = vi.fn();
    render(<Topbar onOpenShortcuts={onOpenShortcuts} />);

    // Mod+/ only works for people who already know the chord.
    fireEvent.click(screen.getByRole('button', { name: 'Keyboard shortcuts' }));
    expect(onOpenShortcuts).toHaveBeenCalledTimes(1);
  });
});
