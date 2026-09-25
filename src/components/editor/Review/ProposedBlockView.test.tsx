import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import type { Block } from '@/editor/types';
import { ProposedRewriteView, STRIKE_WIDGETS } from './ProposedBlockView';

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

  it('diffs inline widgets as the page draws them, never as a ▦ glyph', () => {
    const before: Block = {
      id: 'p1',
      type: 'paragraph',
      html: 'The router assigns token <span data-child-id="eq1"></span> to an expert.',
      children: [{ id: 'eq1', type: 'equation', latex: 'x_t' }],
    };
    // A rewrite comes back with fresh ids for the same equation: it must
    // still read as unchanged, not as one equation removed and another added.
    const after: Block = {
      id: 'p1',
      type: 'paragraph',
      html: 'A learned router assigns token <span data-child-id="eq9"></span> to one expert.',
      children: [{ id: 'eq9', type: 'equation', latex: 'x_t' }],
    };
    const { container } = render(<ProposedRewriteView before={before} after={after} block={after} />);

    expect(container.textContent).not.toContain('▦');
    expect(container.textContent).not.toContain('\uE000');
    const equations = container.querySelectorAll('[aria-label="Equation: x_t"]');
    expect(equations).toHaveLength(1);
    expect(equations[0].closest('del, ins')).toBeNull();
  });

  it('keeps a removed word and its replacement apart', () => {
    const { container } = render(
      <ProposedRewriteView before="we show that" after="we demonstrate that" block={null} />,
    );
    const removed = container.querySelector('del');
    const added = container.querySelector('ins');
    expect(removed?.textContent).toBe('show');
    expect(added?.textContent).toBe('demonstrate');
    // Not "showdemonstrate": a thin space sits between the two runs.
    expect(removed?.nextSibling?.textContent).toBe('\u2009');
  });

  it('strikes a removed equation like the words around it, at full strength', () => {
    const before: Block = {
      id: 'p1',
      type: 'paragraph',
      html: 'Pick <span data-child-id="eq1"></span> now.',
      children: [{ id: 'eq1', type: 'equation', latex: 'i = \\arg\\max_j g_j(x_t)' }],
    };
    const after: Block = { id: 'p1', type: 'paragraph', html: 'Pick now.', children: [] };
    const { container } = render(<ProposedRewriteView before={before} after={after} block={after} />);

    const removed = container.querySelector('del');
    const equation = removed?.querySelector('.diff-widget');
    expect(equation).toBeTruthy();
    // Faded maths read as kept and failed contrast; it is struck instead.
    expect(removed?.className).not.toContain('opacity');
    for (const rule of STRIKE_WIDGETS.split(' ')) expect(removed?.className).toContain(rule);
  });
});
