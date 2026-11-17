import { describe, expect, expectTypeOf, it } from 'vitest';
import type {
  AiBeatChild,
  Block,
  CitationChild,
  CitationPassage,
  CodeBlock,
  CslItem,
  CslName,
  DividerBlock,
  Doc,
  EquationChild,
  GraphChild,
  HeadingBlock,
  ParagraphBlock,
  ParagraphChild,
  ReferenceNotice,
  ReferenceRecord,
  TableChild,
} from '@/editor/types';
import { CITATION_STYLES } from '@/editor/csl/styles';
import { reference } from '@/__tests__/agentSource';
import { referenceRecordOf, toEditorDoc, toEditorRecord, toWireContent } from '../content';
import type {
  AiBeatChildOutput as WireAiBeatChild,
  CitationChildOutput as WireCitationChild,
  CitationPassage as WireCitationPassage,
  CodeBlock as WireCodeBlock,
  CslItem as WireCslItem,
  CslName as WireCslName,
  ReferenceNotice as WireReferenceNotice,
  ReferenceRecordInput,
  ReferenceRecordOutput,
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
    expectTypeOf<keyof ReferenceRecord>().toEqualTypeOf<keyof ReferenceRecordOutput>();
    expectTypeOf<keyof CslItem>().toEqualTypeOf<keyof WireCslItem>();
    expectTypeOf<keyof CslName>().toEqualTypeOf<keyof WireCslName>();
    expectTypeOf<keyof ReferenceNotice>().toEqualTypeOf<keyof WireReferenceNotice>();
    expectTypeOf<keyof CitationPassage>().toEqualTypeOf<keyof WireCitationPassage>();
  });

  it('every value the editor holds is one the API accepts', () => {
    expectTypeOf<Block['type']>().toEqualTypeOf<NonNullable<DocumentContentInput['blocks']>[number]['type']>();
    expectTypeOf<NonNullable<ParagraphBlock['children']>[number]['type']>()
      .toEqualTypeOf<NonNullable<ParagraphBlockInput['children']>[number]['type']>();
    expectTypeOf<NonNullable<ParagraphBlock['variant']>>().toEqualTypeOf<NonNullable<ParagraphBlockInput['variant']>>();
    expectTypeOf<HeadingBlock['level']>().toEqualTypeOf<WireHeadingBlock['level']>();
    expectTypeOf<NonNullable<TableChild['align']>>().toExtend<NonNullable<WireTableChild['align']>>();
    expectTypeOf<GraphChild['kind']>().toEqualTypeOf<WireGraphChild['kind']>();
    expectTypeOf<ReferenceRecord['provider']>().toEqualTypeOf<ReferenceRecordInput['provider']>();
    expectTypeOf<ReferenceRecord['kind']>().toEqualTypeOf<ReferenceRecordInput['kind']>();
    expectTypeOf<ReferenceRecord['state']>().toEqualTypeOf<ReferenceRecordInput['state']>();
    expectTypeOf<CslItem['type']>().toEqualTypeOf<WireCslItem['type']>();
    expectTypeOf<ReferenceRecord>().toExtend<ReferenceRecordInput>();
    expectTypeOf<NonNullable<CitationChild['style']>>().toEqualTypeOf<NonNullable<WireCitationChild['style']>>();
  });

  it('offers exactly the API’s CSL style ids', () => {
    type Listed = (typeof CITATION_STYLES)[number]['id'];
    expectTypeOf<Listed>().toEqualTypeOf<NonNullable<DocumentContentInput['citationStyle']>>();
    expect(new Set(CITATION_STYLES.map((style) => style.id)).size).toBe(8);
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
    expect(Object.keys(content).sort()).toEqual(['blocks', 'citationStyle', 'documentType', 'instructions', 'name', 'schema_version', 'sources']);
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

  it('writes the defaults the server stores for each widget', () => {
    const html = ['a', 'b', 'c'].map((id) => `<span data-child-id="${id}" contenteditable="false"></span>`).join(' ');
    const content = toWireContent({
      blocks: [{
        id: 'p', type: 'paragraph', html,
        children: [
          // An AI passage an older page stored, with neither field.
          { id: 'a', type: 'aiBeat', output: 'x' } as unknown as ParagraphChild,
          { id: 'b', type: 'citation', keys: ['k'] },
          { id: 'c', type: 'table', rows: 1, cols: 1, data: [['1']] },
        ],
      }],
    });
    const [paragraph] = content.blocks ?? [];
    expect(paragraph?.type === 'paragraph' ? paragraph.children : null).toEqual([
      { id: 'a', type: 'aiBeat', output: 'x', collapsed: false, message: '', prompt: '' },
      { id: 'b', type: 'citation', keys: ['k'], style: 'nlm-citation-sequence-brackets', sources: [] },
      { id: 'c', type: 'table', rows: 1, cols: 1, data: [['1']], header: false, align: [] },
    ]);
  });

  it('keeps a widget whose id the html escapes', () => {
    const content = toWireContent({
      blocks: [{
        id: 'p', type: 'paragraph',
        html: '<span data-child-id="cite&amp;one" contenteditable="false"></span>',
        children: [{ id: 'cite&one', type: 'citation', keys: ['k'] }],
      }],
    });
    const [paragraph] = content.blocks ?? [];
    expect(paragraph?.type === 'paragraph' ? paragraph.children?.map((child) => child.id) : null).toEqual(['cite&one']);
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
    const a = reference('a', { title: 'A' });
    const content = toWireContent({ blocks: [], sources: [a, reference('a', { title: 'again' }), { ...reference('x'), key: ' ' }] });
    expect(content.sources).toEqual([a]);
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
  it('round-trips durable AI drafts, normalizes their records and preserves null output', () => {
    const record = reference('doi:10.1234/draft', { title: 'Durable draft evidence', state: 'verified' });
    const doc = toEditorDoc(stored({
      blocks: [{
        id: 'p', type: 'paragraph', aiHidden: false, collapsed: false, locked: false, columns: 1,
        html: '<span data-child-id="draft"></span><span data-child-id="empty"></span>',
        children: [
          { id: 'draft', type: 'aiBeat', message: 'Write', prompt: '', collapsed: false,
            output: { text: 'Supported [@doi:10.1234/draft]', sources: [{ ...record, checked: null, differs: null }] } },
          { id: 'empty', type: 'aiBeat', message: '', prompt: '', collapsed: false, output: null },
        ],
      }],
    }));
    const [block] = doc.blocks;
    expect(block?.type === 'paragraph' && block.children).toMatchObject([
      { output: { text: 'Supported [@doi:10.1234/draft]', sources: [record] } },
      { output: null },
    ]);
    const wire = toWireContent(doc);
    expect(wire.blocks?.[0]?.type === 'paragraph' && wire.blocks[0].children).toMatchObject([
      { output: { text: 'Supported [@doi:10.1234/draft]', sources: [record] } },
      { output: null },
    ]);
  });

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

  it('reads the library and the citations’ records without nulls, and a CSL style id', () => {
    const wire = { ...reference('doi:10.1234/k', { title: 'T', year: 2021 }), checked: null, differs: null, published_doi: null, notices: null };
    const doc = toEditorDoc(stored({
      sources: [wire as ReferenceRecordOutput],
      citationStyle: 'apa',
      blocks: [{
        id: 'p', type: 'paragraph', html: '<span data-child-id="c" contenteditable="false"></span>', aiHidden: false, collapsed: false, locked: false, columns: 1,
        children: [{ id: 'c', type: 'citation', keys: ['doi:10.1234/k'], style: 'apa', prefix: null, sources: [wire as ReferenceRecordOutput], passage: { id: 'S1.2', level: 'abstract', chat_id: null } }],
      }] as DocumentContentOutput['blocks'],
    }));
    expect(doc.sources).toEqual([reference('doi:10.1234/k', { title: 'T', year: 2021 })]);
    expect(doc.citationStyle).toBe('apa');
    const [block] = doc.blocks;
    expect(block?.type === 'paragraph' && block.children?.[0]).toEqual({
      id: 'c', type: 'citation', keys: ['doi:10.1234/k'], style: 'apa', sources: [reference('doi:10.1234/k', { title: 'T', year: 2021 })],
      passage: { id: 'S1.2', level: 'abstract' },
    });
  });

  it('round-trips what toWireContent sends', () => {
    const doc: Doc = { blocks: sampleBlocks, name: 'My Doc', sources: [reference('doi:10.1234/k', { year: 2020 })], citationStyle: 'nature' };
    const back = toEditorDoc(toWireContent(doc) as DocumentContentOutput);
    expect(back.name).toBe('My Doc');
    expect(back.sources).toEqual(doc.sources);
    expect(back.citationStyle).toBe('nature');
    expect(back.blocks.map((block) => block.id)).toEqual(['b1', 'b2', 'b3']);
  });
});

describe('references from outside the page', () => {
  it('reads a paper route’s record without nulls', () => {
    expect(toEditorRecord({ ...reference('doi:10.1234/x', { title: 'Paper' }), checked: null, published_doi: null } as ReferenceRecordOutput))
      .toEqual(reference('doi:10.1234/x', { title: 'Paper' }));
  });

  it('keeps a socket’s record only when it is one, with the contract’s fields, each of its type', () => {
    const record = {
      ...reference('arxiv:2101.03961', { title: 'Switch', authors: 'William Fedus', year: 2021, flags: ['preprint'] }),
      flags: ['preprint', 'preprint', 'from_the_future'],
      notices: [{ type: 'retraction', date: '2024-01-01', doi: 3 }, { type: 'gossip' }],
      extra: 'dropped',
      csl: { id: 'arxiv:2101.03961', type: 'article', title: 'Switch', author: [{ given: 'William', family: 'Fedus' }, { given: 'No family' }], volume: 3, abstract: 'dropped' },
    };
    expect(referenceRecordOf(record)).toEqual({
      key: 'arxiv:2101.03961', kind: 'paper', provider: 'openalex', state: 'unchecked', flags: ['preprint'],
      notices: [{ type: 'retraction', date: '2024-01-01' }],
      csl: { id: 'arxiv:2101.03961', type: 'article', title: 'Switch', author: [{ given: 'William', family: 'Fedus' }] },
    });
    // A CSL id that is not the key, no title, or a provider the contract does not name: no reference.
    expect(referenceRecordOf({ ...record, csl: { ...record.csl, id: 'other' } })).toBeNull();
    expect(referenceRecordOf({ ...record, csl: { ...record.csl, title: '' } })).toBeNull();
    expect(referenceRecordOf({ ...record, provider: 'evil' })).toBeNull();
    expect(referenceRecordOf({ key: 'k', title: 'An old flat source' })).toBeNull();
  });
});
