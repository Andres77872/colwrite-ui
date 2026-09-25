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
