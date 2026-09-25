import { describe, it, expect, vi, afterEach } from 'vitest';
import { act, render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import { useState, type MutableRefObject } from 'react';
import type { AiBeatChild, ParagraphChild } from '@/editor';
import type { SSEEventHandlers } from '@/services/streamParser';

const streamAgentChat = vi.fn();

vi.mock('@/services/agentChat', () => ({
  streamAgentChat: (...args: unknown[]) => streamAgentChat(...args),
}));
vi.mock('@/components/common/Editable/Editable', () => ({
  serializeEditableHtml: vi.fn((root: HTMLElement) => root.innerHTML),
}));

const { AiBeatInline } = await import('../AiBeatInline/AiBeatInline');

/**
 * The widget is controlled by the document rather than by private state, so
 * the harness has to hold the child the way the editor does. Driving it with
 * an inert `vi.fn()` for `updateParagraphChild` would test a component whose
 * fields can never change.
 */
function Harness({
  initial,
  documentId = 'doc-123',
  onRemoveChild,
  host,
}: {
  initial?: Partial<AiBeatChild>;
  documentId?: string | null;
  onRemoveChild?: () => void;
  host?: HTMLDivElement | null;
}) {
  const [child, setChild] = useState<AiBeatChild>({
    id: 'child-1',
    type: 'aiBeat',
    message: '',
    prompt: '',
    output: '',
    collapsed: false,
    ...initial,
  });

  const refs = {
    current: { 'block-1': host ?? null },
  } as MutableRefObject<Record<string, HTMLDivElement | null>>;

  return (
    <AiBeatInline
      blockId="block-1"
      child={child}
      updateParagraphChild={(_blockId, _childId, next: Partial<ParagraphChild>) =>
        setChild((prev) => ({ ...prev, ...(next as Partial<AiBeatChild>) }))
      }
      removeParagraphChild={() => onRemoveChild?.()}
      updateHtml={vi.fn()}
      refs={refs}
      documentId={documentId}
      ensureRemoteDocument={vi.fn().mockResolvedValue('doc-456')}
    />
  );
}

const messageField = () => screen.getByPlaceholderText<HTMLTextAreaElement>('What do you want to generate?');
const promptField = () => screen.getByPlaceholderText<HTMLInputElement>('You are a helpful assistant');
const generateButton = () => screen.getByRole('button', { name: /^(Generate|Regenerate)$/ });

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('AiBeatInline', () => {
  it('renders its stored message and prompt', () => {
    render(<Harness initial={{ message: 'hello', prompt: 'world' }} />);

    expect(messageField().value).toBe('hello');
    expect(promptField().value).toBe('world');
  });

  it('writes edits straight to the document', () => {
    render(<Harness />);
    fireEvent.change(messageField(), { target: { value: 'summarise this' } });

    expect(messageField().value).toBe('summarise this');
  });

  it('blocks generation past the message length limit', () => {
    render(<Harness initial={{ message: 'x' }} />);
    fireEvent.change(messageField(), { target: { value: 'a'.repeat(2001) } });

    expect(screen.getByText(/Message must be.*2000 characters/)).toBeTruthy();
    expect((generateButton() as HTMLButtonElement).disabled).toBe(true);
  });

  it('blocks generation past the prompt length limit', () => {
    render(<Harness initial={{ message: 'ok' }} />);
    fireEvent.change(promptField(), { target: { value: 'b'.repeat(2001) } });

    expect(screen.getByText(/Prompt must be.*2000 characters/)).toBeTruthy();
    expect((generateButton() as HTMLButtonElement).disabled).toBe(true);
  });

  it('re-enables generation once back under the limit', () => {
    render(<Harness initial={{ message: 'ok' }} />);
    fireEvent.change(promptField(), { target: { value: 'b'.repeat(2001) } });
    fireEvent.change(promptField(), { target: { value: 'short prompt' } });

    expect(screen.queryByText(/Prompt must be.*2000 characters/)).toBeNull();
    expect((generateButton() as HTMLButtonElement).disabled).toBe(false);
  });

  it('will not generate from an empty message', () => {
    render(<Harness />);
    expect((generateButton() as HTMLButtonElement).disabled).toBe(true);
  });

  it('runs in rewrite mode, so the agent cannot edit the document', async () => {
    // This widget produces text for the author to place. Running it with the
    // document tools let it rewrite the paper while the author was still
    // deciding whether to keep the passage.
    streamAgentChat.mockResolvedValue({ chatId: null, threadId: null, usage: null });
    render(<Harness initial={{ message: 'write an abstract' }} />);

    await act(async () => {
      generateButton().click();
    });

    await waitFor(() => expect(streamAgentChat).toHaveBeenCalled());
    expect(streamAgentChat.mock.calls[0][0]).toMatchObject({ mode: 'rewrite' });
  });

  it('streams tokens into the output and keeps them', async () => {
    streamAgentChat.mockImplementation(async (_params: unknown, handlers: SSEEventHandlers) => {
      handlers.onToken?.('Hello ');
      handlers.onToken?.('world');
      return { chatId: null, threadId: null, usage: null };
    });
    render(<Harness initial={{ message: 'write' }} />);

    await act(async () => {
      generateButton().click();
    });

    await waitFor(() => expect(screen.getByText('Hello world')).toBeTruthy());
  });

  it('surfaces a failure instead of silently doing nothing', async () => {
    streamAgentChat.mockRejectedValue(new Error('Model unavailable'));
    render(<Harness initial={{ message: 'write' }} />);

    await act(async () => {
      generateButton().click();
    });

    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('Model unavailable'));
  });

  it('replaces itself with the text when inserted', async () => {
    const host = document.createElement('div');
    host.innerHTML = '<span data-child-id="child-1" contenteditable="false"></span>';
    const onRemoveChild = vi.fn();

    render(<Harness initial={{ message: 'x', output: 'Generated prose.' }} onRemoveChild={onRemoveChild} host={host} />);

    await act(async () => {
      screen.getByRole('button', { name: /insert into text/i }).click();
    });

    // Accepting used to leave the panel behind next to the text it produced.
    expect(host.querySelector('[data-child-id="child-1"]')).toBeNull();
    expect(host.textContent).toBe('Generated prose.');
    expect(onRemoveChild).toHaveBeenCalled();
  });

  it('says what the engine is doing while nothing has been written', async () => {
    let handlers!: SSEEventHandlers;
    let finish!: () => void;
    streamAgentChat.mockImplementation((_params: unknown, next: SSEEventHandlers) => {
      handlers = next;
      return new Promise((resolve) => {
        finish = () => resolve({ chatId: null, threadId: null, usage: null, terminal: 'done' });
      });
    });
    render(<Harness initial={{ message: 'write' }} />);
    await act(async () => {
      generateButton().click();
    });
    await waitFor(() => expect(streamAgentChat).toHaveBeenCalled());

    expect(screen.getByRole('status').textContent).toContain('Thinking…');
    act(() => handlers.onStatus?.('starting', 'Starting Claude Code…'));
    expect(screen.getByRole('status').textContent).toContain('Starting Claude Code…');
    // Rendered inside inline markup, where a paragraph may not nest.
    expect(screen.getByRole('status').tagName).toBe('SPAN');

    await act(async () => {
      handlers.onToken?.('Draft.');
      finish();
    });
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('says so when the stream closed before finishing', async () => {
    streamAgentChat.mockImplementation(async (_params: unknown, handlers: SSEEventHandlers) => {
      handlers.onToken?.('Half a sent');
      return { chatId: null, threadId: null, usage: null, terminal: null };
    });
    render(<Harness initial={{ message: 'write' }} />);
    await act(async () => {
      generateButton().click();
    });

    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('may be incomplete'));
  });
});
