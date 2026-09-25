import { describe, it, expect } from 'vitest';
import { sanitizeEditableHtml, sanitizeInlineFragment } from './sanitize';

/**
 * The editor renders block html via `innerHTML`, so the ingest boundary is the
 * one gate that keeps stored XSS out of the document model. These cover the
 * vectors that previously reached the canvas: event-handler attributes,
 * `javascript:` URLs, active/embed elements, and browser-default paste.
 */
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
    expect(sanitizeEditableHtml('<a href="https://example.com">x</a>')).toBe(
      '<a href="https://example.com/" rel="noopener noreferrer">x</a>',
    );
  });

  it('keeps inline formatting and strips unknown tags but not their text', () => {
    expect(sanitizeEditableHtml('a <b>b</b> <i>c</i> <font color="red">d</font>')).toBe(
      'a <b>b</b> <i>c</i> d',
    );
  });

  it('keeps browser line-wrapping divs but strips their attributes', () => {
    expect(sanitizeEditableHtml('<div>line1</div><div>line2</div>')).toBe(
      '<div>line1</div><div>line2</div>',
    );
    expect(sanitizeEditableHtml('<div onclick="alert(1)" class="x">line</div>')).toBe(
      '<div>line</div>',
    );
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
    expect(sanitizeEditableHtml(`<span data-child-id="${'a'.repeat(200)}"></span>`)).toBe('');
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
