import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useEffect } from 'react';
import { ToastProvider } from '../toast';
import { useToast, type ToastOptions } from '../toastContext';

function Raise({ options }: { options: ToastOptions }) {
  const { toast } = useToast();
  useEffect(() => {
    toast(options);
    // Raised once, as a confirmation is.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return null;
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('toast actions', () => {
  it('runs the action once and closes the toast', () => {
    const onSelect = vi.fn();
    render(
      <ToastProvider>
        <Raise options={{ title: 'Now on version 2', variant: 'success', action: { label: 'Undo', onSelect } }} />
      </ToastProvider>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Undo' }));

    expect(onSelect).toHaveBeenCalledOnce();
    expect(screen.queryByText('Now on version 2')).toBeNull();
  });

  it('stays long enough to reach the action, and waits while the pointer is on it', () => {
    render(
      <ToastProvider>
        <Raise options={{ title: 'Reset to defaults', action: { label: 'Undo', onSelect: () => {} } }} />
      </ToastProvider>,
    );

    // A plain confirmation would be gone after 4 s.
    act(() => vi.advanceTimersByTime(6000));
    expect(screen.getByText('Reset to defaults')).toBeTruthy();

    const card = screen.getByRole('status');
    fireEvent.mouseEnter(card);
    act(() => vi.advanceTimersByTime(30_000));
    expect(screen.getByText('Reset to defaults')).toBeTruthy();

    fireEvent.mouseLeave(card);
    act(() => vi.advanceTimersByTime(10_000));
    expect(screen.queryByText('Reset to defaults')).toBeNull();
  });

  it('leaves a toast without an action as it was', () => {
    render(
      <ToastProvider>
        <Raise options={{ title: 'HTML exported', variant: 'success' }} />
      </ToastProvider>,
    );

    expect(screen.queryByRole('button', { name: 'Undo' })).toBeNull();
    act(() => vi.advanceTimersByTime(4000));
    expect(screen.queryByText('HTML exported')).toBeNull();
  });
});
