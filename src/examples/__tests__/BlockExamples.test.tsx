import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { TooltipProvider } from '@/components/ui/tooltip';
import { contentOf, FIXTURE_DOCUMENT_ID, liveDocument } from '@/dev/msw/fixtures';
import { toEditorDoc } from '@/api/content';
import { CitationsExample, TableExample } from '../BlockExamples';
import { examples } from '../catalog';
import { sampleManuscript } from '../manuscript';

afterEach(cleanup);

const inTooltips = (ui: React.ReactElement) => render(<TooltipProvider>{ui}</TooltipProvider>);

describe('the docs’ block examples', () => {
  it('start from the same manuscript the workspace opens through the API', () => {
    const saved = liveDocument(FIXTURE_DOCUMENT_ID);
    if (!saved) throw new Error('Missing sample manuscript');
    expect(sampleManuscript()).toEqual(toEditorDoc(contentOf(saved)));
  });

  it('show only what a page can hold, never the app’s panels', () => {
    expect(Object.keys(examples)).toEqual(['equation', 'table', 'chart', 'diagram', 'figure', 'citations']);
  });

  it('edit a real table without changing the starting paper for the next reader', () => {
    const cell = () => screen.getByRole<HTMLTextAreaElement>('textbox', { name: 'Row 2, column 3' });
    const first = inTooltips(<TableExample />);
    expect(cell().value).toBe('11.8');
    fireEvent.change(cell(), { target: { value: '12.4' } });
    expect(cell().value).toBe('12.4');
    fireEvent.click(screen.getByRole('button', { name: 'Add a row' }));
    expect(screen.getAllByRole('row')).toHaveLength(5);
    first.unmount();
    inTooltips(<TableExample />);
    expect(cell().value).toBe('11.8');
    expect(screen.getAllByRole('row')).toHaveLength(4);
  });

  it('set the citations and the reference list in the chosen style, with each work’s marks', () => {
    inTooltips(<CitationsExample />);
    const list = screen.getByRole('region', { name: 'References' });
    expect(within(list).getAllByRole('listitem').length).toBeGreaterThan(3);
    expect(within(list).getByText(/Retracted/)).not.toBeNull();
    expect(document.body.textContent).toMatch(/\[1, ?2\]|\[1–2\]|\[1-2\]/);
  });
});
