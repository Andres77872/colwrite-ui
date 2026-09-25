import { describe, expect, it } from 'vitest';
import {
  cleanCodeText,
  cleanPastedCode,
  holdsCodeText,
  indentEdit,
  newlineEdit,
  outdentEdit,
  readCodeText,
  writeCodeText,
} from './codeText';

function dom(html: string): HTMLDivElement {
  const el = document.createElement('div');
  el.innerHTML = html;
  return el;
}

/** `text` with `|` marking the caret, or `[` `]` a selection, as offsets. */
function marked(source: string): { text: string; start: number; end: number } {
  const caret = source.indexOf('|');
  if (caret !== -1) return { text: source.replace('|', ''), start: caret, end: caret };
  const start = source.indexOf('[');
  const end = source.indexOf(']') - 1;
  return { text: source.replace('[', '').replace(']', ''), start, end };
}

function show(edit: { text: string; start: number; end: number }): string {
  if (edit.start === edit.end) return `${edit.text.slice(0, edit.start)}|${edit.text.slice(edit.start)}`;
  return `${edit.text.slice(0, edit.start)}[${edit.text.slice(edit.start, edit.end)}]${edit.text.slice(edit.end)}`;
}

describe('readCodeText', () => {
  it('reads the lines Chrome wraps in divs as lines', () => {
    // What `execCommand('insertText', '\n')` leaves in a plaintext-only
    // editable: every newline a new <div>, none of them in `textContent`.
    const el = dom('def route(x, router):<div>a</div><div>b\n    logits = router(x)</div>');
    expect(el.textContent).toBe('def route(x, router):ab\n    logits = router(x)');
    expect(readCodeText(el)).toBe('def route(x, router):\na\nb\n    logits = router(x)');
  });

  it('reads an empty line the browser holds open with a placeholder', () => {
    expect(readCodeText(dom('return x<div><br></div>'))).toBe('return x\n');
    expect(readCodeText(dom('a<div><br></div><div>b</div>'))).toBe('a\n\nb');
    expect(readCodeText(dom('<div><br></div><div>b</div>'))).toBe('\nb');
  });

  it('tells a line break from the <br> that ends a line', () => {
    expect(readCodeText(dom('a<br>b'))).toBe('a\nb');
    expect(readCodeText(dom('abc<br>'))).toBe('abc');
    expect(readCodeText(dom('<br>'))).toBe('');
  });

  it('drops the extra newline a native line break leaves at the end', () => {
    // Chrome's own Enter at the end: one newline for the line, one to draw it.
    expect(readCodeText(dom('abc\n\n'))).toBe('abc\n');
    expect(readCodeText(dom('abc\n'))).toBe('abc');
  });

  it('reads back exactly what writeCodeText wrote', () => {
    for (const text of ['', 'x', 'a\nb', 'a\n', 'a\n\n', '\n', '  indented\n\tand tabbed']) {
      const el = document.createElement('div');
      writeCodeText(el, text);
      expect(readCodeText(el)).toBe(text);
      expect(el.textContent).toBe(text);
      expect(holdsCodeText(el, text)).toBe(true);
    }
  });

  it('keeps a break right before a caret cut', () => {
    expect(readCodeText(dom('abc<br>'), { cut: true })).toBe('abc\n');
    expect(readCodeText(dom('abc\n'), { cut: true })).toBe('abc\n');
  });

  it('reads text inside inline elements', () => {
    expect(readCodeText(dom('let <span>x</span> = 1'))).toBe('let x = 1');
  });
});

describe('holdsCodeText', () => {
  it('is false once the browser has split the text', () => {
    expect(holdsCodeText(dom('a<div>b</div>'), 'a\nb')).toBe(false);
    expect(holdsCodeText(dom('abc<br>'), 'abc')).toBe(false);
    expect(holdsCodeText(dom('<br>'), '')).toBe(false);
    expect(holdsCodeText(dom('a\nb'), 'a\nb')).toBe(true);
  });
});

describe('cleanCodeText', () => {
  it('removes the control characters the API refuses and unifies line endings', () => {
    expect(cleanCodeText('a\u0000b\u0007c\u007f\td\r\ne\rf\u000cg')).toBe('abc\td\ne\nfg');
  });
});

describe('cleanPastedCode', () => {
  it('strips terminal colours and cursor codes from program output', () => {
    expect(cleanPastedCode('\u001b[32mPASSED\u001b[0m tests/test_router.py\u001b[K')).toBe('PASSED tests/test_router.py');
    expect(cleanPastedCode('\u001b]0;train.py\u0007epoch 1')).toBe('epoch 1');
  });

  it('keeps what a progress bar drew last', () => {
    expect(cleanPastedCode('epoch 1:  10%\repoch 1:  50%\repoch 1: 100%\r\nloss 2.31')).toBe('epoch 1: 100%\nloss 2.31');
  });

  it('turns non-breaking spaces from web pages into spaces', () => {
    expect(cleanPastedCode('if x:\n\u00a0\u00a0\u00a0\u00a0return 1')).toBe('if x:\n    return 1');
  });
});

describe('line edits', () => {
  it('Enter keeps the indentation of the line it splits', () => {
    const { text, start, end } = marked('def f():\n    x = 1|\n');
    expect(show(newlineEdit(text, start, end))).toBe('def f():\n    x = 1\n    |\n');
    const top = marked('|a');
    expect(show(newlineEdit(top.text, top.start, top.end))).toBe('\n|a');
  });

  it('Enter replaces a selection', () => {
    const { text, start, end } = marked('  a[bc]d');
    expect(show(newlineEdit(text, start, end))).toBe('  a\n  |d');
  });

  it('Tab inserts an indent at the caret', () => {
    const { text, start, end } = marked('x = |1');
    expect(show(indentEdit(text, start, end))).toBe('x =   |1');
  });

  it('Tab indents every selected line and keeps the selection on them', () => {
    const { text, start, end } = marked('[a\nb]\nc');
    expect(show(indentEdit(text, start, end))).toBe('[  a\n  b]\nc');
    // A selection that ends at the start of a line leaves that line alone,
    // and empty lines get no trailing spaces.
    const tail = marked('x\n[a\n\nb\n]c');
    expect(show(indentEdit(tail.text, tail.start, tail.end))).toBe('x\n[  a\n\n  b\n]c');
  });

  it('Shift+Tab outdents the caret line or every selected line', () => {
    const caret = marked('if x:\n    |y');
    expect(show(outdentEdit(caret.text, caret.start, caret.end))).toBe('if x:\n  |y');
    const lines = marked('  [a\n b\n\tc]');
    expect(show(outdentEdit(lines.text, lines.start, lines.end))).toBe('[a\nb\nc]');
    const flush = marked('|a');
    expect(show(outdentEdit(flush.text, flush.start, flush.end))).toBe('|a');
  });

  it('Shift+Tab with the caret inside the indentation moves it to the line start', () => {
    const { text, start, end } = marked(' | x');
    expect(show(outdentEdit(text, start, end))).toBe('|x');
  });
});
