import { describe, expect, it } from 'vitest';
import { SIDEBAR_TABS, PANELS, availablePanels, isResearchSource, isSidebarTab, tabForPanel } from './sidebarPanels';

describe('workspace research-tool availability', () => {
  it('keeps paper search hidden where it is off', () => {
    const visible = availablePanels(false);

    expect(visible.map((tool) => tool.id)).toContain('research');
    expect(visible.map((tool) => tool.id)).not.toContain('papers');
  });

  it('shows the complete registry where paper search is on', () => {
    expect(availablePanels(true).map((tool) => tool.id)).toEqual(PANELS.map((tool) => tool.id));
  });

  it('calls no outside search service: no arXiv, Semantic Scholar or paper-page panel of its own is listed', () => {
    for (const id of ['arxiv', 'colpali', 'semantic-scholar']) expect(PANELS.map((tool) => tool.id)).not.toContain(id);
  });
});

describe('sidebar tabs', () => {
  it('opens every research source on the Research tab', () => {
    for (const id of ['papers', 'pdfs'] as const) {
      expect(tabForPanel(id)).toBe('research');
    }
  });

  it('opens the Library on its own tab, beside Research', () => {
    expect(tabForPanel('library')).toBe('library');
    expect(SIDEBAR_TABS).toEqual(['assistant', 'research', 'review', 'library', 'sources', 'history']);
  });

  it('opens a research source on Research and keeps tabs as they are', () => {
    expect(tabForPanel('papers')).toBe('research');
    expect(tabForPanel('sources')).toBe('sources');
    expect(tabForPanel('json')).toBe('json');
  });

  it('accepts the tab and source ids, and nothing else', () => {
    for (const id of ['json', 'review', 'library', 'history', 'sources']) expect(isSidebarTab(id)).toBe(true);
    for (const id of ['papers', 'pdfs']) expect(isResearchSource(id)).toBe(true);
    for (const id of ['chats', null, 'rail', 'arxiv', 'colpali', 'semantic-scholar']) {
      expect(isSidebarTab(id) || isResearchSource(id)).toBe(false);
    }
  });
});
