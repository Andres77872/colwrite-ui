import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { TooltipProvider } from '@/components/ui/tooltip';
import { contentOf, FIXTURE_DOCUMENT_ID, liveDocument } from '@/dev/msw/fixtures';
import { toEditorDoc } from '@/api/content';
import { EditorExample } from '../ManuscriptExamples';
import { sampleManuscript } from '../manuscript';

afterEach(cleanup);

describe('interactive manuscript examples', () => {
  it('starts from the same manuscript the workspace opens through the API', () => {
    const saved = liveDocument(FIXTURE_DOCUMENT_ID);
    if (!saved) throw new Error('Missing sample manuscript');
    expect(sampleManuscript()).toEqual(toEditorDoc(contentOf(saved)));
  });

  it('edits a real table without changing the starting paper for the next reader', () => {
    const open = () =>
      render(
        <TooltipProvider>
          <EditorExample />
        </TooltipProvider>,
      );
    const cell = () => screen.getByRole<HTMLTextAreaElement>('textbox', { name: 'Row 2, column 3' });
    const first = open();
    expect(cell().value).toBe('11.8');
    fireEvent.change(cell(), { target: { value: '12.4' } });
    expect(cell().value).toBe('12.4');
    fireEvent.click(screen.getByRole('button', { name: 'Add a row' }));
    expect(screen.getAllByRole('row')).toHaveLength(5);
    first.unmount();
    open();
    expect(cell().value).toBe('11.8');
    expect(screen.getAllByRole('row')).toHaveLength(4);
  });
});
