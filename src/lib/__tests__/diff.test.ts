import { describe, it, expect } from 'vitest';
import { diffWords, hasChanges, type DiffSegment } from '../diff';

/** Rebuild each side from the segments — the diff must lose nothing. */
function sides(segments: DiffSegment[]): { before: string; after: string } {
  return {
    before: segments.filter((s) => s.type !== 'insert').map((s) => s.value).join(''),
    after: segments.filter((s) => s.type !== 'delete').map((s) => s.value).join(''),
  };
}

describe('diffWords', () => {
  it('reports identical text as one untouched run', () => {
    expect(diffWords('same text', 'same text')).toEqual([{ type: 'equal', value: 'same text' }]);
  });

  it('returns nothing for two empty strings', () => {
    expect(diffWords('', '')).toEqual([]);
  });

  it('marks a replaced word and leaves the rest alone', () => {
    const segments = diffWords('the quick fox', 'the slow fox');

    expect(segments.some((s) => s.type === 'delete' && s.value.includes('quick'))).toBe(true);
    expect(segments.some((s) => s.type === 'insert' && s.value.includes('slow'))).toBe(true);
    expect(sides(segments)).toEqual({ before: 'the quick fox', after: 'the slow fox' });
  });

  it('is lossless for an insertion', () => {
    const segments = diffWords('a c', 'a b c');
    expect(sides(segments)).toEqual({ before: 'a c', after: 'a b c' });
  });

  it('is lossless for a deletion', () => {
    const segments = diffWords('a b c', 'a c');
    expect(sides(segments)).toEqual({ before: 'a b c', after: 'a c' });
  });

  it('handles one side being empty', () => {
    expect(diffWords('', 'new text')).toEqual([{ type: 'insert', value: 'new text' }]);
    expect(diffWords('old text', '')).toEqual([{ type: 'delete', value: 'old text' }]);
  });

  it('merges consecutive changes into one segment', () => {
    // One span per change keeps the rendered diff readable; per-word spans
    // turn a rewritten sentence into a barcode.
    const segments = diffWords('one two three four', 'one nine ten four');
    const inserts = segments.filter((s) => s.type === 'insert');

    expect(inserts).toHaveLength(1);
    expect(inserts[0].value.trim()).toBe('nine ten');
  });

  it('preserves whitespace exactly', () => {
    const segments = diffWords('a\n\nb', 'a\n\nc');
    expect(sides(segments).before).toBe('a\n\nb');
  });

  it('falls back to whole-block replacement past the token cap', () => {
    // The quadratic table would be 25M cells for a rewritten section; a
    // coarser diff is better than a locked tab.
    const long = 'word '.repeat(2000);
    const segments = diffWords(long, `${long}extra`);

    expect(segments.map((s) => s.type)).toEqual(['delete', 'insert']);
  });

  it('detects whether anything changed', () => {
    expect(hasChanges(diffWords('a', 'a'))).toBe(false);
    expect(hasChanges(diffWords('a', 'b'))).toBe(true);
  });
});
