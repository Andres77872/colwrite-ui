import { describe, expect, it } from 'vitest';
import { SIDEBAR_TABS, TOOLS, isToolId, tabForTool, toolsForEnabledSources } from './toolsConfig';

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
    for (const id of ['arxiv', 'semantic-scholar', 'colpali', 'pdfs'] as const) {
      expect(tabForTool(id)).toBe('research');
    }
  });

  it('opens the Library on its own tab, beside Research', () => {
    expect(tabForTool('library')).toBe('library');
    expect(SIDEBAR_TABS).toEqual(['assistant', 'research', 'library', 'sources', 'history']);
  });

  it('opens a research source on Research and keeps tabs as they are', () => {
    expect(tabForTool('arxiv')).toBe('research');
    expect(tabForTool('sources')).toBe('sources');
    expect(tabForTool('json')).toBe('json');
  });

  it('accepts the tab and source ids, and nothing else', () => {
    for (const id of ['json', 'arxiv', 'semantic-scholar', 'colpali', 'pdfs', 'library', 'history', 'sources']) {
      expect(isToolId(id)).toBe(true);
    }
    expect(isToolId('chats')).toBe(false);
    expect(isToolId(null)).toBe(false);
    expect(isToolId('rail')).toBe(false);
  });
});
