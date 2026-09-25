import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useState, type ReactNode } from 'react';
import {
  EditorActionsContext,
  EditorActiveBlockContext,
  type EditorActionsContextValue,
} from '@/editor/editorContextState';
import type { CodeBlock } from '@/editor/types';
import { ASK_AI_EVENT, type AskAiRequest } from '../../AskAi/askAiEvents';
import { FIGURE_TEMPLATES } from '@/lib/figure/templates';
import { resetFigureCacheForTests } from '@/lib/figure/compile';
import { FigureBlock } from './FigureBlock';

const actions = {
  addBlockAfter: vi.fn(() => 'next'),
  getBlockIds: vi.fn(() => ['f1']),
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

function figure(text: string, extra: Partial<CodeBlock> = {}): CodeBlock {
  return { id: 'f1', type: 'code', text, language: 'figure', ...extra };
}

const SPEC = JSON.stringify(
  {
    caption: 'Two steps.',
    direction: 'right',
    nodes: [
      { id: 'a', label: 'Encoder', role: 'model' },
      { id: 'b', label: 'Decoder', role: 'model' },
    ],
    edges: ['a -> b'],
  },
  null,
  2,
);

/** A figure whose edits come back as its text, as they do in the editor. */
function Live({ initial }: { initial: string }) {
  const [text, setText] = useState(initial);
  actions.updateCodeText.mockImplementation((_id: string, next: string) => setText(next));
  return <FigureBlock block={figure(text)} />;
}

function source(): HTMLElement | null {
  return screen.queryByRole('textbox', { name: 'Figure source, JSON' });
}

/** Type into the source the way a browser does: the text changes, then `input` fires. */
async function typeSource(text: string) {
  const field = source()!;
  field.textContent = text;
  await act(async () => {
    fireEvent.input(field);
  });
}

/** Where a click on `element` puts focus in a browser: its nearest focusable ancestor. */
function clickFocusTarget(element: Element): Element | null {
  return element.closest('button, input, select, textarea, [tabindex]');
}

/** The last source the block wrote. */
function lastWritten(): { nodes: Array<Record<string, unknown>> } {
  const [, next] = actions.updateCodeText.mock.calls.at(-1) as [string, string];
  return JSON.parse(next) as { nodes: Array<Record<string, unknown>> };
}

async function openSource() {
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
  });
}

async function selectItem(id: string) {
  const item = document.querySelector(`[data-figure-id="${id}"]`);
  expect(item).toBeTruthy();
  await act(async () => {
    fireEvent.click(item!);
  });
}

/** Lets the live preview's 250 ms pause pass. */
async function settle() {
  await act(() => new Promise((resolve) => setTimeout(resolve, 300)));
}

beforeEach(() => {
  resetFigureCacheForTests();
  Object.values(actions).forEach((value) => {
    if (typeof value === 'function' && 'mockClear' in value) value.mockClear();
  });
  actions.updateCodeText.mockImplementation(() => undefined);
  actions.refs.current = {};
});

afterEach(cleanup);

describe('FigureBlock', () => {
  it('opens a new, empty figure at its source, with templates and the assistant to start from', () => {
    render(<FigureBlock block={figure('')} />, { wrapper: Editor });

    expect(screen.getByRole('textbox', { name: 'Figure source, JSON' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Done' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: FIGURE_TEMPLATES[0].label }));
    expect(actions.updateCodeText).toHaveBeenCalledWith('f1', FIGURE_TEMPLATES[0].source);
  });

  it('asks the assistant to draw a starter figure (a caption with nothing drawn yet)', () => {
    const requests: AskAiRequest[] = [];
    const listener = (event: Event) => requests.push((event as CustomEvent<AskAiRequest>).detail);
    window.addEventListener(ASK_AI_EVENT, listener);
    try {
      render(<FigureBlock block={figure('{"caption": "The MLA mechanism", "nodes": []}')} />, { wrapper: Editor });
      fireEvent.click(screen.getByRole('button', { name: /Describe it to the assistant/ }));
      expect(requests).toEqual([{ blockId: 'f1' }]);
    } finally {
      window.removeEventListener(ASK_AI_EVENT, listener);
    }
  });

  it('shows a figure as its drawing with a numbered caption, and opens the source to edit', async () => {
    render(<FigureBlock block={figure(SPEC)} number={2} />, { wrapper: Editor });

    expect(screen.queryByRole('textbox', { name: 'Figure source, JSON' })).toBeNull();
    expect(document.querySelector('svg')).toBeTruthy();
    expect(screen.getByText(/Figure 2\./)).toBeTruthy();
    expect(screen.getByText('Two steps.')).toBeTruthy();

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    });
    expect(screen.getByRole('textbox', { name: 'Figure source, JSON' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Done' })).toBeTruthy();
  });

  it('reports a spec that does not parse instead of drawing nothing', () => {
    render(<FigureBlock block={figure('{"nodes": [ "a", ')} />, { wrapper: Editor });
    expect(screen.getByRole('alert').textContent).toMatch(/This figure has an error/);
  });

  it('never opens the source of a locked figure', () => {
    render(<FigureBlock block={figure(SPEC, { locked: true })} />, { wrapper: Editor });
    expect(screen.queryByRole('button', { name: 'Edit' })).toBeNull();
    fireEvent.doubleClick(document.querySelector('.figure-block')!);
    expect(screen.queryByRole('textbox', { name: 'Figure source, JSON' })).toBeNull();
  });

  it('shows a locked starter as the caption it is meant to have', () => {
    render(<FigureBlock block={figure('{"caption": "The MLA mechanism", "nodes": []}', { locked: true })} />, {
      wrapper: Editor,
    });
    expect(screen.getByText('The MLA mechanism')).toBeTruthy();
    expect(screen.queryByText('Figure not drawn yet')).toBeNull();
  });

  it('edits the clicked node through the source text', async () => {
    render(<FigureBlock block={figure(SPEC)} />, { wrapper: Editor });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    });
    const node = document.querySelector('[data-figure-id="a"]');
    expect(node).toBeTruthy();
    await act(async () => {
      fireEvent.click(node!);
    });
    fireEvent.click(screen.getByRole('button', { name: 'Tone orange' }));
    const [id, next] = actions.updateCodeText.mock.calls.at(-1) as [string, string];
    expect(id).toBe('f1');
    const edited = JSON.parse(next) as { nodes: Array<Record<string, unknown>> };
    expect(edited.nodes[0]).toMatchObject({ id: 'a', tone: 'orange' });
    expect(edited.nodes[1]).not.toHaveProperty('tone');
  });

  it('keeps a new figure’s source open while the author types into it', async () => {
    render(<Live initial="" />, { wrapper: Editor });
    const field = source()!;
    fireEvent.focus(field);
    // None of these is a starter any more, and none of them draws yet.
    for (const text of ['{', '{"nodes": [', '{"nodes": ["a']) {
      await typeSource(text);
      expect(source()).toBe(field);
    }
  });

  it('keeps a starter’s source open while the author types into it', async () => {
    render(<Live initial={'{"caption": "x", "nodes": []}'} />, { wrapper: Editor });
    const field = source()!;
    fireEvent.focus(field);
    await typeSource('{"caption": "x", "nodes": [');
    expect(source()).toBe(field);
    await typeSource('{"caption": "x", "nodes": ["a"]}');
    expect(source()).toBe(field);
    // Leaving puts the figure back.
    fireEvent.blur(field, { relatedTarget: null });
    expect(source()).toBeNull();
  });

  it('stays open when a click lands on the editor’s own chrome, and closes when focus leaves it', async () => {
    render(<FigureBlock block={figure(SPEC)} />, { wrapper: Editor });
    await openSource();
    const field = source()!;
    const header = screen.getByText('Figure', { exact: true });
    fireEvent.blur(field, { relatedTarget: clickFocusTarget(header) });
    expect(source()).toBe(field);
    fireEvent.blur(field, { relatedTarget: null });
    expect(source()).toBeNull();
  });

  it('keeps focus in the block when the item editor is closed, so leaving still closes the source', async () => {
    render(
      <>
        <FigureBlock block={figure(SPEC)} />
        <input aria-label="Elsewhere" />
      </>,
      { wrapper: Editor },
    );
    await openSource();
    await selectItem('a');
    const close = screen.getByRole('button', { name: 'Close item editor' });
    close.focus();
    await act(async () => {
      fireEvent.click(close);
    });
    expect(screen.queryByRole('button', { name: 'Close item editor' })).toBeNull();
    const block = document.querySelector('.figure-block')!;
    expect(block.contains(document.activeElement)).toBe(true);
    fireEvent.blur(document.activeElement!, { relatedTarget: screen.getByRole('textbox', { name: 'Elsewhere' }) });
    expect(source()).toBeNull();
  });

  it('opens the source on a double-click on the drawing', () => {
    render(<FigureBlock block={figure(SPEC)} />, { wrapper: Editor });
    fireEvent.doubleClick(document.querySelector('.figure-block svg')!);
    expect(source()).toBeTruthy();
  });

  it('ignores a double-click on a hover action or inside the enlarged view', async () => {
    render(<FigureBlock block={figure(SPEC)} />, { wrapper: Editor });
    fireEvent.doubleClick(screen.getByRole('button', { name: 'Download figure as SVG' }));
    expect(source()).toBeNull();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Open figure larger' }));
    });
    const dialog = screen.getByRole('dialog');
    fireEvent.doubleClick(dialog.querySelector('svg')!);
    expect(screen.getByRole('dialog')).toBe(dialog);
    expect(source()).toBeNull();
  });

  it('treats a starter as a placeholder to fill, not as a broken figure', async () => {
    render(<FigureBlock block={figure('{"caption": "The MLA mechanism", "nodes": []}')} />, { wrapper: Editor });
    await settle();
    expect(source()).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Done' })).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.queryByText(/\d+ error/)).toBeNull();
    expect(screen.queryByRole('list', { name: 'Figure problems' })).toBeNull();
    expect(screen.getByRole('button', { name: /Describe it to the assistant/ })).toBeTruthy();
    // Its JSON is readable, so Format can tidy it.
    expect((screen.getByRole('button', { name: 'Format' }) as HTMLButtonElement).disabled).toBe(false);
  });

  it('says Format keeps comments, as it does', async () => {
    render(<FigureBlock block={figure(SPEC)} />, { wrapper: Editor });
    await openSource();
    expect(screen.getByRole('button', { name: 'Format' }).title).toMatch(/comments are kept/);
  });
});

describe('FigureInspector', () => {
  it('refreshes the label field when the source changes, and writes nothing back on a plain blur', async () => {
    const { rerender } = render(<FigureBlock block={figure(SPEC)} />, { wrapper: Editor });
    await openSource();
    await selectItem('a');
    expect((screen.getByRole('textbox', { name: 'Label' }) as HTMLTextAreaElement).value).toBe('Encoder');

    rerender(<FigureBlock block={figure(SPEC.replace('"Encoder"', '"Encoder stack"'))} />);
    await settle();
    const field = screen.getByRole('textbox', { name: 'Label' }) as HTMLTextAreaElement;
    expect(field.value).toBe('Encoder stack');
    fireEvent.focus(field);
    fireEvent.blur(field);
    fireEvent.keyDown(field, { key: 'Enter' });
    expect(actions.updateCodeText).not.toHaveBeenCalled();
  });

  it('commits a typed label on Enter or blur, and Escape puts the source’s back', async () => {
    render(<Live initial={SPEC} />, { wrapper: Editor });
    await openSource();
    await selectItem('a');
    const field = screen.getByRole('textbox', { name: 'Label' }) as HTMLTextAreaElement;
    fireEvent.change(field, { target: { value: 'Enc' } });
    fireEvent.keyDown(field, { key: 'Escape' });
    expect(field.value).toBe('Encoder');
    fireEvent.change(field, { target: { value: 'Encoder 1' } });
    await act(async () => {
      fireEvent.keyDown(field, { key: 'Enter' });
    });
    expect(lastWritten().nodes[0]).toMatchObject({ id: 'a', label: 'Encoder 1' });
    // Until the preview catches up, the field keeps what was typed.
    expect(field.value).toBe('Encoder 1');
    await settle();
    expect((screen.getByRole('textbox', { name: 'Label' }) as HTMLTextAreaElement).value).toBe('Encoder 1');
  });

  it('edits a multi-line label without joining its lines', async () => {
    const spec = JSON.stringify({ nodes: [{ id: 'a', label: 'Input hidden\n$u_t$' }, 'b'] });
    render(<FigureBlock block={figure(spec)} />, { wrapper: Editor });
    await openSource();
    await selectItem('a');
    const field = screen.getByRole('textbox', { name: 'Label' }) as HTMLTextAreaElement;
    expect(field.value).toBe('Input hidden\n$u_t$');
    fireEvent.change(field, { target: { value: `${field.value}!` } });
    // Shift+Enter is a line break, not a commit.
    fireEvent.keyDown(field, { key: 'Enter', shiftKey: true });
    expect(actions.updateCodeText).not.toHaveBeenCalled();
    fireEvent.blur(field);
    expect(lastWritten().nodes[0]).toMatchObject({ id: 'a', label: 'Input hidden\n$u_t$!' });
  });

  it('styles an item whose id comes from its label', async () => {
    const spec = '{"nodes":[{"label":"Encoder"},{"label":"Decoder"}],"edges":["Encoder -> Decoder"]}';
    render(<FigureBlock block={figure(spec)} />, { wrapper: Editor });
    await openSource();
    await selectItem('encoder');
    expect(screen.queryByText(/definition/)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Tone red' }));
    expect(lastWritten().nodes).toEqual([{ label: 'Encoder', tone: 'red' }, { label: 'Decoder' }]);
  });

  it('clears a `fill` tone along with the others when a role or tone is chosen', async () => {
    const spec = '{"nodes":[{"id":"a","label":"A","fill":"red"},"b"]}';
    render(<FigureBlock block={figure(spec)} />, { wrapper: Editor });
    await openSource();
    await selectItem('a');
    fireEvent.change(screen.getByRole('combobox', { name: 'Role' }), { target: { value: 'attention' } });
    expect(lastWritten().nodes[0]).toEqual({ id: 'a', label: 'A', role: 'attention' });
    fireEvent.click(screen.getByRole('button', { name: 'Tone blue' }));
    expect(lastWritten().nodes[0]).toEqual({ id: 'a', label: 'A', tone: 'blue' });
  });

  it('removes only the role when the role is cleared', async () => {
    const spec = '{"nodes":[{"id":"a","label":"A","role":"model","shape":"circle","tone":"green"},"b"]}';
    render(<FigureBlock block={figure(spec)} />, { wrapper: Editor });
    await openSource();
    await selectItem('a');
    fireEvent.change(screen.getByRole('combobox', { name: 'Role' }), { target: { value: '' } });
    expect(lastWritten().nodes[0]).toEqual({ id: 'a', label: 'A', shape: 'circle', tone: 'green' });
  });
});
