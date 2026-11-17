import { describe, expect, it } from 'vitest';
import { hideFigureGaps, normalizeEditableHtml, serializeEditableHtml } from './editableHtml';

function rootWith(innerHTML: string): HTMLDivElement {
  const root = document.createElement('div');
  root.innerHTML = innerHTML;
  return root;
}

describe('serializeEditableHtml', () => {
  it('empties widget placeholders, keeping only the placeholder span', () => {
    const root = rootWith(
      '<span data-child-id="c1"><button>widget chrome</button></span>',
    );
    expect(serializeEditableHtml(root)).toBe(
      '<span data-child-id="c1" contenteditable="false"></span>',
    );
  });

  it('keeps the text and markup around a widget', () => {
    const root = rootWith(
      'a <strong>bold</strong> <span data-child-id="c1">[1]</span> phrase',
    );
    expect(serializeEditableHtml(root)).toBe(
      'a <strong>bold</strong> <span data-child-id="c1" contenteditable="false"></span> phrase',
    );
  });

  it('writes block markup the browser made as the API stores it', () => {
    // Expected values are the API's sanitizer output for the same html
    // (`sanitize_inline_html`), so the typed paragraph is saved as stored.
    expect(serializeEditableHtml(rootWith('Typed<div>new line</div><div><br></div>'))).toBe(
      'Typed<span class="legacy-block">new line</span><span class="legacy-block"><br></span>',
    );
    expect(serializeEditableHtml(rootWith('<p dir="ltr">a</p><h2 class="x">Results</h2>tail'))).toBe(
      '<span class="legacy-block">a</span><span class="legacy-block">Results</span>tail',
    );
    // A widget's own markup is emptied out, not rewritten.
    expect(serializeEditableHtml(rootWith('<span data-child-id="c1"><div>chrome</div></span>'))).toBe(
      '<span data-child-id="c1" contenteditable="false"></span>',
    );
  });

  it('leaves the live DOM untouched while it serializes', () => {
    const root = rootWith('<span data-child-id="c1"><button>widget chrome</button></span>');
    serializeEditableHtml(root);
    expect(root.querySelector('button')).not.toBeNull();
  });

  it('hides the space after a figure without changing the text or the html', () => {
    const html = 'Table <span data-child-id="t1" contenteditable="false"></span> compares perplexity.';
    const root = rootWith(html);
    root.querySelector('[data-child-id]')!.innerHTML = '<div class="inline-figure">table</div>';
    const text = root.textContent;

    hideFigureGaps(root);

    expect(root.querySelector('[data-figure-gap]')?.textContent).toBe(' ');
    expect(root.textContent).toBe(text);
    expect(serializeEditableHtml(root)).toBe(html);
  });

  it('leaves the space after an inline widget alone', () => {
    const root = rootWith('as shown <span data-child-id="c1">[1]</span> here');
    hideFigureGaps(root);
    expect(root.querySelector('[data-figure-gap]')).toBeNull();
  });
});

describe('normalizeEditableHtml', () => {
  it('writes html the way serialization would', () => {
    expect(normalizeEditableHtml("a <span data-child-id='c1'></span>&amp; b")).toBe(
      'a <span data-child-id="c1" contenteditable="false"></span>&amp; b',
    );
  });
});
