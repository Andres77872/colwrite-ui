import { afterEach, describe, expect, it } from 'vitest';
import { act, cleanup, render, renderHook } from '@testing-library/react';
import {
  MAX_FOCUS_SELECTION_CHARS,
  currentFocus,
  forgetCaret,
  useEditorFocus,
  useRememberCaret,
} from './citeAtCursor';

function Tracker() {
  useRememberCaret();
  return (
    <div data-block-id="p1">
      <div className="editable" data-testid="p1">
        Transformers <strong>changed</strong> NLP
        <span data-child-id="c1" contentEditable={false}>[1]</span>.
      </div>
    </div>
  );
}

/** Put the document selection on `range` and tell the tracker, as a browser would. */
function select(range: (element: HTMLElement) => Range, element: HTMLElement) {
  act(() => {
    const selection = window.getSelection()!;
    selection.removeAllRanges();
    selection.addRange(range(element));
    document.dispatchEvent(new Event('selectionchange'));
  });
}

afterEach(() => {
  cleanup();
  forgetCaret();
});

describe('the author’s focus', () => {
  it('is the caret’s block, with no selection while the caret is collapsed', () => {
    const { getByTestId } = render(<Tracker />);
    select((element) => {
      const range = document.createRange();
      range.setStart(element.firstChild!, 3);
      return range;
    }, getByTestId('p1'));

    expect(currentFocus()).toEqual({ blockId: 'p1', selection: null });
  });

  it('carries the selected text without citation labels', () => {
    const { getByTestId } = render(<Tracker />);
    select((element) => {
      const range = document.createRange();
      range.selectNodeContents(element);
      return range;
    }, getByTestId('p1'));

    expect(currentFocus()).toEqual({ blockId: 'p1', selection: 'Transformers changed NLP.' });
  });

  it('survives focus leaving the document, and is published to React', () => {
    const { getByTestId } = render(<Tracker />);
    const { result } = renderHook(() => useEditorFocus());
    select((element) => {
      const range = document.createRange();
      range.selectNodeContents(element.querySelector('strong')!);
      return range;
    }, getByTestId('p1'));
    expect(result.current).toEqual({ blockId: 'p1', selection: 'changed' });

    // Clicking into the assistant's composer moves the selection out of the
    // text; what the author had selected is still what they are asking about.
    const outside = document.createElement('textarea');
    document.body.appendChild(outside);
    select(() => {
      const range = document.createRange();
      range.selectNodeContents(outside);
      return range;
    }, outside);
    expect(result.current).toEqual({ blockId: 'p1', selection: 'changed' });
    outside.remove();
  });

  it('is capped at what the server accepts', () => {
    const { getByTestId } = render(<Tracker />);
    const element = getByTestId('p1');
    element.textContent = 'x'.repeat(MAX_FOCUS_SELECTION_CHARS + 50);
    select((host) => {
      const range = document.createRange();
      range.selectNodeContents(host);
      return range;
    }, element);

    expect(currentFocus()?.selection).toHaveLength(MAX_FOCUS_SELECTION_CHARS);
  });

  it('is forgotten when the canvas unmounts', () => {
    const { getByTestId, unmount } = render(<Tracker />);
    select((element) => {
      const range = document.createRange();
      range.setStart(element.firstChild!, 0);
      return range;
    }, getByTestId('p1'));
    unmount();

    expect(currentFocus()).toBeNull();
  });
});
