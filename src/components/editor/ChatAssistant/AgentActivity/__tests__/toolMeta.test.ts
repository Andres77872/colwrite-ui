import { describe, expect, it } from 'vitest';
import { Wand2 } from 'lucide-react';
import { REGISTRY } from '@/dev/msw/assistantCatalog';
import { toolIcon } from '../toolMeta';

describe('the catalog’s icon keys', () => {
  it('draws every key the API’s registry uses, the plan’s and the question’s included', () => {
    const keys = [...new Set(REGISTRY.tools.map((tool) => tool.icon))];
    expect(keys).toEqual(expect.arrayContaining(['list-ordered', 'message-question']));
    for (const key of keys) expect(toolIcon(key), key).not.toBe(Wand2);
  });

  it('draws a key it does not know as a generic tool', () => {
    expect(toolIcon('telescope')).toBe(Wand2);
    expect(toolIcon(undefined)).toBe(Wand2);
  });
});
