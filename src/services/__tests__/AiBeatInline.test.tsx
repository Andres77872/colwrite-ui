import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import type { MutableRefObject } from 'react';

// ── Mock external dependencies ──

vi.mock('../agentChat', () => ({
  streamAgentChat: vi.fn(),
}));

vi.mock('../../components/common/Editable/Editable', () => ({
  serializeEditableHtml: vi.fn(() => ''),
}));

// Import after mocks are set up
import { AiBeatInline } from '../../components/editor/blocks/ParagraphBlock/Inlines/AiBeatInline/AiBeatInline';

// ── Test helpers ──

function createMockProps(overrides: Record<string, unknown> = {}) {
  const refs = { current: {} } as MutableRefObject<Record<string, HTMLDivElement | null>>;

  return {
    blockId: 'block-1',
    child: {
      type: 'aiBeat' as const,
      id: 'child-1',
      message: '',
      prompt: '',
      output: '',
      collapsed: false,
      ...(overrides.child as Record<string, unknown> || {}),
    },
    updateParagraphChild: vi.fn(),
    removeParagraphChild: vi.fn(),
    updateHtml: vi.fn(),
    refs,
    documentId: 'doc-123',
    createRemote: vi.fn().mockResolvedValue('doc-456'),
    ...overrides,
  };
}

describe('AiBeatInline validation', () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('1. renders with non-empty initial child props', () => {
    const refs = { current: {} } as MutableRefObject<Record<string, HTMLDivElement | null>>;

    render(
      <AiBeatInline
        blockId="block-1"
        child={{
          type: 'aiBeat' as const,
          id: 'child-1',
          message: 'hello',
          prompt: 'world',
          output: '',
          collapsed: false,
        }}
        updateParagraphChild={vi.fn()}
        removeParagraphChild={vi.fn()}
        updateHtml={vi.fn()}
        refs={refs}
        documentId="doc-123"
        createRemote={vi.fn().mockResolvedValue('doc-456')}
      />,
    );

    // Verify the component rendered
    expect(screen.getByText('AIBeat')).toBeTruthy();

    // Check for character count display
    const spans = screen.getAllByText((_: string, el: Element | null) => {
      if (!el || el.tagName !== 'SPAN') return false;
      return el.textContent?.includes('/2000') ?? false;
    });
    expect(spans.length).toBeGreaterThanOrEqual(2);
  });

  it('2. typing >2000 chars in message field shows error and disables Generate', () => {
    const props = createMockProps();
    render(<AiBeatInline {...props} />);

    const textarea = screen.getByPlaceholderText<HTMLTextAreaElement>('What do you want to generate?');
    expect(textarea).toBeTruthy();

    const longString = 'a'.repeat(2001);
    fireEvent.change(textarea, { target: { value: longString } });

    expect(screen.getByText(/Message must be.*2000 characters/)).toBeTruthy();
    const generateBtn = screen.getByRole('button', { name: /^Generate$/ });
    expect(generateBtn).toBeTruthy();
    expect((generateBtn as HTMLButtonElement).disabled).toBe(true);
  });

  it('3. typing >2000 chars in prompt field shows error and disables Generate', () => {
    const props = createMockProps();
    render(<AiBeatInline {...props} />);

    const promptInputs = screen.getAllByPlaceholderText('You are a helpful assistant');
    const promptInput = promptInputs[0];
    expect(promptInput).toBeTruthy();

    const longString = 'b'.repeat(2001);
    fireEvent.change(promptInput, { target: { value: longString } });

    expect(screen.getByText(/Prompt must be.*2000 characters/)).toBeTruthy();
    const generateBtn = screen.getByRole('button', { name: /^Generate$/ });
    expect(generateBtn).toBeTruthy();
    expect((generateBtn as HTMLButtonElement).disabled).toBe(true);
  });

  it('4. editing back under limit clears error and re-enables Generate', () => {
    const props = createMockProps();
    render(<AiBeatInline {...props} />);

    const promptInputs = screen.getAllByPlaceholderText('You are a helpful assistant');
    const promptInput = promptInputs[0];

    fireEvent.change(promptInput, { target: { value: 'b'.repeat(2001) } });
    expect(screen.getByText(/Prompt must be.*2000 characters/)).toBeTruthy();

    fireEvent.change(promptInput, { target: { value: 'short prompt' } });
    expect(screen.queryByText(/Prompt must be.*2000 characters/)).toBeNull();

    const generateBtn = screen.getByRole('button', { name: /^Generate$/ });
    expect(generateBtn).toBeTruthy();
    expect((generateBtn as HTMLButtonElement).disabled).toBe(false);
  });
});
