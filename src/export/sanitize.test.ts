import { describe, it, expect } from 'vitest';
import { sanitizeEditableHtml, sanitizeInlineFragment } from './sanitize';

/**
 * The editor renders block html via `innerHTML`, so the ingest boundary is the
 * one gate that keeps stored XSS out of the document model. These cover the
 * vectors that previously reached the canvas: event-handler attributes,
 * `javascript:` URLs, active/embed elements, and browser-default paste.
 */
/**
 * Inputs and the html the API stores for each, computed with the API's own
 * sanitizer (`sanitize_inline_html` in
 * `ColWrite-api/src/documents/domain/validation.py`, Python 3.13.18). The
 * editor writes the same bytes, so a page holds what the server stores.
 */
const AS_THE_API_STORES: ReadonlyArray<readonly [string, ReadonlyArray<readonly [string, string]>]> = [
  ['block markup inside a paragraph', [
    ['<div>line1</div><div>line2</div>', '<span class="legacy-block">line1</span><span class="legacy-block">line2</span>'],
    ['<p>x</p>', '<span class="legacy-block">x</span>'],
    ['before <h2>Results</h2> after', 'before <span class="legacy-block">Results</span> after'],
    ['<div onclick="x()" class="y" style="color:red">line</div>', '<span class="legacy-block">line</span>'],
    ['<P>Upper</P><H3>three</H3><h4>4</h4><h5>5</h5><h6>6</h6>', '<span class="legacy-block">Upper</span><span class="legacy-block">three</span><span class="legacy-block">4</span><span class="legacy-block">5</span><span class="legacy-block">6</span>'],
    ['<div><br></div>', '<span class="legacy-block"><br></span>'],
    ['<div/>tail', '<span class="legacy-block"></span>tail'],
    ['<span class="legacy-block"><span class="legacy-block">a</span>b</span>', '<span class="legacy-block"><span class="legacy-block">a</span>b</span>'],
  ]],
  ['tags nested as written, not re-nested as a browser would', [
    ['<p>a<div>b</div>c</p>', '<span class="legacy-block">a<span class="legacy-block">b</span>c</span>'],
    ['<h1><p>x</h1>y', '<span class="legacy-block"><span class="legacy-block">x</span></span>y'],
    ['<b>one<i>two</b>three</i>', '<b>one<i>two</i></b>three'],
    ['<b>x<p>y</b>z</p>', '<b>x<span class="legacy-block">y</span></b>z'],
    ['a</br>b', 'ab'],
  ]],
  ['a paste from a word processor', [
    ['<meta charset="utf-8"><b style="font-weight:normal;" id="docs-internal-guid-1"><p dir="ltr" style="line-height:1.38"><span style="font-size:11pt">Hello&nbsp;world</span></p><p dir="ltr"><span>Second</span></p></b><br class="Apple-interchange-newline">', '<b><span class="legacy-block"><span>Hello\u00a0world</span></span><span class="legacy-block"><span>Second</span></span></b><br>'],
  ]],
  ['links kept as written', [
    ['<a href="https://example.test">x</a>', '<a href="https://example.test" rel="noopener noreferrer">x</a>'],
    ['<a href="https://Example.test">x</a>', '<a href="https://Example.test" rel="noopener noreferrer">x</a>'],
    ['<a href="https://@x.test">x</a>', '<a href="https://@x.test" rel="noopener noreferrer">x</a>'],
    ['<a href="https://:pw@x.test">x</a>', '<a>x</a>'],
    ['<a href="https://ex%zz.test">x</a>', '<a href="https://ex%zz.test" rel="noopener noreferrer">x</a>'],
    ['<a href="http://x.test\ufeff">bom</a>', '<a href="http://x.test\ufeff" rel="noopener noreferrer">bom</a>'],
    ['<a href="http://x.test\u00a0">nbsp</a>', '<a>nbsp</a>'],
    ['<a title="Don\'t &amp; &quot;q&quot; <x>">t</a>', '<a title="Don&#x27;t &amp; &quot;q&quot; &lt;x&gt;">t</a>'],
  ]],
  ['placeholders', [
    ['<span data-child-id="it\'s"></span>', '<span data-child-id="it&#x27;s" contenteditable="false"></span>'],
    ['<span contenteditable="true" class="w" data-child-id="c1">x<span>y</span>z</span>after', '<span data-child-id="c1" contenteditable="false"></span>after'],
  ]],
  ['raw text elements', [
    ['<xmp><b>x</b></xmp>', '&lt;b&gt;x&lt;/b&gt;'],
    ['<textarea>&amp;<b></textarea>', '&amp;&lt;b&gt;'],
    ['<script>a<b>c</b></script>d', 'd'],
    ['<plaintext><b>x', '&lt;b&gt;x'],
    ['<script/>after', ''],
  ]],
];

describe('sanitizeEditableHtml', () => {
  it('strips event-handler attributes', () => {
    expect(sanitizeEditableHtml('<img src=x onerror="alert(1)">')).toBe('');
    expect(sanitizeEditableHtml('<b onclick="alert(1)">hi</b>')).toBe('<b>hi</b>');
  });

  it('drops active elements with their content', () => {
    expect(sanitizeEditableHtml('<script>alert(1)</script>ok')).toBe('ok');
    expect(sanitizeEditableHtml('<iframe src="https://evil"></iframe>ok')).toBe('ok');
    expect(sanitizeEditableHtml('<svg onload="alert(1)"></svg>ok')).toBe('ok');
  });

  it('keeps only safe http(s) link hrefs', () => {
    expect(sanitizeEditableHtml('<a href="javascript:alert(1)">x</a>')).toBe('<a>x</a>');
    // As written: the server stores the link unchanged, so the editor must too.
    expect(sanitizeEditableHtml('<a href="https://example.com">x</a>')).toBe(
      '<a href="https://example.com" rel="noopener noreferrer">x</a>',
    );
  });

  it('keeps inline formatting and strips unknown tags but not their text', () => {
    expect(sanitizeEditableHtml('a <b>b</b> <i>c</i> <font color="red">d</font>')).toBe(
      'a <b>b</b> <i>c</i> d',
    );
  });

  for (const [group, cases] of AS_THE_API_STORES) {
    it(`writes ${group} as the API stores it`, () => {
      for (const [input, stored] of cases) {
        expect(sanitizeEditableHtml(input), input).toBe(stored);
        // What the server stores comes back unchanged.
        expect(sanitizeEditableHtml(stored), stored).toBe(stored);
      }
    });
  }

  it('keeps an id of up to 200 characters, as the API does', () => {
    const id = 'c'.repeat(200);
    expect(sanitizeEditableHtml(`<span data-child-id="${id}"></span>`)).toBe(`<span data-child-id="${id}" contenteditable="false"></span>`);
    expect(sanitizeEditableHtml(`<span data-child-id="${id}c">x</span>y`)).toBe('y');
  });

  it('keeps the class of a span the API flattened block markup into, and no other class', () => {
    // As the API's sanitizer: `span.legacy-block` is what it stores for a
    // `<div>` or `<p>` inside a paragraph, and a save must send it back.
    expect(sanitizeEditableHtml('<span class="legacy-block">one <b>two</b></span>')).toBe('<span class="legacy-block">one <b>two</b></span>');
    expect(sanitizeInlineFragment('<span class="legacy-block">x</span>').html).toBe('<span class="legacy-block">x</span>');
    expect(sanitizeEditableHtml('<span class="legacy-block other" onclick="x()">a</span><span class="note">b</span>')).toBe('<span>a</span><span>b</span>');
  });

  it('preserves widget placeholder spans by default, in the canonical non-editable form', () => {
    // The API's sanitizer writes the same shape; without the attribute a
    // loaded placeholder was editable until its paragraph was re-serialized.
    expect(sanitizeEditableHtml('x<span data-child-id="abc123"></span>y')).toBe(
      'x<span data-child-id="abc123" contenteditable="false"></span>y',
    );
  });

  it('drops placeholder spans when asked (paste: children do not travel with a copy)', () => {
    expect(
      sanitizeEditableHtml('x<span data-child-id="abc123"></span>y', { placeholders: 'drop' }),
    ).toBe('xy');
  });

  it('strips placeholder spans with junk or over-long ids', () => {
    expect(sanitizeEditableHtml('<span data-child-id="  "></span>')).toBe('');
    expect(sanitizeEditableHtml(`<span data-child-id="${'a'.repeat(201)}"></span>`)).toBe('');
  });
});

describe('sanitizeInlineFragment (export path, unchanged)', () => {
  it('still replaces placeholders with markers and keeps ids aside', () => {
    const fragment = sanitizeInlineFragment('a<span data-child-id="k1"></span>b');
    expect(fragment.placeholderIds).toEqual(['k1']);
    expect(fragment.html).not.toContain('data-child-id');
    expect(fragment.html).toContain('a');
    expect(fragment.html).toContain('b');
  });

  it('still flattens legacy blocks to styled spans', () => {
    expect(sanitizeInlineFragment('<div>x</div>').html).toBe('<span class="legacy-block">x</span>');
  });
});
