import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import type { Block } from '@/editor/types';

const mermaid = vi.hoisted(() => ({
  initialize: vi.fn(),
  parse: vi.fn(),
  render: vi.fn(),
}));

vi.mock('mermaid', () => ({ default: mermaid }));

const { ProposedBlockView, ProposedRewriteView } = await import('./ProposedBlockView');
const { resetMermaidForTests } = await import('@/lib/mermaid');

const before: Block = { id: 'd', type: 'code', language: 'mermaid', text: 'flowchart LR\n  A --> B' };
const after: Block = { id: 'd', type: 'code', language: 'mermaid', text: 'flowchart LR\n  A --> C' };

beforeEach(() => {
  resetMermaidForTests();
  mermaid.initialize.mockReset();
  mermaid.parse.mockReset().mockResolvedValue({ diagramType: 'flowchart-v2' });
  mermaid.render.mockReset().mockImplementation(async (id: string, source: string) => ({
    svg: `<svg id="${id}"><text>${source.split('\n').at(-1)?.trim()}</text></svg>`,
    diagramType: 'flowchart-v2',
  }));
});

afterEach(cleanup);

describe('proposed diagrams', () => {
  it('draws a proposed diagram instead of showing its source', async () => {
    const { container } = render(<ProposedBlockView block={after} />);
    const drawing = await screen.findByRole('img', { name: 'Proposed diagram' });
    expect(drawing.textContent).toBe('A --> C');
    expect(container.querySelector('pre')).toBeNull();
  });

  it('shows a rewritten diagram as a source diff with the new drawing under it', async () => {
    const { container } = render(<ProposedRewriteView before={before} after={after} block={after} />);
    expect(container.querySelector('del')?.textContent).toBe('B');
    expect(container.querySelector('ins')?.textContent).toBe('C');
    expect((await screen.findByRole('img', { name: 'Proposed diagram' })).textContent).toBe('A --> C');
  });

  it('keeps a plain code block as code', () => {
    const { container } = render(
      <ProposedBlockView block={{ id: 'c', type: 'code', language: 'python', text: 'print(1)' }} />,
    );
    expect(container.querySelector('pre')?.textContent).toBe('print(1)');
    expect(mermaid.render).not.toHaveBeenCalled();
  });
});
