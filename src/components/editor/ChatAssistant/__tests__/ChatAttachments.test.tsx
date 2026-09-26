import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import * as attachments from '@/services/chatAttachments';
import { MessageAttachments } from '../ChatAttachments';

afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it('fetches thumbnails only near the viewport and releases their blob URLs on unmount', async () => {
  let visible!: () => void;
  const disconnect = vi.fn();
  vi.stubGlobal('IntersectionObserver', class {
    constructor(callback: IntersectionObserverCallback) {
      visible = () => callback([{ isIntersecting: true } as IntersectionObserverEntry], {} as IntersectionObserver);
    }
    observe() {}
    disconnect() { disconnect(); }
  });
  const createObjectURL = vi.fn(() => 'blob:test-image');
  const revokeObjectURL = vi.fn();
  vi.stubGlobal('URL', class extends URL {
    static createObjectURL = createObjectURL;
    static revokeObjectURL = revokeObjectURL;
  });
  const load = vi.spyOn(attachments, 'loadChatImageBlob').mockResolvedValue(new Blob(['png'], { type: 'image/png' }));
  const view = render(<MessageAttachments attachments={[{ kind: 'image', image_id: 'image-1', filename: 'chart.png' }]} />);
  expect(load).not.toHaveBeenCalled();
  await act(async () => { visible(); visible(); });
  await waitFor(() => expect(screen.getByRole('img', { name: 'chart.png' }).getAttribute('src')).toBe('blob:test-image'));
  expect(load).toHaveBeenCalledWith('image-1', expect.any(AbortSignal));
  expect(load).toHaveBeenCalledTimes(1);
  expect(disconnect).toHaveBeenCalled();
  view.unmount();
  expect(revokeObjectURL).toHaveBeenCalledWith('blob:test-image');
  expect(load.mock.calls[0][1].aborted).toBe(true);
});
