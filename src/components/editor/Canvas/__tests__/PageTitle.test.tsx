import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

const title = vi.hoisted(() => ({
  draftTitle: '',
  isUntitled: true,
  rename: vi.fn(async () => {}),
}));
const actions = vi.hoisted(() => ({
  insertBlocksAfter: vi.fn(
    (_after: string | null, blocks: Array<{ id: string; type: string; html?: string }>, _options?: object) =>
      blocks.map((block) => block.id),
  ),
  refs: { current: {} as Record<string, HTMLElement | null> },
}));
const openAskAi = vi.hoisted(() => vi.fn());

vi.mock('@/editor', async () => {
  const actual = await vi.importActual<typeof import('@/editor')>('@/editor');
  return { ...actual, useDocumentTitle: () => title, useEditorActions: () => actions };
});
vi.mock('@/components/ui/toastContext', () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock('../../AskAi/askAiEvents', () => ({ openAskAi }));

const { PageTitle } = await import('../PageTitle');
const { BlankPageActions } = await import('../BlankPageActions');

beforeEach(() => {
  vi.clearAllMocks();
  title.draftTitle = '';
  title.isUntitled = true;
  vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb) => {
    cb(0);
    return 0;
  });
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('PageTitle', () => {
  it('is the page heading, with an "Untitled" placeholder while unnamed', () => {
    render(<PageTitle onContinue={vi.fn()} />);
    const field = screen.getByRole('textbox', { name: 'Page title' });

    expect(screen.getByRole('heading', { level: 1 })).toBeTruthy();
    expect(field.getAttribute('data-placeholder')).toBe('Untitled');
    expect(field.hasAttribute('data-empty')).toBe(true);
    // The topbar breadcrumb focuses the title through this attribute.
    expect(field.hasAttribute('data-page-title')).toBe(true);
  });

  it('shows the document name and renames on blur', () => {
    title.draftTitle = 'Sparse routing';
    render(<PageTitle onContinue={vi.fn()} />);
    const field = screen.getByRole('textbox', { name: 'Page title' });
    expect(field.textContent).toBe('Sparse routing');

    field.textContent = 'Dense routing';
    fireEvent.blur(field);
    expect(title.rename).toHaveBeenCalledWith('Dense routing');
  });

  it('commits once and continues into the page on Enter', () => {
    const onContinue = vi.fn();
    render(<PageTitle onContinue={onContinue} />);
    const field = screen.getByRole('textbox', { name: 'Page title' });
    field.focus();
    field.textContent = 'A title';

    fireEvent.keyDown(field, { key: 'Enter' });
    expect(onContinue).toHaveBeenCalledTimes(1);
    expect(title.rename).toHaveBeenCalledTimes(1);
    expect(title.rename).toHaveBeenCalledWith('A title');
  });

  it('restores the saved name on Escape', () => {
    title.draftTitle = 'Kept';
    render(<PageTitle onContinue={vi.fn()} />);
    const field = screen.getByRole('textbox', { name: 'Page title' });
    field.focus();
    field.textContent = 'Discarded';

    fireEvent.keyDown(field, { key: 'Escape' });
    expect(field.textContent).toBe('Kept');
  });
});

describe('BlankPageActions', () => {
  it('replaces the blank line with a paper outline', () => {
    render(<BlankPageActions blankId="blank" />);
    fireEvent.click(screen.getByRole('button', { name: 'Paper outline' }));

    const [anchor, blocks, options] = actions.insertBlocksAfter.mock.calls[0];
    expect(anchor).toBe('blank');
    expect(options).toEqual({ replaceAnchor: true });
    expect(blocks.filter((block) => block.type === 'heading').map((block) => block.html)).toEqual(['Abstract', 'Introduction', 'Related work', 'Method', 'Experiments', 'Conclusion']);
  });

  it('opens Ask AI on a new first line when the page has no blocks', () => {
    render(<BlankPageActions blankId={null} />);
    fireEvent.click(screen.getByRole('button', { name: 'Start with AI' }));

    const [anchor, blocks] = actions.insertBlocksAfter.mock.calls[0];
    expect(anchor).toBeNull();
    expect(openAskAi).toHaveBeenCalledWith({ blockId: blocks[0].id });
  });

  it('imports Markdown, naming an untitled page after its leading "# Title"', async () => {
    const { container } = render(<BlankPageActions blankId="blank" />);
    expect(screen.getByRole('button', { name: 'Import Markdown' })).toBeTruthy();

    const file = new File(['# My paper\n\nHello world'], 'paper.md', { type: 'text/markdown' });
    fireEvent.change(container.querySelector('input[type="file"]')!, { target: { files: [file] } });

    await waitFor(() => expect(actions.insertBlocksAfter).toHaveBeenCalled());
    expect(title.rename).toHaveBeenCalledWith('My paper');
    const [anchor, blocks] = actions.insertBlocksAfter.mock.calls[0];
    expect(anchor).toBe('blank');
    expect(blocks).toEqual([expect.objectContaining({ type: 'paragraph', html: 'Hello world' })]);
  });
});
