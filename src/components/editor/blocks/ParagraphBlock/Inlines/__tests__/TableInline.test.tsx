import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { TableChild } from '@/editor/types';
import { TableInline } from '../TableInline';

const TABLE: TableChild = {
  id: 't1',
  type: 'table',
  rows: 2,
  cols: 2,
  header: true,
  data: [
    ['Model', 'Params'],
    ['Dense', '1.3B'],
  ],
};

function renderTable() {
  return render(
    <TableInline
      blockId="b1"
      child={TABLE}
      updateParagraphChild={vi.fn()}
      removeParagraphChild={vi.fn()}
      updateHtml={vi.fn()}
      refs={{ current: {} }}
    />,
  );
}

const cellMenus = () => screen.queryAllByRole('button', { name: /options$/ });

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('TableInline cell options', () => {
  it('gives every cell its options button', () => {
    renderTable();

    expect(cellMenus().map((button) => button.getAttribute('aria-label'))).toEqual([
      'Column 1 heading options',
      'Column 2 heading options',
      'Row 2, column 1 options',
      'Row 2, column 2 options',
    ]);
  });

  it('mounts them when the table comes near the screen: the cells are there from the start', () => {
    let comeNear!: (el: Element) => void;
    const observed: Element[] = [];
    vi.stubGlobal('IntersectionObserver', class {
      constructor(callback: IntersectionObserverCallback) {
        comeNear = (el) => callback([{ target: el, isIntersecting: true } as IntersectionObserverEntry], this as unknown as IntersectionObserver);
      }
      observe(el: Element) { observed.push(el); }
      unobserve() {}
      disconnect() {}
    });
    renderTable();

    expect(screen.getAllByRole('textbox').map((cell) => (cell as HTMLTextAreaElement).value)).toEqual(['Model', 'Params', 'Dense', '1.3B']);
    expect(cellMenus()).toEqual([]);
    // The table itself is what is watched, not each of its cells.
    expect(observed).toHaveLength(1);
    expect(observed[0]?.querySelector('table')).toBeTruthy();

    act(() => comeNear(observed[0] as Element));

    expect(cellMenus()).toHaveLength(4);
  });
});
