import { describe, expect, it } from 'vitest';
import { indexOfSelection, positionOfIndex, renderInto, spliceText, textOf } from '../domText';

/**
 * The composer's model is a string; its DOM is whatever the browser felt like
 * producing. These are the rules that keep the two in agreement.
 */

function host(html: string): HTMLDivElement {
  const element = document.createElement('div');
  element.innerHTML = html;
  return element;
}

const chip = (refText: string) =>
  `<span data-ref-text="${refText}" contenteditable="false"><span>Doc</span><button>×</button></span>`;

describe('reading the model out of the DOM', () => {
  it('reads plain text', () => {
    expect(textOf(host('hello'))).toBe('hello');
  });

  it('counts a reference chip as its reference text, not its label', () => {
    expect(textOf(host(`see ${chip('#doc/abc')} please`))).toBe('see #doc/abc please');
  });

  it('reads a <br> as a newline', () => {
    // The old reader counted a <br> as nothing at all, so every character the
    // author typed after a line break was dropped from the sent message.
    expect(textOf(host('first<br>second'))).toBe('first\nsecond');
  });

  it('reads a browser-inserted block wrapper as a newline', () => {
    expect(textOf(host('first<div>second</div>'))).toBe('first\nsecond');
  });

  it('ignores the filler that keeps a trailing blank line visible', () => {
    const element = host('');
    renderInto(element, ['line\n']);
    expect(textOf(element)).toBe('line\n');
  });
});

describe('mapping between the caret and the model', () => {
  it('locates a caret inside a text node', () => {
    const element = host('hello');
    expect(indexOfSelection(element, element.firstChild!, 3)).toBe(3);
  });

  it('locates a caret after a chip', () => {
    const element = host(`${chip('#doc/abc')}!`);
    expect(indexOfSelection(element, element, 1)).toBe('#doc/abc'.length);
  });

  it('reports nothing for a selection outside the host', () => {
    const element = host('hello');
    expect(indexOfSelection(element, document.createElement('p'), 0)).toBeNull();
  });

  it('round-trips an index through the DOM and back', () => {
    const element = host(`ask ${chip('#doc/abc')} now`);
    for (const index of [0, 2, 4, 12, 15]) {
      const position = positionOfIndex(element, index);
      expect(indexOfSelection(element, position.node, position.offset)).toBe(index);
    }
  });

  it('puts an index past the end at the end', () => {
    const element = host('hi');
    const position = positionOfIndex(element, 99);
    expect(indexOfSelection(element, position.node, position.offset)).toBe(2);
  });
});

describe('inserting text', () => {
  it('splices at the caret', () => {
    expect(spliceText('ab', { start: 1, end: 1 }, 'X')).toEqual({ value: 'aXb', caret: 2 });
  });

  it('replaces a selection', () => {
    expect(spliceText('abcd', { start: 1, end: 3 }, 'X')).toEqual({ value: 'aXd', caret: 2 });
  });

  it('trims a paste to what is left of the limit', () => {
    expect(spliceText('abc', { start: 3, end: 3 }, 'defgh', 5)).toEqual({
      value: 'abcde',
      caret: 5,
    });
  });

  it('refuses a paste with no room at all', () => {
    expect(spliceText('abcde', { start: 5, end: 5 }, 'f', 5)).toEqual({ value: 'abcde', caret: 5 });
  });

  it('counts the replaced selection as room', () => {
    expect(spliceText('abcde', { start: 0, end: 5 }, 'xyz', 5)).toEqual({ value: 'xyz', caret: 3 });
  });
});
