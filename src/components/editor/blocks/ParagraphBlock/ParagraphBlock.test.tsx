import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';

vi.mock('../../../../editor', () => ({
  useEditorActions: () => ({
    refs: { current: {} },
    updateParagraphChild: vi.fn(),
    removeParagraphChild: vi.fn(),
    updateHtml: vi.fn(),
    ensureRemoteDocument: vi.fn(),
  }),
}));

vi.mock('./Inlines', () => ({
  AiBeatInline: () => null,
  TableInline: () => null,
  CitationInline: () => null,
  EquationInline: () => null,
  GraphInline: () => null,
}));

vi.mock('../../../common/Editable', () => ({
  Editable: ({
    html,
    ariaLabel,
    locked,
    placeholder,
    placeholderWhen,
  }: {
    html: string;
    ariaLabel: string;
    locked?: boolean;
    placeholder?: string;
    placeholderWhen?: string;
  }) => (
    <div
      role="textbox"
      aria-label={ariaLabel}
      aria-multiline="true"
      aria-readonly={locked || undefined}
      data-placeholder={placeholder}
      data-placeholder-when={placeholderWhen}
    >
      {html}
    </div>
  ),
}));

const { ParagraphBlock } = await import('./ParagraphBlock');

afterEach(cleanup);

describe('ParagraphBlock accessibility', () => {
  it('names its editable field as a paragraph', () => {
    render(
      <ParagraphBlock
        block={{ id: 'p1', type: 'paragraph', html: 'Body text', children: [] }}
        documentId={null}
      />,
    );

    expect(screen.getByRole('textbox', { name: 'Paragraph' }).textContent).toBe('Body text');
  });

  it('passes the locked state to the named paragraph editor', () => {
    render(
      <ParagraphBlock
        block={{ id: 'p1', type: 'paragraph', html: 'Locked text', children: [], locked: true }}
        documentId={null}
      />,
    );

    const textbox = screen.getByRole('textbox', { name: 'Paragraph' });
    expect(textbox.getAttribute('aria-readonly')).toBe('true');
  });
});

describe('ParagraphBlock placeholders', () => {
  const placeholderOf = (variant?: 'bullet' | 'todo' | 'quote' | 'callout') => {
    render(
      <ParagraphBlock
        block={{ id: 'p1', type: 'paragraph', html: '', children: [], ...(variant ? { variant } : {}) }}
        documentId={null}
      />,
    );
    const field = screen.getByRole('textbox');
    const hint = [field.getAttribute('data-placeholder'), field.getAttribute('data-placeholder-when')];
    cleanup();
    return hint;
  };

  it('hints at AI and commands only on the line being written', () => {
    expect(placeholderOf()).toEqual(["Write, press 'space' for AI, '/' for commands…", 'focus']);
  });

  it('names what each empty list item, quote and callout is', () => {
    expect(placeholderOf('bullet')).toEqual(['List', 'always']);
    expect(placeholderOf('todo')).toEqual(['To-do', 'always']);
    expect(placeholderOf('quote')).toEqual(['Empty quote', 'always']);
    expect(placeholderOf('callout')).toEqual(['Type something…', 'always']);
  });
});
