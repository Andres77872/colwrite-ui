import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import {
  EditorActionsContext,
  EditorActiveBlockContext,
  type EditorActionsContextValue,
} from '@/editor/editorContextState';
import type { CodeBlock as CodeBlockModel } from '@/editor/types';
import { ToastContext } from '@/components/ui/toastContext';
import { ASK_AI_EVENT } from '../../AskAi/askAiEvents';
import { CodeBlock } from './CodeBlock';

const actions = {
  addBlockAfter: vi.fn(() => 'next'),
  duplicateBlock: vi.fn(() => 'copy'),
  getBlockIds: vi.fn(() => ['c1']),
  moveBlock: vi.fn(),
  refs: { current: {} as Record<string, HTMLDivElement | null> },
  registerEditable: vi.fn((id: string, element: HTMLDivElement | null) => {
    actions.refs.current[id] = element;
  }),
  removeBlock: vi.fn(),
  selectBlocks: vi.fn(),
  setBlockKind: vi.fn(),
  setCodeLanguage: vi.fn(),
  updateCodeText: vi.fn(),
};

const toast = vi.fn(() => 'toast');

function Editor({ children }: { children: ReactNode }) {
  return (
    <ToastContext.Provider value={{ toast, dismiss: vi.fn() }}>
      <EditorActionsContext.Provider value={actions as unknown as EditorActionsContextValue}>
        <EditorActiveBlockContext.Provider value={{ activeId: 'c1', setActive: vi.fn() }}>
          {children}
        </EditorActiveBlockContext.Provider>
      </EditorActionsContext.Provider>
    </ToastContext.Provider>
  );
}

function code(text: string, extra: Partial<CodeBlockModel> = {}): CodeBlockModel {
  return { id: 'c1', type: 'code', text, language: 'python', ...extra };
}

function editor(name = 'Code block, Python'): HTMLElement {
  return screen.getByRole('textbox', { name });
}

/** Select `[start, end)` of a text node (the editable's own by default). */
function select(node: Node, start: number, end = start) {
  const range = document.createRange();
  range.setStart(node, start);
  range.setEnd(node, end);
  const selection = window.getSelection();
  selection?.removeAllRanges();
  selection?.addRange(range);
}

function caret(): number | undefined {
  return window.getSelection()?.getRangeAt(0).startOffset;
}

function lastSaved(): string | undefined {
  return actions.updateCodeText.mock.lastCall?.[1];
}

function paste(target: HTMLElement, text: string) {
  fireEvent.paste(target, {
    clipboardData: { getData: (type: string) => (type === 'text/plain' ? text : '') },
  });
}

beforeEach(() => {
  Object.values(actions).forEach((value) => {
    if (typeof value === 'function' && 'mockClear' in value) value.mockClear();
  });
  actions.refs.current = {};
  toast.mockClear();
});

afterEach(cleanup);

describe('CodeBlock text', () => {
  it('saves the lines a browser wraps in divs as lines', () => {
    render(<CodeBlock block={code('def f():')} />, { wrapper: Editor });
    const field = editor();
    // What Chrome leaves after `execCommand('insertText', '\n')`: a <div> per
    // line, which `textContent` reads without the newline.
    field.innerHTML = 'def f():<div>    return 1</div>';
    select(field.querySelector('div')?.firstChild as Node, 12);
    fireEvent.input(field);

    expect(lastSaved()).toBe('def f():\n    return 1');
    // Written back as one text node, the caret where it was.
    expect(field.childNodes).toHaveLength(1);
    expect(caret()).toBe('def f():\n    return 1'.length);
  });

  it('opens a new line at the indentation of the current one on Enter', () => {
    render(<CodeBlock block={code('def f():\n    x = 1')} />, { wrapper: Editor });
    const field = editor();
    select(field.firstChild as Node, 'def f():\n    x = 1'.length);
    fireEvent.keyDown(field, { key: 'Enter' });

    expect(lastSaved()).toBe('def f():\n    x = 1\n    ');
    expect(field.textContent).toBe('def f():\n    x = 1\n    ');
    expect(caret()).toBe('def f():\n    x = 1\n    '.length);
  });

  it('keeps an empty last line drawn so the caret can sit on it', () => {
    render(<CodeBlock block={code('x = 1')} />, { wrapper: Editor });
    const field = editor();
    select(field.firstChild as Node, 5);
    fireEvent.keyDown(field, { key: 'Enter' });

    expect(lastSaved()).toBe('x = 1\n');
    expect(field.lastChild?.nodeName).toBe('BR');
    expect(caret()).toBe(6);
  });

  it('pastes program output clean: no colour codes, control characters or CRLF', () => {
    render(<CodeBlock block={code('')} />, { wrapper: Editor });
    const field = editor();
    select(field, 0);
    paste(field, '\u001b[32mPASSED\u001b[0m\r\nepoch 1\u0000 10%\repoch 1 100%\r\n');

    expect(lastSaved()).toBe('PASSED\nepoch 1 100%\n');
  });

  it('pastes over the selection as plain text, lines kept', () => {
    render(<CodeBlock block={code('a = OLD')} />, { wrapper: Editor });
    const field = editor();
    select(field.firstChild as Node, 4, 7);
    paste(field, 'f(\n  1)');

    expect(lastSaved()).toBe('a = f(\n  1)');
    expect(caret()).toBe('a = f(\n  1)'.length);
  });

  it('indents and outdents every selected line with Tab and Shift+Tab', () => {
    render(<CodeBlock block={code('a\nb\nc')} />, { wrapper: Editor });
    const field = editor();
    select(field.firstChild as Node, 0, 3);
    fireEvent.keyDown(field, { key: 'Tab' });
    expect(lastSaved()).toBe('  a\n  b\nc');

    fireEvent.keyDown(field, { key: 'Tab', shiftKey: true });
    expect(lastSaved()).toBe('a\nb\nc');
  });

  it('commits IME input when the composition ends, not mid-way', () => {
    render(<CodeBlock block={code('# ')} />, { wrapper: Editor });
    const field = editor();
    fireEvent.compositionStart(field);
    field.textContent = '# 注';
    fireEvent.input(field);
    fireEvent.keyDown(field, { key: 'Enter', isComposing: true });
    expect(actions.updateCodeText).not.toHaveBeenCalled();

    field.textContent = '# 注释';
    fireEvent.compositionEnd(field);
    expect(lastSaved()).toBe('# 注释');
  });

  it('removes itself on Backspace once empty', () => {
    render(<CodeBlock block={code('')} />, { wrapper: Editor });
    fireEvent.keyDown(editor(), { key: 'Backspace' });
    expect(actions.removeBlock).toHaveBeenCalledWith('c1');
  });
});

describe('CodeBlock shortcuts', () => {
  it('answers the block shortcuts the prose blocks do', () => {
    render(<CodeBlock block={code('x = 1')} />, { wrapper: Editor });
    const field = editor();
    const askAi = vi.fn();
    window.addEventListener(ASK_AI_EVENT, askAi);

    fireEvent.keyDown(field, { key: 'd', ctrlKey: true });
    expect(actions.duplicateBlock).toHaveBeenCalledWith('c1');

    select(field.firstChild as Node, 2);
    fireEvent.keyDown(field, { key: 'ArrowUp', ctrlKey: true, shiftKey: true });
    expect(actions.moveBlock).toHaveBeenCalledWith('c1', -1);

    fireEvent.keyDown(field, { key: '0', code: 'Digit0', ctrlKey: true, altKey: true });
    expect(actions.setBlockKind).toHaveBeenCalledWith('c1', 'text');

    fireEvent.keyDown(field, { key: 'j', ctrlKey: true });
    expect(askAi).toHaveBeenCalledTimes(1);
    window.removeEventListener(ASK_AI_EVENT, askAi);
  });

  it('leaves the block for a new paragraph on Mod+Enter', () => {
    render(<CodeBlock block={code('x = 1')} />, { wrapper: Editor });
    fireEvent.keyDown(editor(), { key: 'Enter', ctrlKey: true });
    expect(actions.addBlockAfter).toHaveBeenCalledWith('c1', 'paragraph');
    expect(actions.updateCodeText).not.toHaveBeenCalled();
  });

  it('keeps a locked block unchanged but still lets it be duplicated', () => {
    render(<CodeBlock block={code('x = 1', { locked: true })} />, { wrapper: Editor });
    const field = editor();
    select(field.firstChild as Node, 5);
    fireEvent.keyDown(field, { key: 'Enter' });
    fireEvent.keyDown(field, { key: 'Tab' });
    paste(field, 'y');
    fireEvent.keyDown(field, { key: '0', code: 'Digit0', ctrlKey: true, altKey: true });
    expect(actions.updateCodeText).not.toHaveBeenCalled();
    expect(actions.setBlockKind).not.toHaveBeenCalled();

    fireEvent.keyDown(field, { key: 'd', ctrlKey: true });
    expect(actions.duplicateBlock).toHaveBeenCalledWith('c1');
    expect(screen.getByRole('button', { name: 'Code language: Python' }).hasAttribute('disabled')).toBe(true);
  });
});

describe('CodeBlock chrome', () => {
  function openPicker(name: string) {
    fireEvent.pointerDown(screen.getByRole('button', { name }), { button: 0, ctrlKey: false });
  }

  it('reads a language stored under an alias as the language', () => {
    render(<CodeBlock block={code('print(1)', { language: 'py' })} />, { wrapper: Editor });
    expect(screen.getByRole('button', { name: 'Code language: Python' })).toBeTruthy();

    openPicker('Code language: Python');
    // Already Python: choosing it again writes nothing.
    fireEvent.click(screen.getByRole('menuitem', { name: 'Python' }));
    expect(actions.setCodeLanguage).not.toHaveBeenCalled();

    openPicker('Code language: Python');
    fireEvent.click(screen.getByRole('menuitem', { name: 'R' }));
    expect(actions.setCodeLanguage).toHaveBeenCalledWith('c1', 'r');
  });

  it('shows a language the picker does not list as it is stored', () => {
    render(<CodeBlock block={code('main = print 1', { language: 'haskell' })} />, { wrapper: Editor });
    openPicker('Code language: haskell');
    expect(screen.getByRole('menuitem', { name: 'haskell' })).toBeTruthy();
  });

  it('turns into a diagram or a figure from the picker', () => {
    render(<CodeBlock block={code('flowchart LR\n  A --> B', { language: undefined })} />, { wrapper: Editor });
    openPicker('Code language: Plain text');
    fireEvent.click(screen.getByRole('menuitem', { name: 'Mermaid diagram' }));
    expect(actions.setCodeLanguage).toHaveBeenCalledWith('c1', 'mermaid');

    openPicker('Code language: Plain text');
    fireEvent.click(screen.getByRole('menuitem', { name: 'Structured figure' }));
    expect(actions.setCodeLanguage).toHaveBeenCalledWith('c1', 'figure');
  });

  it('copies the code and says so', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    render(<CodeBlock block={code('x = 1')} />, { wrapper: Editor });

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Copy' }));
    });

    expect(writeText).toHaveBeenCalledWith('x = 1');
    expect(screen.getByRole('button', { name: 'Copied' })).toBeTruthy();
    expect(screen.getByText('Code copied')).toBeTruthy();
  });

  it('reports a copy the browser refused', async () => {
    const writeText = vi.fn().mockRejectedValue(new Error('denied'));
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    render(<CodeBlock block={code('x = 1')} />, { wrapper: Editor });

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Copy' }));
    });

    expect(toast).toHaveBeenCalledWith({ title: 'Could not copy the code', variant: 'error' });
    expect(screen.getByRole('button', { name: 'Copy' })).toBeTruthy();
  });
});
