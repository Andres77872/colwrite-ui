import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { EmptyState } from '../empty-state';
import { InlineError } from '../inline-error';
import { ListSkeleton } from '../list-skeleton';

afterEach(cleanup);

describe('shared loading, error and empty states', () => {
  it('draws placeholder rows that assistive tech skips', () => {
    const { container } = render(<ListSkeleton rows={3} dense />);
    const list = container.querySelector('ul');
    expect(list?.getAttribute('aria-hidden')).toBe('true');
    expect(list?.querySelectorAll('li')).toHaveLength(3);
  });

  it('says what failed, why, and retries', () => {
    const onRetry = vi.fn();
    render(<InlineError title="Could not load pages" detail="The server could not be reached." onRetry={onRetry} />);
    const alert = screen.getByRole('alert');
    expect(alert.textContent).toContain('Could not load pages');
    expect(alert.textContent).toContain('The server could not be reached.');
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('shows an empty list as one quiet line in a narrow list', () => {
    const { container } = render(<EmptyState size="inline" title="No pages yet" />);
    expect(container.textContent).toBe('No pages yet');
  });
});
