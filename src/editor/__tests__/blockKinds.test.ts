import { describe, expect, it } from 'vitest';
import {
  BLOCK_KINDS,
  blankBlockOfKind,
  continuationOf,
  convertBlock,
  figureNumbers,
  htmlToText,
  isDiagramBlock,
  isFigureBlock,
  kindOf,
  listNumbers,
  markdownPrefixKind,
  textToHtml,
} from '../blockKinds';
import type { Block, ParagraphBlock } from '../types';

function para(id: string, html = '', extra: Partial<ParagraphBlock> = {}): ParagraphBlock {
  return { id, type: 'paragraph', html, children: [], columns: 1, ...extra };
}

describe('convertBlock', () => {
  it('turns body text into a list item and back without losing the text or flags', () => {
    const bullet = convertBlock(para('p', 'Hello <strong>world</strong>', { locked: false, aiHidden: true }), 'bullet');
    expect(bullet).toMatchObject({ id: 'p', type: 'paragraph', variant: 'bullet', html: 'Hello <strong>world</strong>', aiHidden: true });

    const text = convertBlock(bullet, 'text');
    expect(text.type).toBe('paragraph');
    expect('variant' in text && text.variant).toBeFalsy();
  });

  it('starts a new to-do unchecked and keeps the state between to-dos', () => {
    expect(convertBlock(para('p', 'x'), 'todo')).toMatchObject({ variant: 'todo', checked: false });
    const done = para('p', 'x', { variant: 'todo', checked: true });
    expect(convertBlock(done, 'todo')).toMatchObject({ checked: true });
  });

  it('drops every field the target type does not own', () => {
    const heading = convertBlock(para('p', 'Title', { columns: 3, variant: 'bullet', indent: 2 }), 'h2');
    expect(heading).toEqual({ id: 'p', type: 'heading', level: 2, html: 'Title' });
  });

  it('keeps a heading free of widget placeholders, keeping their words', () => {
    const withCitation = para('p', 'Results <span data-child-id="c1" contenteditable="false"></span> hold', {
      children: [{ id: 'c1', type: 'citation', keys: ['10.1/x'] }],
    });
    const heading = convertBlock(withCitation, 'h1');
    expect(heading).toMatchObject({ type: 'heading', level: 1 });
    expect(heading.type === 'heading' && heading.html).not.toContain('data-child-id');
  });

  it('moves text between code and prose with line breaks intact', () => {
    const code = convertBlock(para('p', 'a &lt; b<br>next'), 'code');
    expect(code).toEqual({ id: 'p', type: 'code', text: 'a < b\nnext' });
    const back = convertBlock(code, 'text');
    expect(back).toMatchObject({ type: 'paragraph', html: 'a &lt; b<br>next' });
  });

  it('keeps list depth between list kinds but not into a quote', () => {
    const nested = para('p', 'x', { variant: 'bullet', indent: 2 });
    expect(convertBlock(nested, 'numbered')).toMatchObject({ variant: 'numbered', indent: 2 });
    expect(convertBlock(nested, 'quote')).not.toHaveProperty('indent');
  });
});

describe('continuationOf', () => {
  it('continues a list at its depth, unchecked', () => {
    expect(continuationOf(para('p', '', { variant: 'todo', checked: true, indent: 1 }), 'n', 'tail')).toEqual({
      id: 'n',
      type: 'paragraph',
      html: 'tail',
      children: [],
      columns: 1,
      variant: 'todo',
      checked: false,
      indent: 1,
    });
  });

  it('follows a quote or heading with body text', () => {
    expect(continuationOf(para('p', '', { variant: 'quote' }), 'n', '')).not.toHaveProperty('variant');
    expect(continuationOf({ id: 'h', type: 'heading', level: 1, html: '' }, 'n', '')).toMatchObject({ type: 'paragraph' });
  });
});

describe('markdownPrefixKind', () => {
  it.each([
    ['#', 'h1'],
    ['##', 'h2'],
    ['###', 'h3'],
    ['-', 'bullet'],
    ['*', 'bullet'],
    ['1.', 'numbered'],
    ['12)', 'numbered'],
    ['[]', 'todo'],
    ['[x]', 'todo'],
    ['>', 'quote'],
    ['"', 'quote'],
    ['!>', 'callout'],
  ])('%s → %s', (prefix, kind) => {
    expect(markdownPrefixKind(prefix)).toBe(kind);
  });

  it('ignores prose', () => {
    expect(markdownPrefixKind('Hello')).toBeNull();
    expect(markdownPrefixKind('####')).toBeNull();
    expect(markdownPrefixKind(' #')).toBeNull();
  });
});

describe('listNumbers', () => {
  it('numbers runs from 1, continues a parent after a nested run, and restarts after other blocks', () => {
    const blocks: Block[] = [
      para('a', '', { variant: 'numbered' }),
      para('b', '', { variant: 'numbered' }),
      para('b1', '', { variant: 'numbered', indent: 1 }),
      para('b2', '', { variant: 'numbered', indent: 1 }),
      para('c', '', { variant: 'numbered' }),
      para('gap', 'text'),
      para('d', '', { variant: 'numbered' }),
      para('e', '', { variant: 'bullet' }),
      para('f', '', { variant: 'numbered' }),
    ];
    const numbers = listNumbers(blocks);
    expect(Object.fromEntries(numbers)).toEqual({ a: 1, b: 2, b1: 1, b2: 2, c: 3, d: 1, f: 1 });
  });
});

describe('kindOf and text helpers', () => {
  it('names every block by its kind', () => {
    expect(kindOf({ id: 'h', type: 'heading', level: 3, html: '' })).toBe('h3');
    expect(kindOf({ id: 'c', type: 'code', text: '' })).toBe('code');
    expect(kindOf(para('p'))).toBe('text');
    expect(kindOf(para('p', '', { variant: 'callout' }))).toBe('callout');
    expect(kindOf({ id: 'd', type: 'code', text: 'flowchart LR', language: 'mermaid' })).toBe('diagram');
    expect(kindOf({ id: 'd', type: 'code', text: 'graph TD', language: 'Mermaid' })).toBe('diagram');
  });

  it('round-trips text through html', () => {
    const text = 'a < b & c\nnext';
    expect(htmlToText(textToHtml(text))).toBe(text);
  });
});

describe('diagrams', () => {
  it('is offered as a kind, so the slash menu and Turn into list it', () => {
    expect(BLOCK_KINDS.find((kind) => kind.id === 'diagram')).toMatchObject({
      label: 'Diagram',
      keywords: expect.arrayContaining(['mermaid', 'flowchart']),
    });
  });

  it('is stored as a mermaid code block, which the canonical model already accepts', () => {
    expect(blankBlockOfKind('d', 'diagram')).toEqual({ id: 'd', type: 'code', text: '', language: 'mermaid' });
  });

  it('keeps prose as the diagram source, and the source when turned back into text', () => {
    const diagram = convertBlock(para('p', 'flowchart LR<br>A --&gt; B', { locked: false, aiHidden: true }), 'diagram');
    expect(diagram).toEqual({
      id: 'p',
      type: 'code',
      text: 'flowchart LR\nA --> B',
      language: 'mermaid',
      locked: false,
      aiHidden: true,
    });
    expect(convertBlock(diagram, 'text')).toMatchObject({ type: 'paragraph', html: 'flowchart LR<br>A --&gt; B' });
  });

  it('becomes plain code when turned into Code, and a diagram again from code', () => {
    const diagram: Block = { id: 'd', type: 'code', text: 'pie\n "A": 1', language: 'mermaid' };
    const code = convertBlock(diagram, 'code');
    expect(code).toEqual({ id: 'd', type: 'code', text: 'pie\n "A": 1' });
    expect(isDiagramBlock(code)).toBe(false);

    const python: Block = { id: 'c', type: 'code', text: 'print(1)', language: 'python' };
    expect(convertBlock(python, 'code')).toEqual(python);
    expect(convertBlock(python, 'diagram')).toEqual({ ...python, language: 'mermaid' });
  });

  it('recognises only mermaid code blocks as diagrams', () => {
    expect(isDiagramBlock({ id: 'd', type: 'code', text: '', language: 'mermaid' })).toBe(true);
    expect(isDiagramBlock({ id: 'c', type: 'code', text: '' })).toBe(false);
    expect(isDiagramBlock(para('p', 'mermaid'))).toBe(false);
    expect(isDiagramBlock(undefined)).toBe(false);
  });
});

describe('structured figures', () => {
  it('is offered as a kind of its own, next to Mermaid diagrams', () => {
    expect(BLOCK_KINDS.find((kind) => kind.id === 'figure')).toMatchObject({
      label: 'Figure',
      keywords: expect.arrayContaining(['architecture', 'attention', 'tikz']),
    });
    expect(kindOf({ id: 'f', type: 'code', text: '{}', language: 'figure' })).toBe('figure');
    expect(kindOf({ id: 'f', type: 'code', text: '{}', language: 'Figure' })).toBe('figure');
  });

  it('is stored as a figure code block, which the canonical model already accepts', () => {
    expect(blankBlockOfKind('f', 'figure')).toEqual({ id: 'f', type: 'code', text: '', language: 'figure' });
  });

  it('keeps prose as the caption of an empty spec, so nothing written is lost', () => {
    const figure = convertBlock(para('p', 'The MLA mechanism', { aiHidden: true }), 'figure');
    expect(figure).toMatchObject({ id: 'p', type: 'code', language: 'figure', aiHidden: true });
    expect(figure.type === 'code' && JSON.parse(figure.text)).toEqual({ caption: 'The MLA mechanism', nodes: [] });
  });

  it('keeps a code source, and drops the tag when turned into plain code', () => {
    const spec = '{"nodes": ["a"]}';
    const figure = convertBlock({ id: 'c', type: 'code', text: spec, language: 'json' }, 'figure');
    expect(figure).toEqual({ id: 'c', type: 'code', text: spec, language: 'figure' });
    const code = convertBlock(figure, 'code');
    expect(code).toEqual({ id: 'c', type: 'code', text: spec });
    expect(isFigureBlock(code)).toBe(false);
    expect(isFigureBlock(figure)).toBe(true);
    expect(isDiagramBlock(figure)).toBe(false);
  });

  it('numbers only captioned figures, in document order', () => {
    const blocks: Block[] = [
      { id: 'a', type: 'code', text: 'captioned', language: 'figure' },
      { id: 'm', type: 'code', text: 'flowchart LR', language: 'mermaid' },
      { id: 'b', type: 'code', text: 'plain', language: 'figure' },
      para('p', 'text'),
      { id: 'c', type: 'code', text: 'captioned too', language: 'figure' },
    ];
    const numbers = figureNumbers(blocks, (source) => (source.startsWith('captioned') ? 'x' : null));
    expect(Object.fromEntries(numbers)).toEqual({ a: 1, c: 2 });
  });
});
