import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DocumentContentOutput } from '@/api/schema';

/**
 * citeproc and the CSL styles are a chunk loaded on first need. Until it is
 * here a page's citations are written in a neutral form, numbered in order
 * of first citation, and the bibliography says it is not ready; a page with
 * citations asks for the chunk, and once it is here the same page renders
 * in its style. The test setup loads it for every other test, so this one
 * reads fresh modules.
 */

beforeEach(() => {
  vi.resetModules();
});

async function freshModules() {
  const [{ toEditorDoc }, { fixtureDocument }, citations, processor, markup] = await Promise.all([
    import('@/api/content'),
    import('@/dev/fixtureDocument'),
    import('../../citations'),
    import('../processor'),
    import('../markup'),
  ]);
  const page = toEditorDoc(structuredClone(fixtureDocument()) as unknown as DocumentContentOutput);
  return { page, citations, processor, markup };
}

describe('the citation processor, loaded on first need', () => {
  it('writes the page neutrally until it is here, asks for it, then renders in the page’s style', async () => {
    const { page, citations, processor, markup } = await freshModules();
    expect(processor.isCitationProcessorReady()).toBe(false);

    const neutral = citations.buildBibliography(page.blocks, { library: page.sources, style: 'apa' });
    expect(neutral.ready).toBe(false);
    const cites = page.blocks.flatMap((block) => (block.type === 'paragraph' ? block.children ?? [] : []))
      .filter((child) => child.type === 'citation');
    // Numbers in order of first citation, whatever the style: no author-date yet.
    expect(cites.map((child) => citations.citationLabelText(child as never, neutral))).toEqual(['[1, 2]', '[3]', '[4]', '[5]']);
    expect(markup.markupText(neutral.entries[0]!.formatted)).toBe(
      'William Fedus, Barret Zoph, Noam Shazeer. Switch Transformers: Scaling to Trillion Parameter Models with Simple and Efficient Sparsity. 2022.',
    );

    // Asking was enough: the chunk arrives without anyone awaiting it.
    await vi.waitFor(() => expect(processor.isCitationProcessorReady()).toBe(true));
    const styled = citations.buildBibliography(page.blocks, { library: page.sources, style: 'apa' });
    expect(styled.ready).toBe(true);
    expect(citations.citationLabelText(cites[0] as never, styled)).toBe('(Fedus et al., 2022; Lepikhin et al., 2021)');
  });

  it('tells a subscriber once it has loaded, and loads once however often it is asked for', async () => {
    const { processor } = await freshModules();
    const heard = vi.fn();
    const stop = processor.subscribeCitationProcessor(heard);
    await Promise.all([processor.loadCitationProcessor(), processor.loadCitationProcessor()]);
    expect(heard).toHaveBeenCalledTimes(1);
    stop();
  });

  it('writes an empty page with no request for it', async () => {
    const { citations, processor } = await freshModules();
    expect(citations.buildBibliography([]).ready).toBe(true);
    expect(processor.isCitationProcessorReady()).toBe(false);
  });
});
