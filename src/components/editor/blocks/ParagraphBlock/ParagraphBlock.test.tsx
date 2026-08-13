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
  }: {
    html: string;
    ariaLabel: string;
    locked?: boolean;
  }) => (
    <div
      role="textbox"
      aria-label={ariaLabel}
      aria-multiline="true"
      aria-readonly={locked || undefined}
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
