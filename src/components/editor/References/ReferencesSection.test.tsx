import { itemAt } from '@/lib/itemAt';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mockDocumentList } from '@/data/__tests__/documentFixtures';
import { act, cleanup, fireEvent, screen } from '@testing-library/react';
import { renderWithQueryClient as render } from '@/__tests__/queryClient';
import type { Block, CitationChild, Doc } from '@/editor/types';
import { TEST_WORKSPACE_ID } from '@/__tests__/workspace';
import { reference } from '@/__tests__/agentSource';

/**
 * The reference list is derived from the document, so it is tested through the
 * real provider: a list built from a hand-made bibliography object would prove
 * only that the fixture matches itself.
 */

vi.mock('@/data/documents', async () => ({
  ...(await vi.importActual<typeof import('@/data/documents')>('@/data/documents')),
  createDocument: vi.fn(async () => ({ id: 'created-doc', doc: { blocks: [], name: 'Doc' }, etag: 'cw:1', updatedAt: null, placement: { documentId: 'created-doc', collectionId: null, sortKey: 'V', placementEtag: '"cwp:1"', treeVersion: null } })),
  saveDocument: vi.fn(async () => ({ etag: 'cw:2', updatedAt: null })),
  getDocument: vi.fn(async () => ({ doc: { blocks: [], name: 'Doc' }, etag: 'cw:1', updatedAt: null, placement: { documentId: 'doc', collectionId: null, sortKey: 'V', placementEtag: '"cwp:1"', treeVersion: null } })),
  deleteDocument: vi.fn(async () => {}),
}));

// The first-run probe reads the server's page list: there is none yet.
beforeEach(() => {
  mockDocumentList();
});
afterEach(() => {
  vi.restoreAllMocks();
});

const { EditorProvider } = await import('@/editor');
const { ReferencesSection } = await import('./ReferencesSection');

const scrollIntoView = vi.fn();
const originalScrollIntoView = HTMLElement.prototype.scrollIntoView;

const cite = (id: string, over: Partial<CitationChild> = {}): CitationChild => ({
  id,
  type: 'citation',
  keys: ['k1'],
  style: 'nlm-citation-sequence-brackets',
  ...over,
});

const para = (id: string, children: CitationChild[]): Block => ({
  id,
  type: 'paragraph',
  html: children.map((child) => `<span data-child-id="${child.id}"></span>`).join(''),
  children,
});

async function mount(blocks: Block[]) {
  const doc: Doc = { blocks };
  localStorage.setItem(`colwrite:ws:${TEST_WORKSPACE_ID}:doc:local`, JSON.stringify({ documentId: null, doc }));
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

  it('lists one row per source, numbered in citation order, as the page’s CSL style prints it', async () => {
    await mount([
      para('p1', [
        cite('c1', { sources: [reference('k1', { title: 'First paper', authors: 'Ada Author', year: 2020 })] }),
        cite('c2', { keys: ['k2'], sources: [reference('k2', { title: 'Second paper', authors: 'Bea Buthor', year: 2021 })] }),
      ]),
      // A repeat of the first source: one row, not two.
      para('p2', [cite('c3')]),
    ]);

    const rows = screen.getAllByRole('listitem');
    expect(rows).toHaveLength(2);
    expect(rows[0]?.textContent).toContain('1.');
    expect(rows[0]?.textContent).toContain('Author A. First paper. 2020.');
    expect(rows[1]?.textContent).toContain('2.');
    expect(screen.getByText('2 sources · Vancouver (brackets), numbered in order of first citation.')).toBeTruthy();
  });

  it('marks a retracted work in the list itself, with its notice, and a work to review with what differs', async () => {
    await mount([
      para('p1', [
        cite('c1', {
          sources: [reference('k1', {
            title: 'Retracted paper', authors: 'Ada Author', year: 2020, state: 'verified', flags: ['retracted'],
            notices: [{ type: 'retraction', date: '2024-03-12', doi: '10.5555/r1', source: 'crossref' }],
          })],
        }),
        cite('c2', { keys: ['k2'], sources: [reference('k2', { title: 'Odd paper', state: 'needs_review', differs: ['issued'] })] }),
        cite('c3', { keys: ['k3'], sources: [reference('k3', { title: 'Fine paper', state: 'verified' })] }),
      ]),
    ]);

    const [retracted, review, fine] = screen.getAllByRole('listitem');
    expect(retracted?.textContent).toContain('Retracted.');
    expect(retracted?.textContent).toContain('Retraction published on 2024-03-12 (reported by Crossref).');
    expect(retracted?.querySelector('a[aria-label="Retracted: the notice"]')?.getAttribute('href')).toBe('https://doi.org/10.5555/r1');
    expect(review?.textContent).toContain('Needs review.');
    expect(review?.textContent).toContain('Sources disagree on its year.');
    // The normal case is quiet.
    expect(fine?.querySelector('[data-mark]')).toBeNull();
  });

  it('links each usage back to the citation it came from', async () => {
    await mount([para('p1', [cite('c1')]), para('p2', [cite('c2')])]);

    const back = screen.getAllByRole('button', { name: /Go to citation/ });
    expect(back).toHaveLength(2);
    expect(back[0]?.getAttribute('aria-label')).toBe('Go to citation 1 of 2 for k1');

    fireEvent.click(itemAt(back, 1));
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
        cite('c2', { keys: ['k2'], sources: [reference('k2', { title: 'Known' })] }),
      ]),
    ]);

    expect(screen.getByText('1 without details')).toBeTruthy();
    expect(screen.getByText('No details attached')).toBeTruthy();
  });

  it('drops the numeric marker and sorts by author for an author-date style', async () => {
    await mount([
      para('p1', [
        cite('c1', { style: 'apa', keys: ['zed'], sources: [reference('zed', { title: 'Later', authors: 'Zoe Zed', year: 2020 })] }),
        cite('c2', { style: 'apa', keys: ['abel'], sources: [reference('abel', { title: 'Earlier', authors: 'Abe Abel', year: 2019 })] }),
      ]),
    ]);

    const rows = screen.getAllByRole('listitem');
    expect(rows[0]?.textContent).toContain('Abel, A. (2019). Earlier.');
    expect(rows[0]?.textContent).not.toContain('1.');
    expect(rows[1]?.textContent).toContain('Zed, Z. (2020). Later.');
  });
});
