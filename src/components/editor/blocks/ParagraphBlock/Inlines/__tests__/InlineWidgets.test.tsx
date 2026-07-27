import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { createRef, useImperativeHandle } from 'react';
import type { Block, Doc, ParagraphChild } from '@/editor/types';

/**
 * Behaviour tests for the reworked in-flow widgets (citation, equation),
 * mounted against the real EditorProvider — numbering is a document-level
 * property, so testing it without the document would test nothing.
 */

vi.mock('@/services', async () => ({
  createDocument: vi.fn(async () => ({ document_id: 'created-doc', version: 1 })),
  saveDocument: vi.fn(async () => ({ status: 'ok', message: '', version: 2 })),
  loadDocument: vi.fn(async () => ({ version: 1, blocks: [], name: 'Doc' })),
  deleteDocument: vi.fn(async () => ({ status: 'ok', message: '' })),
  listDocuments: vi.fn(async () => ({ documents: [], count: 0, status: 'ok', message: '' })),
}));

const searchMocks = vi.hoisted(() => ({
  arxiv: vi.fn(),
  semanticScholar: vi.fn(),
}));

vi.mock('@/services/arxiv', () => ({
  searchArxiv: searchMocks.arxiv,
}));

vi.mock('@/services/semanticScholar', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/services/semanticScholar')>();
  return {
    ...actual,
    searchSemanticScholar: searchMocks.semanticScholar,
  };
});

const { EditorProvider, useEditor } = await import('@/editor');
const { CitationInline } = await import('../CitationInline/CitationInline');
const { EquationInline } = await import('../EquationInline/EquationInline');

const captureRef = createRef<ReturnType<typeof useEditor>>();
const harness = {
  get editor() {
    if (!captureRef.current) throw new Error('Editor harness is not mounted');
    return captureRef.current;
  },
};

function Capture() {
  const editor = useEditor();
  useImperativeHandle(captureRef, () => editor, [editor]);
  return null;
}

/** Renders one widget with the provider's real wiring. */
function Host({ blockId, child }: { blockId: string; child: ParagraphChild }) {
  const ctx = useEditor();
  const props = {
    blockId,
    child,
    updateParagraphChild: ctx.updateParagraphChild,
    removeParagraphChild: ctx.removeParagraphChild,
    updateHtml: ctx.updateHtml,
    refs: ctx.refs,
  };
  if (child.type === 'citation') return <CitationInline {...props} />;
  if (child.type === 'equation') return <EquationInline {...props} />;
  return null;
}

async function mount(child: ParagraphChild, extraBlocks: Block[] = []) {
  const doc: Doc = {
    version: 1,
    blocks: [
      { id: 'p1', type: 'paragraph', html: 'text', children: [child] },
      ...extraBlocks,
    ],
  };
  // The provider adopts the local draft when no remote document is known.
  localStorage.setItem('colwrite:doc:local', JSON.stringify({ documentId: null, doc }));

  const utils = render(
    <EditorProvider>
      <Capture />
      <Host blockId="p1" child={child} />
    </EditorProvider>,
  );
  // Flush the provider's mount effects (remote-listing probe, draft cache).
  await act(async () => {});
  return utils;
}

beforeEach(() => {
  localStorage.clear();
  searchMocks.arxiv.mockReset();
  searchMocks.semanticScholar.mockReset();
  searchMocks.arxiv.mockResolvedValue([]);
  searchMocks.semanticScholar.mockResolvedValue({
    provider: 'semantic_scholar',
    total: 0,
    offset: 0,
    next_offset: null,
    data: [],
  });
});
afterEach(cleanup);

const citation = (id: string, over: Partial<ParagraphChild> = {}): ParagraphChild =>
  ({ id, type: 'citation', keys: ['k1'], style: 'numeric', ...over }) as ParagraphChild;

describe('CitationInline', () => {
  it('numbers citations across the whole document, not per paragraph', async () => {
    const other: Block = {
      id: 'p2',
      type: 'paragraph',
      html: 'text',
      children: [citation('c2'), citation('c3')],
    };
    await mount(citation('c1'), [other]);

    // c1 is first in document order; the two in p2 follow it.
    expect(screen.getByRole('button', { name: '[1]' })).toBeTruthy();
    expect(harness.editor.blocks.find((b) => b.id === 'p2')).toBeTruthy();
  });

  it('renders author–year from the attached source, key as fallback', async () => {
    await mount(
      citation('c1', {
        style: 'author-year',
        keys: ['smith2020', 'unknown'],
        sources: [{ key: 'smith2020', title: 'T', authors: 'J. Smith, A. Doe', year: '2020' }],
      }),
    );

    expect(screen.getByRole('button', { name: '(Smith, 2020; unknown)' })).toBeTruthy();
  });

  it('marks a citation with no keys as needing a source', async () => {
    await mount(citation('c1', { keys: [] }));
    const pill = screen.getByRole('button', { name: '[1]' });
    expect(pill.className).toContain('bg-destructive/15');
  });

  it('adds a pasted identifier as a key instead of searching for it', async () => {
    await mount(citation('c1', { keys: [] }));
    fireEvent.click(screen.getByRole('button', { name: '[1]' }));

    const field = screen.getByPlaceholderText(
      'Search arXiv and Semantic Scholar, or paste a key / DOI',
    );
    fireEvent.change(field, { target: { value: '2103.00020' } });
    fireEvent.keyDown(field, { key: 'Enter' });

    const block = harness.editor.blocks.find((b) => b.id === 'p1');
    expect(block?.type === 'paragraph' && block.children?.[0]).toMatchObject({
      keys: ['2103.00020'],
    });
  });

  it('attaches Semantic Scholar results with canonical DOI and provider provenance', async () => {
    searchMocks.semanticScholar.mockResolvedValue({
      provider: 'semantic_scholar',
      total: 1,
      offset: 0,
      next_offset: null,
      data: [
        {
          provider: 'semantic_scholar',
          paper_id: 'paper-with-doi',
          corpus_id: 9,
          external_ids: { DOI: 'https://doi.org/10.1000/ABC.' },
          title: 'Semantic paper',
          abstract: null,
          url: 'https://www.semanticscholar.org/paper/paper-with-doi',
          pdf_url: 'https://example.test/paper.pdf',
          authors: [{ author_id: 'a1', name: 'A. Researcher' }],
          year: 2024,
          publication_date: null,
          venue: 'Journal',
          citation_count: 8,
          influential_citation_count: 2,
          reference_count: 5,
          is_open_access: true,
          open_access_pdf: null,
          tldr: null,
          publication_types: [],
          fields_of_study: [],
        },
      ],
    });
    await mount(citation('c1', { keys: [], sources: [] }));
    fireEvent.click(screen.getByRole('button', { name: '[1]' }));

    const field = screen.getByPlaceholderText(
      'Search arXiv and Semantic Scholar, or paste a key / DOI',
    );
    fireEvent.change(field, { target: { value: 'semantic query' } });
    fireEvent.click(screen.getByRole('button', { name: 'Search' }));
    await act(async () => {});
    fireEvent.click(screen.getByText('Semantic paper'));

    const block = harness.editor.blocks.find((candidate) => candidate.id === 'p1');
    expect(block?.type === 'paragraph' ? block.children?.[0] : null).toMatchObject({
      keys: ['10.1000/abc'],
      sources: [
        {
          key: '10.1000/abc',
          provider: 'semantic_scholar',
          providerId: 'paper-with-doi',
          doi: '10.1000/abc',
          citationCount: 8,
          isOpenAccess: true,
        },
      ],
    });
  });

  it('deduplicates federated arXiv versions under a portable arXiv key', async () => {
    searchMocks.semanticScholar.mockResolvedValue({
      provider: 'semantic_scholar',
      total: 1,
      offset: 0,
      next_offset: null,
      data: [
        {
          provider: 'semantic_scholar',
          paper_id: 'semantic-arxiv-paper',
          corpus_id: 10,
          external_ids: { ArXiv: 'ARXIV:2401.01234v2' },
          title: 'Federated paper',
          abstract: null,
          url: 'https://www.semanticscholar.org/paper/semantic-arxiv-paper',
          pdf_url: null,
          authors: [],
          year: 2024,
          publication_date: null,
          venue: null,
          citation_count: null,
          influential_citation_count: null,
          reference_count: null,
          is_open_access: false,
          open_access_pdf: null,
          tldr: null,
          publication_types: [],
          fields_of_study: [],
        },
      ],
    });
    searchMocks.arxiv.mockResolvedValue([
      {
        id: '2401.01234v5',
        title: 'Duplicate from arXiv',
        url: 'https://arxiv.org/abs/2401.01234v5',
      },
    ]);
    await mount(citation('c1', { keys: [], sources: [] }));
    fireEvent.click(screen.getByRole('button', { name: '[1]' }));

    const field = screen.getByPlaceholderText(
      'Search arXiv and Semantic Scholar, or paste a key / DOI',
    );
    fireEvent.change(field, { target: { value: 'federated identity' } });
    fireEvent.click(screen.getByRole('button', { name: 'Search' }));
    await act(async () => {});

    expect(screen.getByText('Federated paper')).toBeTruthy();
    expect(screen.queryByText('Duplicate from arXiv')).toBeNull();
    fireEvent.click(screen.getByText('Federated paper'));

    const block = harness.editor.blocks.find((candidate) => candidate.id === 'p1');
    expect(block?.type === 'paragraph' ? block.children?.[0] : null).toMatchObject({
      keys: ['2401.01234'],
      sources: [
        {
          key: '2401.01234',
          provider: 'semantic_scholar',
          providerId: 'semantic-arxiv-paper',
          externalIds: { ArXiv: 'ARXIV:2401.01234v2' },
        },
      ],
    });
  });

  it('keeps Semantic Scholar results when arXiv fails and falls back to an S2 key', async () => {
    searchMocks.arxiv.mockRejectedValue(new Error('arXiv unavailable'));
    searchMocks.semanticScholar.mockResolvedValue({
      provider: 'semantic_scholar',
      total: 1,
      offset: 0,
      next_offset: null,
      data: [
        {
          provider: 'semantic_scholar',
          paper_id: 'paper-without-doi',
          corpus_id: null,
          external_ids: {},
          title: 'S2 fallback paper',
          abstract: null,
          url: null,
          pdf_url: null,
          authors: [],
          year: null,
          publication_date: null,
          venue: null,
          citation_count: null,
          influential_citation_count: null,
          reference_count: null,
          is_open_access: false,
          open_access_pdf: null,
          tldr: null,
          publication_types: [],
          fields_of_study: [],
        },
      ],
    });
    await mount(citation('c1', { keys: [], sources: [] }));
    fireEvent.click(screen.getByRole('button', { name: '[1]' }));

    const field = screen.getByPlaceholderText(
      'Search arXiv and Semantic Scholar, or paste a key / DOI',
    );
    fireEvent.change(field, { target: { value: 'partial provider search' } });
    fireEvent.click(screen.getByRole('button', { name: 'Search' }));
    await act(async () => {});

    expect(screen.getByText('arXiv is unavailable; showing Semantic Scholar results.')).toBeTruthy();
    fireEvent.click(screen.getByText('S2 fallback paper'));
    const block = harness.editor.blocks.find((candidate) => candidate.id === 'p1');
    expect(block?.type === 'paragraph' ? block.children?.[0] : null).toMatchObject({
      keys: ['S2:paper-without-doi'],
      sources: [
        {
          provider: 'semantic_scholar',
          providerId: 'paper-without-doi',
        },
      ],
    });
  });
});

describe('EquationInline', () => {
  const equation = (id: string, over: Partial<ParagraphChild> = {}): ParagraphChild =>
    ({ id, type: 'equation', latex: 'E = mc^2', ...over }) as ParagraphChild;

  it('renders the LaTeX source as a pill while typesetting loads', async () => {
    await mount(equation('e1'));
    expect(screen.getByRole('button', { name: 'E = mc^2' })).toBeTruthy();
  });

  it('numbers only display equations, in document order', async () => {
    const other: Block = {
      id: 'p2',
      type: 'paragraph',
      html: 'text',
      children: [
        equation('e2', { display: true, numbered: true }),
        equation('e3', { display: false, numbered: false }),
        equation('e4', { display: true, numbered: true }),
      ],
    };
    await mount(equation('e1', { display: true, numbered: true }), [other]);

    // e1 is the first numbered display equation in the document.
    expect(screen.getByText('(1)')).toBeTruthy();
  });

  it('closes the editor on Enter but keeps it open on Shift+Enter', async () => {
    await mount(equation('e1'));
    fireEvent.click(screen.getByRole('button', { name: 'E = mc^2' }));

    const field = screen.getByPlaceholderText('E = mc^2');
    fireEvent.keyDown(field, { key: 'Enter', shiftKey: true });
    expect(screen.getByRole('dialog')).toBeTruthy();

    fireEvent.keyDown(field, { key: 'Enter' });
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('keeps the numbered option unavailable for inline maths', async () => {
    await mount(equation('e1'));
    fireEvent.click(screen.getByRole('button', { name: 'E = mc^2' }));

    const numbered = screen.getByLabelText('Numbered') as HTMLInputElement;
    expect(numbered.disabled).toBe(true);
  });

  it('removes the widget: placeholder first, then the child, then reserialize', async () => {
    await mount(equation('e1'));
    const host = document.createElement('div');
    host.innerHTML = 'before <span data-child-id="e1" contenteditable="false"></span> after';
    harness.editor.refs.current['p1'] = host;

    fireEvent.click(screen.getByRole('button', { name: 'E = mc^2' }));
    fireEvent.click(screen.getByRole('button', { name: 'Remove' }));

    expect(host.querySelector('[data-child-id="e1"]')).toBeNull();
    const block = harness.editor.blocks.find((b) => b.id === 'p1');
    expect(block?.type === 'paragraph' ? block.children : []).toEqual([]);
  });
});
