import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TooltipProvider } from '@/components/ui/tooltip';

const state = vi.hoisted(() => ({
  semanticScholar: false,
  activeTool: 'semantic-scholar' as string | null,
  panelMounted: vi.fn(),
}));

vi.mock('@/components/preferences', () => ({
  useAgentTools: () => ({
    isSourceEnabled: (sourceId: string) =>
      sourceId === 'arxiv' || state.semanticScholar,
  }),
}));

vi.mock('./panelsContextState', () => ({
  usePanels: () => ({
    activeTool: state.activeTool,
    setTool: vi.fn(),
    isOpen: true,
    toggle: vi.fn(),
    close: vi.fn(),
    isDesktop: true,
  }),
}));

vi.mock('./SemanticScholarPanel', () => ({
  SemanticScholarPanel: () => {
    state.panelMounted();
    return <div>Mounted Semantic Scholar panel</div>;
  },
}));

const { ToolsRail } = await import('./toolsRail/ToolsRail');
const { ToolsAside } = await import('./toolsAside/ToolsAside');

beforeEach(() => {
  state.semanticScholar = false;
  state.activeTool = 'semantic-scholar';
  state.panelMounted.mockReset();
});

afterEach(cleanup);

describe('workspace paper-source enforcement', () => {
  it('does not expose Semantic Scholar in the rail before opt-in', () => {
    render(
      <TooltipProvider>
        <ToolsRail />
      </TooltipProvider>,
    );

    expect(screen.queryByRole('button', { name: 'Semantic Scholar' })).toBeNull();
    expect(screen.getByRole('button', { name: 'arXiv Search' })).toBeTruthy();
  });

  it('does not mount a persisted Semantic Scholar panel while disabled', () => {
    render(<ToolsAside />);

    expect(screen.getByText('Semantic Scholar is disabled')).toBeTruthy();
    expect(state.panelMounted).not.toHaveBeenCalled();
  });
});
