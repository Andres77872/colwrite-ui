import { afterEach, describe, expect, it } from 'vitest';
import { placeCaretAfterWidget } from '../shared/caretAfterWidget';

function paragraph(html: string) {
  const editable = document.createElement('div');
  editable.setAttribute('contenteditable', 'true');
  editable.innerHTML = html;
  document.body.appendChild(editable);
  const trigger = document.createElement('button');
  editable.querySelector('[data-child-id]')?.appendChild(trigger);
  return { editable, trigger };
}

afterEach(() => {
  document.body.innerHTML = '';
});

describe('placeCaretAfterWidget', () => {
  it('lands immediately after a widget in the middle of a sentence', () => {
    const { editable, trigger } = paragraph('token <span data-child-id="e1" contenteditable="false"></span> to expert');
    expect(placeCaretAfterWidget(trigger)).toBe(true);
    const selection = document.getSelection()!;
    expect(document.activeElement).toBe(editable);
    expect(selection.isCollapsed).toBe(true);
    expect(selection.anchorNode?.textContent).toBe(' to expert');
    expect(selection.anchorOffset).toBe(0);
  });

  it('lands beyond the trailing spacer at the end of a paragraph', () => {
    const { trigger } = paragraph('end <span data-child-id="e1" contenteditable="false"></span> ');
    expect(placeCaretAfterWidget(trigger)).toBe(true);
    const selection = document.getSelection()!;
    expect(selection.anchorNode?.textContent).toBe(' ');
    expect(selection.anchorOffset).toBe(1);
  });

  it('declines when the widget is not in editable text (locked block)', () => {
    const locked = document.createElement('div');
    locked.setAttribute('contenteditable', 'false');
    locked.innerHTML = 'x <span data-child-id="e1" contenteditable="false"></span> y';
    document.body.appendChild(locked);
    const trigger = document.createElement('button');
    locked.querySelector('[data-child-id]')!.appendChild(trigger);
    expect(placeCaretAfterWidget(trigger)).toBe(false);
  });
});
