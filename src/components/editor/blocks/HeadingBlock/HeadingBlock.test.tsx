import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';

// The contenteditable drags in the whole editor; the heading semantics live on
// the wrapper this component renders, so a passthrough stand-in keeps the test
// about them and nothing else.
vi.mock('@/components/common/Editable', () => ({
  Editable: ({ id, html }: { id: string; html: string }) => (
    <div data-testid={`editable-${id}`}>{html}</div>
  ),
}));

const { HeadingBlock } = await import('./HeadingBlock');

afterEach(cleanup);

describe('HeadingBlock', () => {
  it('exposes heading semantics at the block level', () => {
    render(<HeadingBlock block={{ id: 'h1', type: 'heading', level: 2, html: 'Results' }} />);

    // A bare contenteditable div has no outline entry — the role is what puts
    // this block into a screen reader's heading navigation.
    const heading = screen.getByRole('heading', { level: 2 });
    expect(heading.textContent).toContain('Results');
  });

  it('maps every block level to aria-level', () => {
    render(
      <>
        <HeadingBlock block={{ id: 'h1', type: 'heading', level: 1, html: 'One' }} />
        <HeadingBlock block={{ id: 'h3', type: 'heading', level: 3, html: 'Three' }} />
      </>,
    );

    expect(screen.getByRole('heading', { level: 1 })).toBeTruthy();
    expect(screen.getByRole('heading', { level: 3 })).toBeTruthy();
  });
});
