import { describe, expect, it } from 'vitest';
import type { RevisionSummary } from '@/services/documentHistory';
import { distinctSummary, kindLabel, revisionTime } from './revisionLabels';

const revision = (kind: string, summary: string | null = null) =>
  ({ kind, summary }) as unknown as RevisionSummary;

describe('revision labels', () => {
  it('names every known kind for people, and sentence-cases unknown ones', () => {
    expect(kindLabel({ kind: 'save' })).toBe('Saved');
    expect(kindLabel({ kind: 'change_set_accept' })).toBe('Accepted suggestions');
    expect(kindLabel({ kind: 'create' })).toBe('Created');
    expect(kindLabel({ kind: 'restore' })).toBe('Restored');
    expect(kindLabel({ kind: 'import' })).toBe('Imported');
    expect(kindLabel({ kind: 'bulk_TITLE_fix' })).toBe('Bulk title fix');
  });

  it('drops a summary that only repeats the kind', () => {
    expect(distinctSummary(revision('create', 'Created'))).toBeNull();
    expect(distinctSummary(revision('save', 'saved.'))).toBeNull();
    expect(distinctSummary(revision('save', 'Edited Method'))).toBe('Edited Method');
  });

  it('writes short, relative-day timestamps without seconds', () => {
    const now = new Date(2026, 8, 20, 18, 0);
    expect(revisionTime(new Date(2026, 8, 20, 8, 32).toISOString(), now)).toMatch(/^Today, 8:32\s?AM$/);
    expect(revisionTime(new Date(2026, 8, 19, 3, 12).toISOString(), now)).toMatch(/^Yesterday, 3:12\s?AM$/);
    expect(revisionTime(new Date(2026, 8, 12, 15, 5).toISOString(), now)).toMatch(/^Sep 12, 3:05\s?PM$/);
    expect(revisionTime(new Date(2025, 0, 2, 9, 0).toISOString(), now)).toContain('2025');
    expect(revisionTime('not a date', now)).toBe('');
  });
});
