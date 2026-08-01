import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { Block, CitationChild, Doc } from '@/editor/types';

/**
 * The reference list is derived from the document, so it is tested through the
 * real provider: a list built from a hand-made bibliography object would prove
 * only that the fixture matches itself.
 */

vi.mock('@/services', () => ({
  createDocument: vi.fn(async () => ({ document_id: 'created-doc', version: 1 })),
  saveDocument: vi.fn(async () => ({ status: 'ok', message: '', version: 2 })),
  loadDocument: vi.fn(async () => ({ version: 1, blocks: [], name: 'Doc' })),
  deleteDocument: vi.fn(async () => ({ status: 'ok', message: '' })),
  listDocuments: vi.fn(async () => ({ documents: [], count: 0, status: 'ok', message: '' })),
}));

const { EditorProvider } = await import('@/editor');
const { ReferencesSection } = await import('./ReferencesSection');

const scrollIntoView = vi.fn();
const originalScrollIntoView = HTMLElement.prototype.scrollIntoView;

const cite = (id: string, over: Partial<CitationChild> = {}): CitationChild => ({
  id,
  type: 'citation',
  keys: ['k1'],
  style: 'numeric',
  ...over,
});

const para = (id: string, children: CitationChild[]): Block => ({
  id,
  type: 'paragraph',
  html: children.map((child) => `<span data-child-id="${child.id}"></span>`).join(''),
  children,
});

async function mount(blocks: Block[]) {
  const doc: Doc = { version: 1, blocks };
  localStorage.setItem('colwrite:doc:local', JSON.stringify({ documentId: null, doc }));
  const utils = render(
    <EditorProvider>
      {/* Stands in for the paragraph a back-link jumps to. */}
      {blocks
        .flatMap((block) => (block.type === 'paragraph' ? block.children ?? [] : []))
        .map((child) => (
          <span data-child-id={child.id} key={child.id}>
            <button type="button">pill</button>
          </span>
        ))}
      <ReferencesSection />
    </EditorProvider>,
  );
  await act(async () => {});
  return utils;
}

beforeEach(() => {
  localStorage.clear();
  scrollIntoView.mockClear();
  Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
    configurable: true,
    value: scrollIntoView,
  });
});

afterEach(() => {
  cleanup();
  Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
    configurable: true,
    value: originalScrollIntoView,
  });
});

describe('ReferencesSection', () => {
  it('renders nothing until something is cited', async () => {
    await mount([{ id: 'p1', type: 'paragraph', html: 'text', children: [] }]);
    expect(screen.queryByRole('heading', { name: 'References' })).toBeNull();
  });

  it('lists one row per source, numbered in citation order', async () => {
    await mount([
      para('p1', [
        cite('c1', {
          sources: [{ key: 'k1', title: 'First paper', authors: 'A. Author', year: '2020' }],
        }),
        cite('c2', {
          keys: ['k2'],
          sources: [{ key: 'k2', title: 'Second paper', authors: 'B. Buthor', year: '2021' }],
        }),
      ]),
      // A repeat of the first source: one row, not two.
      para('p2', [cite('c3')]),
    ]);

    const rows = screen.getAllByRole('listitem');
    expect(rows).toHaveLength(2);
    expect(rows[0].textContent).toContain('[1]');
    expect(rows[0].textContent).toContain('A. Author. First paper. 2020.');
    expect(rows[1].textContent).toContain('[2]');
    expect(screen.getByText('2 sources · Numbered in order of first citation.')).toBeTruthy();
  });

  it('links each usage back to the citation it came from', async () => {
    await mount([para('p1', [cite('c1')]), para('p2', [cite('c2')])]);

    const back = screen.getAllByRole('button', { name: /Go to citation/ });
    expect(back).toHaveLength(2);
    expect(back[0].getAttribute('aria-label')).toBe('Go to citation 1 of 2 for k1');

    fireEvent.click(back[1]);
    expect(scrollIntoView).toHaveBeenCalledTimes(1);
    // Focus lands on the citation, not back where the reader started.
    expect(document.activeElement?.closest('[data-child-id]')?.getAttribute('data-child-id'))
      .toBe('c2');
  });

  it('reads as "cited once" when there is only one usage', async () => {
    await mount([para('p1', [cite('c1')])]);
    expect(screen.getByRole('button', { name: 'Go to the citation of k1' })).toBeTruthy();
  });

  it('flags sources that were never resolved beyond their key', async () => {
    await mount([
      para('p1', [
        cite('c1'),
        cite('c2', { keys: ['k2'], sources: [{ key: 'k2', title: 'Known' }] }),
      ]),
    ]);

    expect(screen.getByText('1 without details')).toBeTruthy();
    expect(screen.getByText('No details attached')).toBeTruthy();
  });

  it('drops the numeric marker and sorts alphabetically for author–year', async () => {
    await mount([
      para('p1', [
        cite('c1', {
          style: 'author-year',
          keys: ['zed'],
          sources: [{ key: 'zed', title: 'Later', authors: 'Z. Zed', year: '2020' }],
        }),
        cite('c2', {
          style: 'author-year',
          keys: ['abel'],
          sources: [{ key: 'abel', title: 'Earlier', authors: 'A. Abel', year: '2019' }],
        }),
      ]),
    ]);

    const rows = screen.getAllByRole('listitem');
    expect(rows[0].textContent).toContain('A. Abel (2019). Earlier.');
    expect(rows[0].textContent).not.toContain('[1]');
    expect(rows[1].textContent).toContain('Z. Zed (2020). Later.');
  });
});
