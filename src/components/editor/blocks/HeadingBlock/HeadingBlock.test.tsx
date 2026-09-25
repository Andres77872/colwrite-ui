import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';

// The contenteditable drags in the whole editor; the heading semantics live on
// the wrapper this component renders, so a passthrough stand-in keeps the test
// about them and nothing else.
vi.mock('@/components/common/Editable', () => ({
  Editable: ({
    id,
    html,
    ariaLabel,
    locked,
  }: {
    id: string;
    html: string;
    ariaLabel: string;
    locked?: boolean;
  }) => (
    <div
      data-testid={`editable-${id}`}
      role="textbox"
      aria-label={ariaLabel}
      aria-multiline="true"
      aria-readonly={locked || undefined}
    >
      {html}
    </div>
  ),
}));

const { HeadingBlock } = await import('./HeadingBlock');

afterEach(cleanup);

describe('HeadingBlock', () => {
  it('exposes heading semantics at the block level', () => {
    render(<HeadingBlock block={{ id: 'h1', type: 'heading', level: 2, html: 'Results' }} />);

    // A bare contenteditable div has no outline entry — the role is what puts
    // this block into a screen reader's heading navigation.
    // One level below the block's own: the page title is the only level 1.
    const heading = screen.getByRole('heading', { level: 3, name: 'Results' });
    expect(heading.textContent).toContain('Results');
    expect(screen.getByRole('textbox', { name: 'Heading level 2' })).toBeTruthy();
  });

  it('nests every block level under the page title', () => {
    render(
      <>
        <HeadingBlock block={{ id: 'h1', type: 'heading', level: 1, html: 'One' }} />
        <HeadingBlock block={{ id: 'h3', type: 'heading', level: 3, html: 'Three' }} />
      </>,
    );

    expect(screen.queryByRole('heading', { level: 1 })).toBeNull();
    expect(screen.getByRole('heading', { level: 2, name: 'One' })).toBeTruthy();
    expect(screen.getByRole('heading', { level: 4, name: 'Three' })).toBeTruthy();
  });

  it('passes the locked state to the named heading editor', () => {
    render(
      <HeadingBlock
        block={{ id: 'h1', type: 'heading', level: 1, html: 'Locked', locked: true }}
      />,
    );

    const textbox = screen.getByRole('textbox', { name: 'Heading level 1' });
    expect(textbox.getAttribute('aria-readonly')).toBe('true');
  });
});
