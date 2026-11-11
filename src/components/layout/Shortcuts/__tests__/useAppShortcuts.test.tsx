import { afterEach, describe, expect, it } from 'vitest';
import { inForeignTextField } from '../useAppShortcuts';

afterEach(() => {
  document.body.innerHTML = '';
});

function mount(html: string): HTMLElement {
  document.body.innerHTML = html;
  return document.querySelector<HTMLElement>('[data-target]')!;
}

describe('whose undo Mod+Z is', () => {
  it('is the document\u2019s inside a block', () => {
    const block = mount('<div class="canvas"><div class="editable" contenteditable="true" data-target></div></div>');
    expect(inForeignTextField(block)).toBe(false);
  });

  it('is the title\u2019s own inside the page title, although it sits in the canvas', () => {
    // The title commits on blur; the document journal has no entry for what
    // is being typed there, so its undo would rewind the body instead.
    const title = mount(
      '<div class="canvas"><h1><span data-page-title contenteditable="plaintext-only" data-target></span></h1></div>',
    );
    expect(inForeignTextField(title)).toBe(true);
  });

  it('is the field\u2019s own in inputs, textareas and editables outside the page', () => {
    expect(inForeignTextField(mount('<input data-target />'))).toBe(true);
    expect(inForeignTextField(mount('<textarea data-target></textarea>'))).toBe(true);
    expect(inForeignTextField(mount('<aside><div contenteditable="true" data-target></div></aside>'))).toBe(true);
  });

  it('is the document\u2019s when no text field has focus', () => {
    expect(inForeignTextField(mount('<button data-target>Save</button>'))).toBe(false);
    expect(inForeignTextField(null)).toBe(false);
  });
});
