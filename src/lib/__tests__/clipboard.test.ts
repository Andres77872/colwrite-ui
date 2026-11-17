import { afterEach, describe, expect, it, vi } from 'vitest';
import { copyToClipboard, escapeHtml } from '../clipboard';

const original = Object.getOwnPropertyDescriptor(navigator, 'clipboard');
const originalItem = globalThis.ClipboardItem;
const originalExec = Object.getOwnPropertyDescriptor(document, 'execCommand');

function setClipboard(value: Partial<Clipboard> | undefined) {
  Object.defineProperty(navigator, 'clipboard', { value, configurable: true });
}

/** jsdom has no copy command: this one fires `copy` as a browser does and records what it was given. */
function installCopyCommand(result = true) {
  const written: Record<string, string> = {};
  const execCommand = vi.fn(() => {
    const event = new Event('copy', { bubbles: true, cancelable: true }) as ClipboardEvent;
    Object.defineProperty(event, 'clipboardData', {
      value: { setData: (type: string, data: string) => { written[type] = data; } },
    });
    document.activeElement?.dispatchEvent(event);
    return result;
  });
  Object.defineProperty(document, 'execCommand', { value: execCommand, configurable: true });
  return { execCommand, written };
}

afterEach(() => {
  if (original) Object.defineProperty(navigator, 'clipboard', original);
  else Reflect.deleteProperty(navigator, 'clipboard');
  globalThis.ClipboardItem = originalItem;
  if (originalExec) Object.defineProperty(document, 'execCommand', originalExec);
  else Reflect.deleteProperty(document, 'execCommand');
  document.body.innerHTML = '';
});

describe('copyToClipboard', () => {
  it('writes rich text and plain text together where the browser can', async () => {
    const write = vi.fn().mockResolvedValue(undefined);
    globalThis.ClipboardItem = class {
      readonly items: Record<string, Blob>;
      constructor(items: Record<string, Blob>) {
        this.items = items;
      }
    } as unknown as typeof ClipboardItem;
    setClipboard({ write, writeText: vi.fn() });

    expect(await copyToClipboard({ plain: 'a', html: '<b>a</b>' })).toBe(true);
    const [item] = write.mock.calls[0]?.[0] as Array<{ items: Record<string, Blob> }>;
    expect(Object.keys(item?.items ?? {})).toEqual(['text/plain', 'text/html']);
  });

  it('falls back to plain text when rich text is refused', async () => {
    globalThis.ClipboardItem = class {} as unknown as typeof ClipboardItem;
    const writeText = vi.fn().mockResolvedValue(undefined);
    setClipboard({ write: vi.fn().mockRejectedValue(new Error('NotAllowed')), writeText });

    expect(await copyToClipboard({ plain: 'a', html: '<b>a</b>' })).toBe(true);
    expect(writeText).toHaveBeenCalledWith('a');
  });

  it('copies through the copy command where there is no Clipboard API (a plain-HTTP page)', async () => {
    setClipboard(undefined);
    const { execCommand, written } = installCopyCommand();
    const button = document.createElement('button');
    document.body.append(button);
    button.focus();
    // The page's own copy handlers must not see it.
    const pageHandler = vi.fn();
    document.addEventListener('copy', pageHandler);

    expect(await copyToClipboard({ plain: 'x < y', html: 'x &lt; y' })).toBe(true);

    document.removeEventListener('copy', pageHandler);
    expect(execCommand).toHaveBeenCalledWith('copy');
    expect(written).toEqual({ 'text/plain': 'x < y', 'text/html': 'x &lt; y' });
    expect(pageHandler).not.toHaveBeenCalled();
    // Nothing left behind, and the reader's focus is where it was.
    expect(document.querySelector('textarea')).toBeNull();
    expect(document.activeElement).toBe(button);
  });

  it('says so when nothing could copy', async () => {
    setClipboard({ writeText: vi.fn().mockRejectedValue(new Error('NotAllowed')) });
    installCopyCommand(false);
    expect(await copyToClipboard({ plain: 'a' })).toBe(false);
  });
});

describe('escapeHtml', () => {
  it('escapes what would otherwise be markup', () => {
    expect(escapeHtml('<a href="x">&</a>')).toBe('&lt;a href=&quot;x&quot;&gt;&amp;&lt;/a&gt;');
  });
});
