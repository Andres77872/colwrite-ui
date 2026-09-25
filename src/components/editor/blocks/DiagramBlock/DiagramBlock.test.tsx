import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useState, type ReactNode } from 'react';
import {
  EditorActionsContext,
  EditorActiveBlockContext,
  type EditorActionsContextValue,
} from '@/editor/editorContextState';
import type { CodeBlock } from '@/editor/types';

const mermaid = vi.hoisted(() => ({
  initialize: vi.fn(),
  parse: vi.fn(),
  render: vi.fn(),
}));

vi.mock('mermaid', () => ({ default: mermaid }));

const { DiagramBlock } = await import('./DiagramBlock');
const { DIAGRAM_TEMPLATES } = await import('./diagramTemplates');
const { resetMermaidForTests } = await import('@/lib/mermaid');

const actions = {
  addBlockAfter: vi.fn(() => 'next'),
  getBlockIds: vi.fn(() => ['d1']),
  refs: { current: {} as Record<string, HTMLDivElement | null> },
  registerEditable: vi.fn((id: string, element: HTMLDivElement | null) => {
    actions.refs.current[id] = element;
  }),
  removeBlock: vi.fn(),
  selectBlocks: vi.fn(),
  updateCodeText: vi.fn(),
};

function Editor({ children }: { children: ReactNode }) {
  return (
    <EditorActionsContext.Provider value={actions as unknown as EditorActionsContextValue}>
      <EditorActiveBlockContext.Provider value={{ activeId: null, setActive: vi.fn() }}>
        {children}
      </EditorActiveBlockContext.Provider>
    </EditorActionsContext.Provider>
  );
}

function diagram(text: string, extra: Partial<CodeBlock> = {}): CodeBlock {
  return { id: 'd1', type: 'code', text, language: 'mermaid', ...extra };
}

/** A diagram whose edits come back as its text, as they do in the editor. */
function Live({ initial }: { initial: string }) {
  const [text, setText] = useState(initial);
  actions.updateCodeText.mockImplementation((_id: string, next: string) => setText(next));
  return <DiagramBlock block={diagram(text)} />;
}

function source(): HTMLElement | null {
  return screen.queryByRole('textbox', { name: 'Diagram source, Mermaid' });
}

/** Type into the source the way a browser does: the text changes, then `input` fires. */
async function typeSource(text: string) {
  const field = source()!;
  field.textContent = text;
  await act(async () => {
    fireEvent.input(field);
  });
}

beforeEach(() => {
  resetMermaidForTests();
  vi.useRealTimers();
  Object.values(actions).forEach((value) => {
    if (typeof value === 'function' && 'mockClear' in value) value.mockClear();
  });
  actions.updateCodeText.mockImplementation(() => undefined);
  actions.refs.current = {};
  mermaid.initialize.mockReset();
  mermaid.parse.mockReset().mockResolvedValue({ diagramType: 'flowchart-v2' });
  mermaid.render.mockReset().mockImplementation(async (id: string) => ({
    svg: `<svg id="${id}" data-testid="drawn"></svg>`,
    diagramType: 'flowchart-v2',
  }));
});

afterEach(cleanup);

describe('DiagramBlock', () => {
  it('opens a new, empty diagram at its source with templates to start from', () => {
    render(<DiagramBlock block={diagram('')} />, { wrapper: Editor });

    expect(screen.getByRole('textbox', { name: 'Diagram source, Mermaid' })).toBeTruthy();
    // No Done while there is nothing to show instead of the source.
    expect(screen.queryByRole('button', { name: 'Done' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Flowchart' }));
    expect(actions.updateCodeText).toHaveBeenCalledWith('d1', DIAGRAM_TEMPLATES[0].source);
    expect(mermaid.render).not.toHaveBeenCalled();
  });

  it('keeps a new diagram’s source open while the author types into it', async () => {
    render(<Live initial="" />, { wrapper: Editor });
    const field = source()!;
    fireEvent.focus(field);
    for (const text of ['f', 'flowchart LR', 'flowchart LR\n  A --> B']) {
      await typeSource(text);
      expect(source()).toBe(field);
    }
    // Leaving puts the drawing back.
    fireEvent.blur(field, { relatedTarget: null });
    expect(source()).toBeNull();
    expect(await screen.findByRole('img', { name: 'Diagram' })).toBeTruthy();
  });

  it('shows a diagram with source as its drawing, and opens the source to edit', async () => {
    render(<DiagramBlock block={diagram('flowchart LR\n  A --> B')} />, { wrapper: Editor });

    expect(await screen.findByRole('img', { name: 'Diagram' })).toBeTruthy();
    expect(screen.queryByRole('textbox')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    expect(screen.getByRole('textbox', { name: 'Diagram source, Mermaid' }).textContent).toBe('flowchart LR\n  A --> B');
    // The live preview sits under the source.
    expect(await screen.findByRole('img', { name: 'Diagram preview' })).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Done' }));
    expect(screen.queryByRole('textbox')).toBeNull();
    expect(screen.getByRole('img', { name: 'Diagram' })).toBeTruthy();
  });

  it('closes the source on Escape and hands the block to block selection', async () => {
    render(<DiagramBlock block={diagram('flowchart LR\n  A --> B')} />, { wrapper: Editor });
    await screen.findByRole('img', { name: 'Diagram' });
    fireEvent.doubleClick(screen.getByRole('img', { name: 'Diagram' }));

    fireEvent.keyDown(screen.getByRole('textbox', { name: 'Diagram source, Mermaid' }), { key: 'Escape' });

    expect(actions.selectBlocks).toHaveBeenCalledWith(['d1']);
    expect(screen.queryByRole('textbox')).toBeNull();
  });

  it('waits for a pause in typing before redrawing the preview', async () => {
    const { rerender } = render(<DiagramBlock block={diagram('flowchart LR\n  A --> B')} />, { wrapper: Editor });
    await screen.findByRole('img', { name: 'Diagram' });
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    await screen.findByRole('img', { name: 'Diagram preview' });
    mermaid.render.mockClear();

    vi.useFakeTimers();
    rerender(<DiagramBlock block={diagram('flowchart LR\n  A --> C')} />);
    rerender(<DiagramBlock block={diagram('flowchart LR\n  A --> CD')} />);
    expect(mermaid.render).not.toHaveBeenCalled();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(350);
    });
    vi.useRealTimers();

    expect(mermaid.render).toHaveBeenCalledTimes(1);
    expect(mermaid.render).toHaveBeenCalledWith(expect.any(String), 'flowchart LR\n  A --> CD');
  });

  it('never opens a locked diagram for editing', async () => {
    render(<DiagramBlock block={diagram('flowchart LR\n  A --> B', { locked: true })} />, { wrapper: Editor });

    const drawing = await screen.findByRole('img', { name: 'Diagram' });
    expect(screen.queryByRole('button', { name: 'Edit' })).toBeNull();
    fireEvent.doubleClick(drawing);
    expect(screen.queryByRole('textbox')).toBeNull();
  });

  it('keeps the last good drawing up while the source has an error', async () => {
    const { rerender } = render(<DiagramBlock block={diagram('flowchart LR\n  A --> B')} />, { wrapper: Editor });
    await screen.findByRole('img', { name: 'Diagram' });
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    await screen.findByRole('img', { name: 'Diagram preview' });

    mermaid.parse.mockRejectedValueOnce(new Error('Parse error on line 2:\nA -->\n-----^'));
    rerender(<DiagramBlock block={diagram('flowchart LR\n  A -->')} />);

    expect(await screen.findByText('Error — showing the last version that drew')).toBeTruthy();
    expect(screen.getByRole('img', { name: 'Diagram preview' })).toBeTruthy();
    expect(screen.getByText(/Parse error on line 2/)).toBeTruthy();
  });
});
