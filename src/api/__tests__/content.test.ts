import { describe, expect, expectTypeOf, it } from 'vitest';
import type {
  AiBeatChild,
  Block,
  CitationChild,
  CitationSource,
  CodeBlock,
  DividerBlock,
  Doc,
  EquationChild,
  GraphChild,
  HeadingBlock,
  ParagraphBlock,
  TableChild,
} from '@/editor/types';
import { toEditorDoc, toEditorSource, toWireContent } from '../content';
import type {
  AiBeatChild as WireAiBeatChild,
  CitationChild as WireCitationChild,
  CitationSource as WireCitationSource,
  CodeBlock as WireCodeBlock,
  DividerBlock as WireDividerBlock,
  DocumentContentInput,
  DocumentContentOutput,
  EquationChild as WireEquationChild,
  GraphChild as WireGraphChild,
  HeadingBlock as WireHeadingBlock,
  ParagraphBlockInput,
  ParagraphBlockOutput,
  TableChild as WireTableChild,
} from '../schema';

/*
 * The type-level half runs in `tsc -b` (`npm run typecheck`): a contract
 * change that drops a field the editor reads, or adds one the API requires
 * that `Doc` cannot produce, fails the build here.
 */

describe('the conversions, at the type level', () => {
  it('toWireContent turns a Doc into everything the API requires', () => {
    expectTypeOf(toWireContent).parameter(0).toEqualTypeOf<Doc>();
    expectTypeOf(toWireContent).returns.toEqualTypeOf<DocumentContentInput>();
  });

  it('toEditorDoc turns stored content into a Doc', () => {
    expectTypeOf(toEditorDoc).parameter(0).toEqualTypeOf<DocumentContentOutput>();
    expectTypeOf(toEditorDoc).returns.toEqualTypeOf<Doc>();
  });

  it('every page field the editor reads is still in the content', () => {
    expectTypeOf<keyof Doc>().toExtend<keyof DocumentContentOutput>();
    expectTypeOf<NonNullable<Doc['citationStyle']>>().toExtend<NonNullable<DocumentContentOutput['citationStyle']>>();
  });

  it('every block and widget field the editor reads is still on the wire, and no other', () => {
    expectTypeOf<keyof ParagraphBlock>().toEqualTypeOf<keyof ParagraphBlockOutput>();
    expectTypeOf<keyof HeadingBlock>().toEqualTypeOf<keyof WireHeadingBlock>();
    expectTypeOf<keyof DividerBlock>().toEqualTypeOf<keyof WireDividerBlock>();
    expectTypeOf<keyof CodeBlock>().toEqualTypeOf<keyof WireCodeBlock>();
    expectTypeOf<keyof AiBeatChild>().toEqualTypeOf<keyof WireAiBeatChild>();
    expectTypeOf<keyof TableChild>().toEqualTypeOf<keyof WireTableChild>();
    expectTypeOf<keyof CitationChild>().toEqualTypeOf<keyof WireCitationChild>();
    expectTypeOf<keyof EquationChild>().toEqualTypeOf<keyof WireEquationChild>();
    expectTypeOf<keyof GraphChild>().toEqualTypeOf<keyof WireGraphChild>();
    expectTypeOf<keyof CitationSource>().toEqualTypeOf<keyof WireCitationSource>();
  });

  it('every value the editor holds is one the API accepts', () => {
    expectTypeOf<Block['type']>().toEqualTypeOf<NonNullable<DocumentContentInput['blocks']>[number]['type']>();
    expectTypeOf<NonNullable<ParagraphBlock['children']>[number]['type']>()
      .toEqualTypeOf<NonNullable<ParagraphBlockInput['children']>[number]['type']>();
    expectTypeOf<NonNullable<ParagraphBlock['variant']>>().toEqualTypeOf<NonNullable<ParagraphBlockInput['variant']>>();
    expectTypeOf<HeadingBlock['level']>().toEqualTypeOf<WireHeadingBlock['level']>();
    expectTypeOf<NonNullable<TableChild['align']>>().toExtend<NonNullable<WireTableChild['align']>>();
    expectTypeOf<GraphChild['kind']>().toEqualTypeOf<WireGraphChild['kind']>();
    expectTypeOf<NonNullable<CitationSource['provider']>>().toEqualTypeOf<NonNullable<WireCitationSource['provider']>>();
    expectTypeOf<NonNullable<CitationSource['kind']>>().toEqualTypeOf<NonNullable<WireCitationSource['kind']>>();
  });
});

const sampleBlocks: Block[] = [
  { id: 'b1', type: 'paragraph', html: '<p>Hello</p>' },
  { id: 'b2', type: 'heading', level: 2, html: '<h2>World</h2>' },
  { id: 'b3', type: 'divider' },
];

function stored(content: Partial<DocumentContentOutput>): DocumentContentOutput {
  return { schema_version: 1, name: 'Untitled page', ...content };
}

describe('toWireContent', () => {
  it('sends the canonical content fields, and only those', () => {
    const content = toWireContent({ blocks: sampleBlocks, name: 'My Doc' });
    expect(Object.keys(content).sort()).toEqual(['blocks', 'citationStyle', 'name', 'schema_version', 'sources']);
    expect(content).toMatchObject({ schema_version: 1, name: 'My Doc' });
  });

  it('spells out the defaults the editor leaves out', () => {
    const content = toWireContent({
      blocks: [
        { id: 'p', type: 'paragraph', html: 'x <span data-child-id="e" contenteditable="false"></span>', children: [{ id: 'e', type: 'equation', latex: 'x' }] },
        { id: 'h', type: 'heading', level: 1, html: 'Title', locked: true },
      ],
    });
    expect(content.blocks).toEqual([
      {
        id: 'p', type: 'paragraph', html: 'x <span data-child-id="e" contenteditable="false"></span>',
        aiHidden: false, collapsed: false, locked: false, columns: 1,
        children: [{ id: 'e', type: 'equation', latex: 'x', display: false, numbered: false }],
      },
      { id: 'h', type: 'heading', level: 1, html: 'Title', aiHidden: false, collapsed: false, locked: true },
    ]);
  });

  it('saves a page with no name under the default one', () => {
    expect(toWireContent({ blocks: [], name: '' }).name).toBe('Untitled page');
    expect(toWireContent({ blocks: [] }).name).toBe('Untitled page');
  });

  it('sends an empty library and no style as null, which clears them', () => {
    const content = toWireContent({ blocks: [], sources: [] });
    expect(content.sources).toBeNull();
    expect(content.citationStyle).toBeNull();
  });

  it('keeps one library entry per key', () => {
    const content = toWireContent({ blocks: [], sources: [{ key: 'a', title: 'A' }, { key: 'a', title: 'again' }, { key: ' ' }] });
    expect(content.sources).toEqual([{ key: 'a', title: 'A' }]);
  });

  it('leaves out a widget entry that has no placeholder in the html', () => {
    const kept = { id: 'c1', type: 'equation' as const, latex: 'x' };
    const orphan = { id: 'c2', type: 'equation' as const, latex: 'y' };
    const content = toWireContent({
      blocks: [{
        id: 'p',
        type: 'paragraph',
        html: 'See <span data-child-id="c1" contenteditable="false"></span> here',
        children: [kept, orphan],
        columns: 1,
      }],
    });
    const [paragraph] = content.blocks ?? [];
    expect(paragraph?.type === 'paragraph' ? paragraph.children : null).toEqual([{ ...kept, display: false, numbered: false }]);
  });
});

describe('toEditorDoc', () => {
  it('reads the content, and nothing that is not content', () => {
    const doc = toEditorDoc(stored({ blocks: sampleBlocks as DocumentContentOutput['blocks'], name: 'X' }));
    expect(doc).toEqual({ blocks: sampleBlocks, name: 'X' });
  });

  it('reads an empty page as an empty page', () => {
    expect(toEditorDoc(stored({ blocks: [] }))).toEqual({ blocks: [], name: 'Untitled page' });
  });

  it('drops blocks it cannot render and repairs a recoverable paragraph', () => {
    const doc = toEditorDoc(stored({
      blocks: [
        { id: 'bad', type: 'video', src: 'unexpected' },
        { id: 'recovered', type: 'paragraph', html: 42 },
        null,
      ] as unknown as DocumentContentOutput['blocks'],
    }));
    expect(doc.blocks).toEqual([{ id: 'recovered', type: 'paragraph', html: '', columns: 1, children: [] }]);
  });

  it('reads the library without nulls, with years as text', () => {
    const doc = toEditorDoc(stored({
      sources: [{ key: 'k', title: 'T', year: 2021, doi: null, url: null }],
      citationStyle: 'ieee',
    }));
    expect(doc.sources).toEqual([{ key: 'k', title: 'T', year: '2021' }]);
    expect(doc.citationStyle).toBe('ieee');
  });

  it('round-trips what toWireContent sends', () => {
    const doc: Doc = { blocks: sampleBlocks, name: 'My Doc', sources: [{ key: 'k', year: '2020' }], citationStyle: 'numeric' };
    const back = toEditorDoc(toWireContent(doc) as DocumentContentOutput);
    expect(back.name).toBe('My Doc');
    expect(back.sources).toEqual(doc.sources);
    expect(back.citationStyle).toBe('numeric');
    expect(back.blocks.map((block) => block.id)).toEqual(['b1', 'b2', 'b3']);
  });
});

describe('toEditorSource', () => {
  it('drops null fields', () => {
    expect(toEditorSource({ key: '10.1/x', title: 'Paper', authors: null, provider: 'crossref' }))
      .toEqual({ key: '10.1/x', title: 'Paper', provider: 'crossref' });
  });
});
