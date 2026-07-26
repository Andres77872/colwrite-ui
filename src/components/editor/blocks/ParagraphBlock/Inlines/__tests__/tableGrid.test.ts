import { describe, it, expect } from 'vitest';
import {
  insertColumn,
  insertRow,
  mergeAt,
  normalizeGrid,
  parseClipboardTable,
  removeColumn,
  removeRow,
} from '../TableInline/tableGrid';

describe('normalizeGrid', () => {
  it('produces a rectangle whatever the stored shape', () => {
    expect(normalizeGrid([['a']], 2, 3)).toEqual([
      ['a', '', ''],
      ['', '', ''],
    ]);
  });

  it('trims data beyond the declared size', () => {
    expect(normalizeGrid([['a', 'b', 'c']], 1, 2)).toEqual([['a', 'b']]);
  });

  it('survives a corrupt payload rather than crashing the paragraph', () => {
    // Anything can be in `children` — an old document, a bad agent edit.
    expect(normalizeGrid(null, 1, 2)).toEqual([['', '']]);
    expect(normalizeGrid([42, 'nope'], 2, 1)).toEqual([[''], ['']]);
  });

  it('never returns a zero-sized grid', () => {
    expect(normalizeGrid([], 0, 0)).toEqual([['']]);
  });
});

describe('row and column editing', () => {
  const grid = [
    ['a', 'b'],
    ['c', 'd'],
  ];

  it('inserts a row at a position', () => {
    expect(insertRow(grid, 1)).toEqual([
      ['a', 'b'],
      ['', ''],
      ['c', 'd'],
    ]);
  });

  it('appends when the position is past the end', () => {
    expect(insertRow(grid, 99)).toHaveLength(3);
  });

  it('removes a row', () => {
    expect(removeRow(grid, 0)).toEqual([['c', 'd']]);
  });

  it('refuses to remove the last row', () => {
    expect(removeRow([['only']], 0)).toEqual([['only']]);
  });

  it('inserts a column in every row', () => {
    expect(insertColumn(grid, 1)).toEqual([
      ['a', '', 'b'],
      ['c', '', 'd'],
    ]);
  });

  it('removes a column from every row', () => {
    expect(removeColumn(grid, 0)).toEqual([['b'], ['d']]);
  });

  it('refuses to remove the last column', () => {
    expect(removeColumn([['x'], ['y']], 0)).toEqual([['x'], ['y']]);
  });
});

describe('parseClipboardTable', () => {
  it('reads tab-separated spreadsheet cells', () => {
    expect(parseClipboardTable('a\tb\nc\td')).toEqual([
      ['a', 'b'],
      ['c', 'd'],
    ]);
  });

  it('reads CSV', () => {
    expect(parseClipboardTable('a,b\nc,d')).toEqual([
      ['a', 'b'],
      ['c', 'd'],
    ]);
  });

  it('pads ragged rows so the result is rectangular', () => {
    expect(parseClipboardTable('a\tb\tc\nd\te')).toEqual([
      ['a', 'b', 'c'],
      ['d', 'e', ''],
    ]);
  });

  it('leaves ordinary text to the browser', () => {
    // Pasting a sentence into a cell must stay a paste, not become a table.
    expect(parseClipboardTable('just some prose')).toBeNull();
  });

  it('ignores a trailing newline', () => {
    expect(parseClipboardTable('a\tb\n')).toEqual([['a', 'b']]);
  });

  it('handles Windows line endings', () => {
    expect(parseClipboardTable('a\tb\r\nc\td')).toEqual([
      ['a', 'b'],
      ['c', 'd'],
    ]);
  });
});

describe('mergeAt', () => {
  it('drops pasted data in at the target cell', () => {
    const grid = [
      ['1', '2'],
      ['3', '4'],
    ];
    expect(mergeAt(grid, [['x']], 1, 1)).toEqual([
      ['1', '2'],
      ['3', 'x'],
    ]);
  });

  it('grows the table when the paste overflows it', () => {
    const grid = [['1']];
    expect(
      mergeAt(
        grid,
        [
          ['a', 'b'],
          ['c', 'd'],
        ],
        0,
        0,
      ),
    ).toEqual([
      ['a', 'b'],
      ['c', 'd'],
    ]);
  });

  it('keeps cells the paste does not cover', () => {
    const grid = [
      ['keep', 'keep'],
      ['keep', 'keep'],
    ];
    expect(mergeAt(grid, [['new']], 0, 0)[0][1]).toBe('keep');
  });
});
