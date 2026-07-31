const PRINT_FRAME_CLEANUP_MS = 2 * 60 * 1000;

async function waitForPrintAssets(document: Document): Promise<void> {
  if (document.fonts) await document.fonts.ready;
  await Promise.all(
    Array.from(document.images, (image) => {
      if (image.complete) return image.decode().catch(() => undefined);
      return new Promise<void>((resolve) => {
        image.addEventListener('load', () => resolve(), { once: true });
        image.addEventListener('error', () => resolve(), { once: true });
      });
    }),
  );
}

/**
 * Print a self-contained document without sending authored content to a server.
 *
 * The iframe stays mounted until the browser reports `afterprint` (or a bounded
 * fallback expires), because some browsers return from `print()` before their
 * native preview has finished reading the frame.
 */
export function printStandaloneHtml(html: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const frame = document.createElement('iframe');
    frame.title = 'Document print preview';
    frame.setAttribute('aria-hidden', 'true');
    frame.setAttribute('sandbox', 'allow-modals allow-same-origin');
    frame.style.position = 'fixed';
    frame.style.right = '0';
    frame.style.bottom = '0';
    frame.style.width = '1px';
    frame.style.height = '1px';
    frame.style.border = '0';
    frame.style.opacity = '0';
    frame.style.pointerEvents = 'none';

    let cleaned = false;
    let settled = false;
    let cleanupTimer: number | undefined;

    const cleanup = () => {
      if (cleaned) return;
      cleaned = true;
      if (cleanupTimer !== undefined) window.clearTimeout(cleanupTimer);
      frame.remove();
    };
    const fail = (error: unknown) => {
      cleanup();
      if (settled) return;
      settled = true;
      reject(error instanceof Error ? error : new Error('The browser could not open print preview'));
    };

    frame.addEventListener('error', () => fail(new Error('The print document could not be loaded')), {
      once: true,
    });
    frame.addEventListener('load', () => {
      void (async () => {
        const printWindow = frame.contentWindow;
        const printDocument = frame.contentDocument;
        if (!printWindow || !printDocument) {
          throw new Error('The browser did not create a print document');
        }

        await waitForPrintAssets(printDocument);
        printWindow.addEventListener('afterprint', cleanup, { once: true });
        printWindow.focus();
        printWindow.print();

        if (!settled) {
          settled = true;
          resolve();
        }
        if (!cleaned) {
          cleanupTimer = window.setTimeout(cleanup, PRINT_FRAME_CLEANUP_MS);
        }
      })().catch(fail);
    }, { once: true });

    frame.srcdoc = html;
    document.body.append(frame);
  });
}
