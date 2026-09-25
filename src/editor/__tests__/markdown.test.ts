import { describe, expect, it } from 'vitest';
import {
  blocksToHtml,
  blocksToMarkdown,
  citationLookup,
  htmlToBlocks,
  inlineMarkdownToHtml,
  looksLikeMarkdownBlocks,
  markdownToBlocks,
} from '../markdown';
import type { Block, CitationChild, ParagraphBlock } from '../types';

function shape(blocks: Block[]) {
  return blocks.map((block) => {
    if (block.type === 'paragraph') {
      return {
        type: block.type,
        html: block.html.replace(/data-child-id="[^"]+"/g, 'data-child-id="*"'),
        ...(block.variant ? { variant: block.variant } : {}),
        ...(block.indent ? { indent: block.indent } : {}),
        ...(block.checked !== undefined ? { checked: block.checked } : {}),
        children: (block.children ?? []).map((child) => child.type),
      };
    }
    if (block.type === 'heading') return { type: block.type, level: block.level, html: block.html };
    if (block.type === 'code') return { type: block.type, text: block.text, language: block.language };
    return { type: block.type };
  });
}

describe('markdownToBlocks', () => {
  it('maps headings, paragraphs and rules', () => {
    expect(shape(markdownToBlocks('# Title\n\nFirst line\ncontinues.\n\n---\n\n#### Deep'))).toEqual([
      { type: 'heading', level: 1, html: 'Title' },
      { type: 'paragraph', html: 'First line continues.', children: [] },
      { type: 'divider' },
      { type: 'heading', level: 3, html: 'Deep' },
    ]);
  });

  it('nests lists by indentation and reads to-dos', () => {
    const blocks = markdownToBlocks('- one\n  - one.a\n    1. deep\n- [x] done\n- [ ] open\n2. two');
    expect(shape(blocks)).toEqual([
      { type: 'paragraph', html: 'one', variant: 'bullet', children: [] },
      { type: 'paragraph', html: 'one.a', variant: 'bullet', indent: 1, children: [] },
      { type: 'paragraph', html: 'deep', variant: 'numbered', indent: 2, children: [] },
      { type: 'paragraph', html: 'done', variant: 'todo', checked: true, children: [] },
      { type: 'paragraph', html: 'open', variant: 'todo', checked: false, children: [] },
      { type: 'paragraph', html: 'two', variant: 'numbered', children: [] },
    ]);
  });

  it('keeps code verbatim with its language', () => {
    expect(shape(markdownToBlocks('```python\nif x:\n    y = "<b>"\n```'))).toEqual([
      { type: 'code', text: 'if x:\n    y = "<b>"', language: 'python' },
    ]);
  });

  it('turns maths into equation widgets, but not prices', () => {
    const [inline] = markdownToBlocks('Energy $E=mc^2$ costs $5 and $10.') as ParagraphBlock[];
    expect(inline.children).toHaveLength(1);
    expect(inline.children?.[0]).toMatchObject({ type: 'equation', latex: 'E=mc^2' });
    expect(inline.html).toContain('$5 and $10');

    const [display] = markdownToBlocks('$$\n\\int_0^1 x\\,dx\n$$') as ParagraphBlock[];
    expect(display.children?.[0]).toMatchObject({ type: 'equation', latex: '\\int_0^1 x\\,dx', display: true });

    const [bracket] = markdownToBlocks('\\[ a^2 + b^2 \\]') as ParagraphBlock[];
    expect(bracket.children?.[0]).toMatchObject({ display: true, latex: 'a^2 + b^2' });
  });

  it('reads pipe tables into a table widget with alignment', () => {
    const [block] = markdownToBlocks('| Model | Acc |\n|:--|--:|\n| A | 0.9 |\n| B | 0.8 |') as ParagraphBlock[];
    expect(block.children?.[0]).toMatchObject({
      type: 'table',
      rows: 3,
      cols: 2,
      header: true,
      data: [['Model', 'Acc'], ['A', '0.9'], ['B', '0.8']],
      align: ['left', 'right'],
    });
  });

  it('reads quotes and GitHub-style callouts', () => {
    expect(shape(markdownToBlocks('> quoted\n> more\n\n> [!NOTE]\n> careful'))).toEqual([
      { type: 'paragraph', html: 'quoted more', variant: 'quote', children: [] },
      { type: 'paragraph', html: 'careful', variant: 'callout', children: [] },
    ]);
  });

  it('only makes citations out of keys the text already carried', () => {
    const known: CitationChild = {
      id: 'c1',
      type: 'citation',
      keys: ['10.1/real'],
      sources: [{ key: '10.1/real', title: 'Real paper', year: '2020' }],
    };
    const lookup = new Map([['10.1/real', known]]);
    const [block] = markdownToBlocks('Shown [@10.1/real, p. 4] and [@10.9/invented].', {
      citations: lookup,
    }) as ParagraphBlock[];

    expect(block.children).toHaveLength(1);
    expect(block.children?.[0]).toMatchObject({
      type: 'citation',
      keys: ['10.1/real'],
      locator: 'p. 4',
      sources: [{ title: 'Real paper' }],
    });
    // The invented key stays text, never a widget.
    expect(block.html).toContain('[@10.9/invented]');
  });
});

describe('inline markdown', () => {
  it('formats emphasis, code and safe links', () => {
    const { html } = inlineMarkdownToHtml('**bold** *it* `a*b` ~~gone~~ [site](https://example.com) [bad](javascript:alert(1))');
    expect(html).toContain('<strong>bold</strong>');
    expect(html).toContain('<em>it</em>');
    expect(html).toContain('<code>a*b</code>');
    expect(html).toContain('<s>gone</s>');
    expect(html).toContain('<a href="https://example.com/">site</a>');
    // An unsafe target stays visible text; it never becomes a link.
    expect(html).not.toContain('href="javascript');
    expect(html).toContain('[bad](javascript:alert(1))');
  });

  it('escapes html in the text', () => {
    expect(inlineMarkdownToHtml('<img src=x onerror=alert(1)>').html).toBe('&lt;img src=x onerror=alert(1)&gt;');
  });

  it('leaves snake_case alone', () => {
    expect(inlineMarkdownToHtml('a_b_c').html).toBe('a_b_c');
  });
});

describe('blocksToMarkdown', () => {
  it('round-trips lists, headings, code and citations', () => {
    const source = '## Methods\n\n- first\n  - nested\n1. step\n\n```sql\nSELECT 1;\n```';
    expect(blocksToMarkdown(markdownToBlocks(source))).toBe(
      '## Methods\n\n- first\n  - nested\n1. step\n\n```sql\nSELECT 1;\n```',
    );
  });

  it('writes citations as pandoc markers and maths as dollars', () => {
    const block: ParagraphBlock = {
      id: 'p',
      type: 'paragraph',
      html: 'See <span data-child-id="c" contenteditable="false"></span> and <span data-child-id="e" contenteditable="false"></span>.',
      children: [
        { id: 'c', type: 'citation', keys: ['10.1/a', '2101.00001'], locator: 'p. 2' },
        { id: 'e', type: 'equation', latex: 'x^2' },
      ],
    };
    expect(blocksToMarkdown([block])).toBe('See [@10.1/a; @2101.00001, p. 2] and $x^2$.');
    expect(citationLookup([block]).get('10.1/a')?.id).toBe('c');
  });
});

describe('htmlToBlocks', () => {
  it('reads structure from pasted html', () => {
    const blocks = htmlToBlocks(
      '<h2>Heading</h2><p>Para <b>bold</b></p><ul><li>one<ul><li>inner</li></ul></li><li><input type="checkbox" checked> task</li></ul><blockquote>q</blockquote><pre>code</pre>',
    );
    expect(shape(blocks)).toEqual([
      { type: 'heading', level: 2, html: 'Heading' },
      { type: 'paragraph', html: 'Para <b>bold</b>', children: [] },
      { type: 'paragraph', html: 'one', variant: 'bullet', children: [] },
      { type: 'paragraph', html: 'inner', variant: 'bullet', indent: 1, children: [] },
      { type: 'paragraph', html: 'task', variant: 'todo', checked: true, children: [] },
      { type: 'paragraph', html: 'q', variant: 'quote', children: [] },
      { type: 'code', text: 'code', language: undefined },
    ]);
  });

  it('leaves an inline fragment to the inline paste', () => {
    expect(htmlToBlocks('<span>just <b>a phrase</b></span>')).toEqual([]);
  });

  it('drops scripts and handlers', () => {
    const blocks = htmlToBlocks('<p>a<script>alert(1)</script></p><p onclick="x()">b</p>');
    const html = blocks.map((block) => (block.type === 'paragraph' ? block.html : '')).join('');
    expect(html).not.toContain('script');
    expect(html).not.toContain('onclick');
  });
});

describe('clipboard helpers', () => {
  it('knows when plain text has block structure', () => {
    expect(looksLikeMarkdownBlocks('just one line')).toBe(false);
    expect(looksLikeMarkdownBlocks('- a\n- b')).toBe(true);
    expect(looksLikeMarkdownBlocks('para one\n\npara two')).toBe(true);
  });

  it('writes nested semantic html', () => {
    const html = blocksToHtml(markdownToBlocks('- a\n  - b\n1. c'));
    expect(html).toBe('<ul><li>a<ul><li>b</li></ul></li></ul><ol><li>c</li></ol>');
  });
});

describe('diagrams through the clipboard', () => {
  const diagram: Block = { id: 'd', type: 'code', text: 'flowchart LR\n  A --> B', language: 'mermaid' };

  it('round-trips a mermaid block through markdown', () => {
    const markdown = blocksToMarkdown([diagram]);
    expect(markdown).toBe('```mermaid\nflowchart LR\n  A --> B\n```');
    expect(markdownToBlocks(markdown)).toMatchObject([{ type: 'code', text: diagram.text, language: 'mermaid' }]);
  });

  it('round-trips a mermaid block through html, keeping it a diagram', () => {
    // A lone block is not "structured" html (see htmlToBlocks), so a divider
    // rides along.
    const html = blocksToHtml([diagram, { id: 'hr', type: 'divider' }]);
    expect(html).toContain('<code class="language-mermaid">');
    expect(htmlToBlocks(html)).toMatchObject([
      { type: 'code', text: diagram.text, language: 'mermaid' },
      { type: 'divider' },
    ]);
  });

  it("reads GitHub's <pre lang> and ignores a language the model would reject", () => {
    expect(htmlToBlocks('<pre lang="mermaid">pie\n "A": 1</pre><hr>')).toMatchObject([{ language: 'mermaid' }, {}]);
    const [block] = htmlToBlocks('<pre><code class="language-a b">x</code></pre><p>after</p>');
    expect(block).toMatchObject({ type: 'code', language: 'a' });
    const [bad] = htmlToBlocks('<pre><code class="language-<x>">x</code></pre><p>after</p>');
    expect(bad).not.toHaveProperty('language');
  });
});
