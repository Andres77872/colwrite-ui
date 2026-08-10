/**
 * The table's editing model, as pure functions.
 *
 * Separate from the component because this is the part worth testing on its
 * own — and because a stored grid can be any shape at all: an old document, a
 * hand-written agent edit, a half-applied patch. Every function here takes
 * whatever it is given and returns something rectangular.
 */

/** A rectangular grid, whatever shape the stored data happens to be. */
export function normalizeGrid(data: unknown, rows: number, cols: number): string[][] {
  const source = Array.isArray(data) ? (data as unknown[]) : [];
  const height = Math.max(1, Math.floor(rows) || 1);
  const width = Math.max(1, Math.floor(cols) || 1);

  return Array.from({ length: height }, (_, r) => {
    const row = Array.isArray(source[r]) ? (source[r] as unknown[]) : [];
    return Array.from({ length: width }, (_, c) =>
      typeof row[c] === 'string' ? (row[c] as string) : '',
    );
  });
}

export function insertRow(grid: string[][], at: number): string[][] {
  const width = grid[0]?.length ?? 1;
  const out = grid.map((row) => row.slice());
  out.splice(clamp(at, 0, out.length), 0, new Array(width).fill(''));
  return out;
}

export function removeRow(grid: string[][], at: number): string[][] {
  if (grid.length <= 1) return grid;
  return grid.filter((_, index) => index !== at);
}

export function insertColumn(grid: string[][], at: number): string[][] {
  return grid.map((row) => {
    const out = row.slice();
    out.splice(clamp(at, 0, out.length), 0, '');
    return out;
  });
}

export function removeColumn(grid: string[][], at: number): string[][] {
  if ((grid[0]?.length ?? 0) <= 1) return grid;
  return grid.map((row) => row.filter((_, index) => index !== at));
}

/**
 * Parse clipboard text as a table.
 *
 * Pasting a block of spreadsheet cells into one cell used to drop the whole
 * selection in as a single string with tabs in it — and pasting from a
 * spreadsheet is the most common way anyone gets real data into a table.
 *
 * Ordinary prose returns null so the browser's own paste still happens.
 */
export function parseClipboardTable(text: string): string[][] | null {
  const rows = text.replace(/\r\n?/g, '\n').replace(/\n$/, '').split('\n');
  if (rows.length === 0) return null;

  const delimiter = rows[0].includes('\t') ? '\t' : rows.every((r) => r.includes(',')) ? ',' : null;
  if (!delimiter) return null;

  const grid = rows.map((row) => row.split(delimiter));
  const width = Math.max(...grid.map((row) => row.length));
  // A comma earns its split only from real table shape — several columns on
  // several rows. "In this work, we show that" has a comma on the line too,
  // and treating prose as CSV shreds the sentence across the neighbouring
  // cells. Tabs almost never appear in prose, so tab text keeps the looser
  // rule.
  const isTable = delimiter === ',' ? width >= 2 && grid.length >= 2 : width >= 2 || grid.length >= 2;
  if (!isTable) return null;

  return grid.map((row) => {
    const out = row.slice();
    while (out.length < width) out.push('');
    return out;
  });
}

/** Merge a pasted grid into `grid` with its top-left corner at (row, col). */
export function mergeAt(
  grid: string[][],
  pasted: string[][],
  row: number,
  col: number,
): string[][] {
  const height = Math.max(grid.length, row + pasted.length);
  const width = Math.max(grid[0]?.length ?? 0, col + Math.max(...pasted.map((r) => r.length)));
  const out = normalizeGrid(grid, height, width);

  pasted.forEach((pastedRow, r) => {
    pastedRow.forEach((value, c) => {
      out[row + r][col + c] = value;
    });
  });
  return out;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(value, max));
}
