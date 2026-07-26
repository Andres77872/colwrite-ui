/**
 * Word-level diff, used to show what an agent edit actually changes.
 *
 * Reviewing a rewritten paragraph as two opaque blobs of prose is the same
 * amount of reading as writing it again — the author has to spot the
 * difference themselves. Highlighting the words that moved is what makes an
 * accept/reject decision take a second instead of a minute.
 */

export type DiffSegment = {
  type: 'equal' | 'insert' | 'delete';
  value: string;
};

/**
 * Split into words while keeping the whitespace, so rebuilt text is
 * character-identical to the input and the diff can be rendered inline.
 */
function tokenize(text: string): string[] {
  return text.match(/\s+|[^\s]+/g) ?? [];
}

/**
 * Longest common subsequence table over token arrays.
 *
 * Capped because this runs on every render of a pending change: an agent that
 * rewrites a 5,000-word section would otherwise allocate a 25M-cell table and
 * lock the tab. Past the cap the caller falls back to a whole-block
 * before/after view, which is still correct, just less precise.
 */
const MAX_TOKENS = 1500;

export function diffWords(before: string, after: string): DiffSegment[] {
  if (before === after) {
    return before ? [{ type: 'equal', value: before }] : [];
  }

  const a = tokenize(before);
  const b = tokenize(after);

  if (a.length > MAX_TOKENS || b.length > MAX_TOKENS) {
    const out: DiffSegment[] = [];
    if (before) out.push({ type: 'delete', value: before });
    if (after) out.push({ type: 'insert', value: after });
    return out;
  }

  // Trim the shared prefix and suffix first. Agent edits are usually local, so
  // this removes most of the input before the quadratic part runs at all.
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;

  let endA = a.length;
  let endB = b.length;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
    endA--;
    endB--;
  }

  const midA = a.slice(start, endA);
  const midB = b.slice(start, endB);

  const rows = midA.length;
  const cols = midB.length;
  const table: number[][] = Array.from({ length: rows + 1 }, () => new Array<number>(cols + 1).fill(0));

  for (let i = rows - 1; i >= 0; i--) {
    for (let j = cols - 1; j >= 0; j--) {
      table[i][j] =
        midA[i] === midB[j] ? table[i + 1][j + 1] + 1 : Math.max(table[i + 1][j], table[i][j + 1]);
    }
  }

  const segments: DiffSegment[] = [];
  const push = (type: DiffSegment['type'], value: string) => {
    if (!value) return;
    const last = segments[segments.length - 1];
    // Merge runs so the renderer emits one span per change, not one per word.
    if (last && last.type === type) last.value += value;
    else segments.push({ type, value });
  };

  push('equal', a.slice(0, start).join(''));

  let i = 0;
  let j = 0;
  while (i < rows && j < cols) {
    if (midA[i] === midB[j]) {
      push('equal', midA[i]);
      i++;
      j++;
    } else if (table[i + 1][j] >= table[i][j + 1]) {
      push('delete', midA[i]);
      i++;
    } else {
      push('insert', midB[j]);
      j++;
    }
  }
  while (i < rows) push('delete', midA[i++]);
  while (j < cols) push('insert', midB[j++]);

  push('equal', a.slice(endA).join(''));

  return coalesce(segments);
}

/**
 * Collapse each stretch of edits into one deletion followed by one insertion.
 *
 * Words and the spaces between them are separate tokens, so rewriting
 * "two three" as "nine ten" matches the space in the middle and produces
 * delete/insert/space/delete/insert. Rendered literally that is four
 * highlights with a gap, reading as several unrelated edits rather than one
 * rewritten phrase.
 *
 * The whitespace bridging a run belongs to both sides — it was unchanged — so
 * it is written into both accumulators and the reconstruction stays exact.
 */
function coalesce(segments: DiffSegment[]): DiffSegment[] {
  const out: DiffSegment[] = [];
  const push = (type: DiffSegment['type'], value: string) => {
    if (!value) return;
    const last = out[out.length - 1];
    if (last && last.type === type) last.value += value;
    else out.push({ type, value });
  };

  let index = 0;
  while (index < segments.length) {
    const segment = segments[index];

    if (segment.type === 'equal' && !isBridge(segments, index)) {
      push('equal', segment.value);
      index++;
      continue;
    }

    let deleted = '';
    let inserted = '';
    while (index < segments.length) {
      const current = segments[index];
      if (current.type === 'delete') deleted += current.value;
      else if (current.type === 'insert') inserted += current.value;
      else if (isBridge(segments, index)) {
        deleted += current.value;
        inserted += current.value;
      } else break;
      index++;
    }

    push('delete', deleted);
    push('insert', inserted);
  }

  return out;
}

/** An unchanged run of pure whitespace with edits on both sides. */
function isBridge(segments: DiffSegment[], index: number): boolean {
  const segment = segments[index];
  if (segment.type !== 'equal' || segment.value.trim() !== '') return false;
  const before = segments[index - 1];
  const after = segments[index + 1];
  return !!before && !!after && before.type !== 'equal' && after.type !== 'equal';
}

/** Whether a diff contains anything other than untouched text. */
export function hasChanges(segments: DiffSegment[]): boolean {
  return segments.some((segment) => segment.type !== 'equal');
}
