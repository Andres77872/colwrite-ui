import { describe, expect, it } from 'vitest';
import { TOOLS, isToolId, tabForTool, toolsForEnabledSources } from './toolsConfig';

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

describe('sidebar tabs', () => {
  it('opens every research source on the Research tab', () => {
    for (const id of ['arxiv', 'semantic-scholar', 'colpali', 'library'] as const) {
      expect(tabForTool(id)).toBe('research');
    }
  });

  it('opens the chat list on the Assistant tab and keeps tabs as they are', () => {
    expect(tabForTool('chats')).toBe('assistant');
    expect(tabForTool('sources')).toBe('sources');
    expect(tabForTool('json')).toBe('json');
  });

  it('accepts ids the old tool rail persisted, and nothing else', () => {
    for (const id of ['json', 'arxiv', 'semantic-scholar', 'colpali', 'library', 'chats', 'history', 'sources']) {
      expect(isToolId(id)).toBe(true);
    }
    expect(isToolId(null)).toBe(false);
    expect(isToolId('rail')).toBe(false);
  });
});
