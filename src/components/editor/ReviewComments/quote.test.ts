import { describe, expect, it } from 'vitest';
import { commentIsOutdated, exactQuoteRange } from './quote';
import type { ReviewComment } from '@/data/reviews';
import type { Block } from '@/editor/types';

const comment = { block_id: 'p', quote: 'An exact claim.', outdated: false } as ReviewComment;
describe('exact comment anchors', () => {
  it('survives unrelated words and formatting but never reanchors a changed sentence', () => {
    const blocks: Block[] = [{ id: 'p', type: 'paragraph', html: 'New beginning. <strong>An exact claim.</strong> Changed ending.', children: [] }];
    expect(commentIsOutdated(comment, blocks)).toBe(false);
    expect(commentIsOutdated(comment, [{ ...blocks[0], html: 'A similar claim.' } as Block])).toBe(true);
    expect(commentIsOutdated(comment, [])).toBe(true);
    expect(commentIsOutdated({ ...comment, outdated: true }, blocks)).toBe(true);
  });
  it('selects the exact quote across formatted text without changing editable markup', () => {
    const host = document.createElement('div');
    host.innerHTML = 'Before. <strong>An   exact</strong> claim. After.';
    const original = host.innerHTML;
    const range = exactQuoteRange(host, comment.quote);
    expect(range?.toString()).toBe('An   exact claim.');
    expect(exactQuoteRange(host, 'A similar claim.')).toBeNull();
    expect(host.innerHTML).toBe(original);
  });
});
