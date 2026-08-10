import { describe, expect, it } from 'vitest';
import { serializeEditableHtml } from './editableHtml';

function rootWith(innerHTML: string): HTMLDivElement {
  const root = document.createElement('div');
  root.innerHTML = innerHTML;
  return root;
}

describe('serializeEditableHtml', () => {
  it('persists the struck-through original of a pending suggestion, not the suggestion UI', () => {
    // Typing elsewhere in the paragraph while the toolbar streams a
    // suggestion serializes through here; the ✓/✕/■ buttons must not reach
    // the document.
    const root = rootWith(
      'before <span class="ai-suggest">' +
        '<span class="ai-original">old text</span>' +
        '<span class="ai-generated">streamed new text</span>' +
        '<span class="ai-controls"><button>✓</button><button>✕</button></span>' +
        '</span> after',
    );
    expect(serializeEditableHtml(root)).toBe('before old text after');
  });

  it('keeps markup nested inside the original', () => {
    const root = rootWith(
      '<span class="ai-suggest">' +
        '<span class="ai-original">a <strong>bold</strong> phrase</span>' +
        '<span class="ai-generated">replacement</span>' +
        '</span>',
    );
    expect(serializeEditableHtml(root)).toBe('a <strong>bold</strong> phrase');
  });

  it('drops a suggestion whose original is already gone', () => {
    const root = rootWith(
      'keep <span class="ai-suggest"><span class="ai-generated">orphan</span></span> text',
    );
    expect(serializeEditableHtml(root)).toBe('keep  text');
  });

  it('leaves the live DOM untouched while it serializes', () => {
    const root = rootWith(
      '<span class="ai-suggest"><span class="ai-original">old</span></span>',
    );
    serializeEditableHtml(root);
    expect(root.querySelector('.ai-suggest')).not.toBeNull();
  });

  it('still empties widget placeholders alongside the suggestion handling', () => {
    const root = rootWith(
      '<span data-child-id="c1"><button>widget chrome</button></span>',
    );
    expect(serializeEditableHtml(root)).toBe(
      '<span data-child-id="c1" contenteditable="false"></span>',
    );
  });
});
