import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import { ProposedRewriteView } from './ProposedBlockView';

afterEach(cleanup);

describe('ProposedRewriteView', () => {
  it('marks removed and added words with del and ins elements', () => {
    const { container } = render(
      <ProposedRewriteView before="we show the method" after="We show the method" block={null} />,
    );

    // Bare coloured spans read as one concatenated string ("weWe show") to a
    // screen reader; del/ins are announced as the removal and addition they are.
    const removed = container.querySelector('del');
    const added = container.querySelector('ins');
    expect(removed?.textContent).toBe('we');
    expect(added?.textContent).toBe('We');
    // The diff styling is preserved on the semantic elements.
    expect(removed?.className).toContain('line-through');
    expect(added?.className).toContain('bg-diff-add');
  });

  it('keeps an unchanged rewrite unmarked', () => {
    const { container } = render(
      <ProposedRewriteView before="same wording" after="same wording" block={null} />,
    );

    expect(container.querySelector('del')).toBeNull();
    expect(container.querySelector('ins')).toBeNull();
  });
});
