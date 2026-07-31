import { afterEach, describe, expect, it, vi } from 'vitest';
import { printStandaloneHtml } from './print';

afterEach(() => {
  vi.restoreAllMocks();
  document.body.replaceChildren();
});

describe('printStandaloneHtml', () => {
  it('prints a sandboxed standalone frame and removes it after printing', async () => {
    const printWindow = new EventTarget() as EventTarget & {
      focus: ReturnType<typeof vi.fn>;
      print: ReturnType<typeof vi.fn>;
    };
    printWindow.focus = vi.fn();
    printWindow.print = vi.fn(() => {
      printWindow.dispatchEvent(new Event('afterprint'));
    });
    const printDocument = {
      fonts: { ready: Promise.resolve() },
      images: [],
    } as unknown as Document;
    vi.spyOn(HTMLIFrameElement.prototype, 'contentWindow', 'get')
      .mockReturnValue(printWindow as unknown as Window);
    vi.spyOn(HTMLIFrameElement.prototype, 'contentDocument', 'get')
      .mockReturnValue(printDocument);

    const result = printStandaloneHtml('<!doctype html><title>Paper</title>');
    const frame = document.querySelector('iframe');
    expect(frame?.srcdoc).toContain('<title>Paper</title>');
    expect(frame?.getAttribute('sandbox')).toBe('allow-modals allow-same-origin');

    frame?.dispatchEvent(new Event('load'));
    await result;

    expect(printWindow.focus).toHaveBeenCalledOnce();
    expect(printWindow.print).toHaveBeenCalledOnce();
    expect(document.querySelector('iframe')).toBeNull();
  });

  it('rejects and removes the frame when no print context is available', async () => {
    vi.spyOn(HTMLIFrameElement.prototype, 'contentWindow', 'get').mockReturnValue(null);

    const result = printStandaloneHtml('<!doctype html><title>Paper</title>');
    document.querySelector('iframe')?.dispatchEvent(new Event('load'));

    await expect(result).rejects.toThrow('did not create a print document');
    expect(document.querySelector('iframe')).toBeNull();
  });
});
