import { describe, expect, it } from 'vitest';
import { TOOLS, toolsForEnabledSources } from './toolsConfig';

describe('workspace research-tool availability', () => {
  it('keeps Semantic Scholar hidden until its source is enabled', () => {
    const visible = toolsForEnabledSources((source) => source === 'arxiv');

    expect(visible.map((tool) => tool.id)).toContain('arxiv');
    expect(visible.map((tool) => tool.id)).toContain('colpali');
    expect(visible.map((tool) => tool.id)).not.toContain('semantic-scholar');
  });

  it('shows the complete registry when both paper sources are enabled', () => {
    const visible = toolsForEnabledSources(() => true);

    expect(visible.map((tool) => tool.id)).toEqual(TOOLS.map((tool) => tool.id));
  });
});
