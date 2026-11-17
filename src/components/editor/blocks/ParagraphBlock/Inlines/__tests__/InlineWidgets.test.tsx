import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mockDocumentList } from '@/data/__tests__/documentFixtures';
import { act, cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import { renderWithQueryClient as render } from '@/__tests__/queryClient';
import { createRef, useImperativeHandle } from 'react';
import type { PanelsContextValue } from '@/components/panels/panelsContextState';
import type { Block, Doc, ParagraphChild } from '@/editor/types';
import { TEST_WORKSPACE_ID } from '@/__tests__/workspace';

/**
 * Behaviour tests for the reworked in-flow widgets (citation, equation),
 * mounted against the real EditorProvider — numbering is a document-level
 * property, so testing it without the document would test nothing.
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

const preferenceState = vi.hoisted(() => ({ loading: false }));

/** The workspace's catalog, as the mock computes it for the account's switches, read or still loading. */
function catalogForTest() {
  return catalogValue(catalogOf(TEST_WORKSPACE_ID), preferenceState.loading, null);
}

const { EditorProvider } = await import('@/editor');
const { useEditorProbe } = await import('@/editor/__tests__/editorHarness');
const { PanelsContext } = await import('@/components/panels/panelsContextState');
const { AssistantCatalogContext, catalogValue } = await import('@/components/preferences/assistantCatalogContextState');
const { catalogOf, fixtures } = await import('@/dev/msw/fixtures');
const { FEDUS } = await import('@/dev/fixtureReferences');
const { http, problem } = await import('@/dev/msw/handlers');
const { server, recordRequests, pathOf } = await import('@/__tests__/server');
const { reference } = await import('@/__tests__/agentSource');
const { CitationInline } = await import('../CitationInline/CitationInline');
const { EquationInline } = await import('../EquationInline/EquationInline');
const { ReferencesSection } = await import('@/components/editor/References');
const { ToastProvider } = await import('@/components/ui/toast');

const captureRef = createRef<ReturnType<typeof useEditorProbe>>();
const harness = {
  get editor() {
    if (!captureRef.current) throw new Error('Editor harness is not mounted');
    return captureRef.current;
  },
};

function Capture() {
  const editor = useEditorProbe();
  useImperativeHandle(captureRef, () => editor, [editor]);
  return null;
}

/** Renders one widget with the provider's real wiring. */
function Host({ blockId, child }: { blockId: string; child: ParagraphChild }) {
  const ctx = useEditorProbe();
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

async function mount(
  child: ParagraphChild,
  extraBlocks: Block[] = [],
  panels?: Partial<PanelsContextValue>,
) {
  const doc: Doc = {
    blocks: [
      { id: 'p1', type: 'paragraph', html: 'text', children: [child] },
      ...extraBlocks,
    ],
  };
  // The provider adopts the local draft when no remote document is known.
  localStorage.setItem(`colwrite:ws:${TEST_WORKSPACE_ID}:doc:local`, JSON.stringify({ documentId: null, doc }));

  const editor = (
    <ToastProvider>
    <AssistantCatalogContext.Provider value={catalogForTest()}>
      <EditorProvider>
        <Capture />
        <Host blockId="p1" child={child} />
        {/* The other half of a citation: mounted so the jump between them is
            exercised against the real reference list, not a stub. */}
        <ReferencesSection />
      </EditorProvider>
    </AssistantCatalogContext.Provider>
    </ToastProvider>
  );
  const utils = render(
    panels ? (
      <PanelsContext.Provider value={panels as PanelsContextValue}>{editor}</PanelsContext.Provider>
    ) : (
      editor
    ),
  );
  // Flush the provider's mount effects (remote-listing probe, draft cache).
  await act(async () => {});
  return utils;
}

// jsdom has no scrollIntoView; the citation ↔ reference jump calls it.
const scrollIntoView = vi.fn();
const originalScrollIntoView = HTMLElement.prototype.scrollIntoView;

beforeEach(() => {
  localStorage.clear();
  scrollIntoView.mockClear();
  Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
    configurable: true,
    value: scrollIntoView,
  });
  preferenceState.loading = false;
});
afterEach(() => {
  cleanup();
  Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
    configurable: true,
    value: originalScrollIntoView,
  });
});

const citation = (id: string, over: Partial<ParagraphChild> = {}): ParagraphChild =>
  ({ id, type: 'citation', keys: ['k1'], style: 'nlm-citation-sequence-brackets', ...over }) as ParagraphChild;

/** The pill's accessible name describes the sources; its text is the label. */
const pill = () => screen.getByRole('group', { name: 'Citation' }).querySelector('button')!;

const smith = (key: string, title = 'T', authors = 'Jane Smith') => reference(key, { title, authors, year: 2020 });

describe('CitationInline', () => {
  it('numbers by source, so one paper cited three times is [1] every time', async () => {
    const other: Block = {
      id: 'p2',
      type: 'paragraph',
      html: 'text',
      children: [citation('c2'), citation('c3')],
    };
    await mount(citation('c1'), [other]);

    // All three cite `k1`, which is one entry in the reference list.
    expect(pill().textContent).toBe('[1]');
    expect(harness.editor.blocks.find((b) => b.id === 'p2')).toBeTruthy();
  });

  it('numbers a second source separately and collapses a run into a range', async () => {
    const other: Block = {
      id: 'p2',
      type: 'paragraph',
      html: 'text',
      children: [citation('c2', { keys: ['k2'] }), citation('c3', { keys: ['k3'] })],
    };
    await mount(citation('c1', { keys: ['k1', 'k2', 'k3'] }), [other]);

    expect(pill().textContent).toBe('[1–3]');
  });

  it('prints IEEE’s brackets on each number', async () => {
    await mount(citation('c1', { style: 'ieee', keys: ['k1', 'k2', 'k3'] }));
    expect(pill().textContent).toBe('[1], [2], [3]');
  });

  it('renders an author-date style from the attached record, a bare key as itself', async () => {
    await mount(citation('c1', { style: 'apa', keys: ['smith2020', 'unknown'], sources: [smith('smith2020', 'T', 'Jane Smith, Ann Doe')] }));
    expect(pill().textContent).toBe('(Smith & Doe, 2020; unknown, n.d.)');
  });

  it('separates two sources that share an author and year', async () => {
    const other: Block = {
      id: 'p2',
      type: 'paragraph',
      html: 'text',
      children: [citation('c2', { style: 'apa', keys: ['smith2020b'], sources: [smith('smith2020b', 'Second')] })],
    };
    await mount(citation('c1', { style: 'apa', keys: ['smith2020a'], sources: [smith('smith2020a', 'First')] }), [other]);
    expect(pill().textContent).toBe('(Smith, 2020a)');
  });

  it('puts a signal phrase and a locator inside the parentheses', async () => {
    await mount(citation('c1', { style: 'apa', prefix: 'see', locator: 'p. 12', keys: ['smith2020'], sources: [smith('smith2020')] }));
    expect(pill().textContent).toBe('(see Smith, 2020, p. 12)');
  });

  it('reads as quiet bracketed text, not a filled pill', async () => {
    await mount(citation('c1'));
    // Only an error keeps a fill; a working citation is part of the sentence.
    expect(pill().className).not.toMatch(/(^|\s)bg-/);
  });

  it('marks a citation with no keys as needing a source', async () => {
    await mount(citation('c1', { keys: [] }));
    // `[1]` would name a reference entry that does not exist.
    expect(pill().textContent).toBe('[?]');
    expect(pill().className).toContain('bg-destructive/15');
    expect(pill().getAttribute('aria-label')).toBe('Citation with no source attached');
  });

  it('names its sources for screen readers rather than reading out "[1]"', async () => {
    await mount(citation('c1', { keys: ['smith2020'], sources: [reference('smith2020', { title: 'Attention Is All You Need' })] }));
    expect(pill().getAttribute('aria-label')).toBe('Citation [1]: Attention Is All You Need');
  });

  it('jumps from the citation to the reference entry it stands for', async () => {
    await mount(citation('c1', { keys: ['k1'], sources: [reference('k1', { title: 'Attention Is All You Need', year: 2017 })] }));
    fireEvent.click(pill());
    fireEvent.click(screen.getByRole('button', { name: 'Show reference 1 for Attention Is All You Need' }));

    expect(scrollIntoView).toHaveBeenCalledTimes(1);
    // Focus lands on the entry, and the popover does not pull it back.
    expect(document.activeElement?.id).toBe('ref-1');
  });

  it('shows a cited source in the Sources tab when the workspace has one', async () => {
    const openSidebar = vi.fn();
    await mount(citation('c1', { keys: ['k1'], sources: [reference('k1', { title: 'Attention Is All You Need' })] }), [], { openSidebar });
    fireEvent.click(pill());
    fireEvent.click(screen.getByRole('button', { name: 'Show Attention Is All You Need in sources' }));

    expect(openSidebar).toHaveBeenCalledWith('sources', { tab: 'sources', sourceKey: 'k1' });
  });

  it('says which passage the claim rests on, or that none was recorded', async () => {
    await mount(citation('c1', { passage: { id: 'S1.2', level: 'abstract' } }));
    fireEvent.click(pill());
    expect(screen.getByText('Rests on passage S1.2 (abstract).')).toBeTruthy();
    cleanup();
    await mount(citation('c1'));
    fireEvent.click(pill());
    expect(screen.getByText('Passage not recorded.')).toBeTruthy();
  });

  it('shows a work’s state where it is attached: retracted with its notice', async () => {
    await mount(citation('c1', {
      keys: ['k1'],
      sources: [reference('k1', { title: 'Gone', state: 'verified', flags: ['retracted'], notices: [{ type: 'retraction', date: '2024-03-12' }] })],
    }));
    fireEvent.click(pill());
    expect(screen.getByLabelText('Retracted: Retraction published on 2024-03-12.')).toBeTruthy();
  });

  it('keeps the page’s style and prefix / locator / suffix behind More options, with the styles’ credit', async () => {
    await mount(citation('c1'));
    fireEvent.click(pill());
    expect(screen.queryByLabelText('Prefix')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'More options' }));
    expect(screen.getByLabelText('Prefix')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Citation Style Language project' }).getAttribute('href')).toBe('https://citationstyles.org/');
    expect(screen.getByText(/citeproc-js, copyright © 2009–2019 Frank Bennett/)).toBeTruthy();
    fireEvent.click(screen.getByRole('radio', { name: /APA 7th edition/ }));
    await waitFor(() => expect(harness.editor.doc.citationStyle).toBe('apa'));
  });

  it('opens More options when the citation already has a locator', async () => {
    await mount(citation('c1', { locator: 'p. 12' }));
    fireEvent.click(pill());
    expect((screen.getByLabelText('Locator') as HTMLInputElement).value).toBe('p. 12');
  });

  it('offers no Sources jump outside the workspace', async () => {
    await mount(citation('c1', { sources: [reference('k1', { title: 'Attention Is All You Need' })] }));
    fireEvent.click(pill());
    expect(screen.queryByRole('button', { name: /in sources$/ })).toBeNull();
  });

  it('checks a pasted identifier with the resolver and attaches the record it answers', async () => {
    await mount(citation('c1', { keys: [] }));
    fireEvent.click(pill());

    const field = screen.getByPlaceholderText('Search papers or paste a DOI / arXiv id');
    fireEvent.change(field, { target: { value: '2101.03961' } });
    fireEvent.keyDown(field, { key: 'Enter' });

    await waitFor(() => {
      const block = harness.editor.blocks.find((b) => b.id === 'p1');
      expect(block?.type === 'paragraph' && block.children?.[0]).toMatchObject({ keys: [FEDUS.key], sources: [{ key: FEDUS.key, csl: FEDUS.csl }] });
    });
  });

  it('says why a pasted identifier is refused, and offers it as a bare key', async () => {
    server.use(http.get('/workspaces/{workspace_id}/sources/resolve', () => problem('source_mismatch', 'Mismatch', {
      claimed_title: 'Mine', found_title: 'Theirs',
    })));
    await mount(citation('c1', { keys: [] }));
    fireEvent.click(pill());
    const field = screen.getByPlaceholderText('Search papers or paste a DOI / arXiv id');
    fireEvent.change(field, { target: { value: '10.1234/x' } });
    fireEvent.keyDown(field, { key: 'Enter' });

    expect((await screen.findByRole('alert')).textContent).toBe('That identifier is “Theirs”, not “Mine”. Check which work you meant.');
    fireEvent.click(screen.getByRole('button', { name: 'Add “10.1234/x” as a key without details' }));
    const block = harness.editor.blocks.find((b) => b.id === 'p1');
    expect(block?.type === 'paragraph' && block.children?.[0]).toMatchObject({ keys: ['doi:10.1234/x'] });
  });

  it('keeps manual entry, and searches nothing, where paper search is off', async () => {
    fixtures.assistant = { switches: { papers: false }, sources: {} };
    const sent = recordRequests();
    await mount(citation('c1', { keys: [] }));
    fireEvent.click(pill());

    const field = screen.getByPlaceholderText('Paste a DOI or arXiv id');
    fireEvent.change(field, { target: { value: 'smith2020' } });
    expect((screen.getByRole('button', { name: 'Search' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.keyDown(field, { key: 'Enter' });
    expect(screen.getByRole('alert').textContent).toBe('Paper search: Papers is switched off in your settings. Paste a DOI or arXiv id instead.');
    fireEvent.click(screen.getByRole('button', { name: 'Add “smith2020” as a key without details' }));

    const block = harness.editor.blocks.find((candidate) => candidate.id === 'p1');
    expect(block?.type === 'paragraph' ? block.children?.[0] : null).toMatchObject({ keys: ['smith2020'] });
    expect(sent.some((request) => pathOf(request).includes('/papers/'))).toBe(false);
  });

  it('does not turn a search phrase into a citation key while the catalog loads', async () => {
    preferenceState.loading = true;
    await mount(citation('c1', { keys: [], sources: [] }));
    fireEvent.click(pill());

    const field = screen.getByPlaceholderText('Loading sources…');
    fireEvent.change(field, { target: { value: 'graph neural networks' } });
    fireEvent.keyDown(field, { key: 'Enter' });

    const block = harness.editor.blocks.find((candidate) => candidate.id === 'p1');
    expect(block?.type === 'paragraph' ? block.children?.[0] : null).toMatchObject({ keys: [] });
  });

  it('searches the paper route and attaches a result’s record as the route returned it', async () => {
    await mount(citation('c1', { keys: [], sources: [] }));
    fireEvent.click(pill());

    const field = screen.getByPlaceholderText('Search papers or paste a DOI / arXiv id');
    fireEvent.change(field, { target: { value: 'trillion parameter switch' } });
    fireEvent.click(screen.getByRole('button', { name: 'Search' }));
    const add = await screen.findByRole('button', { name: `Add: ${FEDUS.csl.title}` });
    fireEvent.click(add);

    const block = harness.editor.blocks.find((candidate) => candidate.id === 'p1');
    // The search's record, unchecked, with the CSL item every entry point shares.
    expect(block?.type === 'paragraph' ? block.children?.[0] : null).toMatchObject({
      keys: [FEDUS.key],
      sources: [{ key: FEDUS.key, state: 'unchecked', csl: FEDUS.csl }],
    });
  });

  it('says so when the paper sources cannot be reached', async () => {
    server.use(http.get('/workspaces/{workspace_id}/papers/search', () => problem('provider_failed', 'down', { provider: 'openalex' })));
    await mount(citation('c1', { keys: [], sources: [] }));
    fireEvent.click(pill());

    const field = screen.getByPlaceholderText('Search papers or paste a DOI / arXiv id');
    fireEvent.change(field, { target: { value: 'anything' } });
    fireEvent.click(screen.getByRole('button', { name: 'Search' }));

    expect((await screen.findByRole('alert')).textContent).toBe('The paper sources could not be reached. Try again in a moment.');
  });
});

describe('EquationInline', () => {
  const equation = (id: string, over: Partial<ParagraphChild> = {}): ParagraphChild =>
    ({ id, type: 'equation', latex: 'E = mc^2', ...over }) as ParagraphChild;

  it('renders the LaTeX source in the text while typesetting loads', async () => {
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

  // Inside a paragraph, closing puts the caret after the widget instead
  // (caretAfterWidget.test.ts); this harness mounts the widget outside any
  // editable text, which is exactly the fallback case.
  it('moves focus into the panel on open and, with no text to return to, back to the trigger on close', async () => {
    await mount(equation('e1'));
    const trigger = screen.getByRole('button', { name: 'E = mc^2' });
    fireEvent.click(trigger);

    // The popover portals to document.body, so focus has to be moved there —
    // Tab from the trigger could never reach it on its own.
    const field = screen.getByPlaceholderText('E = mc^2');
    expect(document.activeElement).toBe(field);

    fireEvent.keyDown(field, { key: 'Enter' });
    expect(screen.queryByRole('dialog')).toBeNull();
    // Radix defers the focus return by a tick (FocusScope unmount).
    await waitFor(() => expect(document.activeElement).toBe(trigger));
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
