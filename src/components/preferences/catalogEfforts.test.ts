import { describe, expect, it } from 'vitest';
import { PERSONAL_WORKSPACE_ID, catalogOf } from '@/dev/msw/fixtures';
import { NO_CATALOG, catalogValue } from './assistantCatalogContextState';

/** The catalog's effort tiers and each surface's (P3.API-1): decoded now, offered by the composer in P3. */
describe('the catalog’s effort tiers', () => {
  const value = catalogValue(catalogOf(PERSONAL_WORKSPACE_ID), false, null);

  it('lists each tier with what a run of it may spend', () => {
    expect(value.efforts.map((effort) => [effort.id, effort.label, effort.budget.model_calls, effort.budget.cost_limit, effort.needs_plan])).toEqual([
      ['quick', 'Quick', 12, 1, false],
      ['standard', 'Standard', 40, 5, false],
      ['deep', 'Deep', 120, 20, true],
    ]);
  });

  it('says which tiers each surface may name, and the one it runs at by default', () => {
    expect(value.profileEfforts('chat')).toMatchObject({ defaultEffort: 'standard' });
    expect(value.profileEfforts('chat')?.efforts.map((effort) => effort.id)).toEqual(['quick', 'standard', 'deep']);
    expect(value.profileEfforts('inline')?.efforts.map((effort) => effort.id)).toEqual(['quick']);
    expect(value.profileEfforts('inline')?.defaultEffort).toBe('quick');
  });

  it('offers none before the catalog is read', () => {
    expect(NO_CATALOG.efforts).toEqual([]);
    expect(NO_CATALOG.profileEfforts('chat')).toBeUndefined();
  });
});
