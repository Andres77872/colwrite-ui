import { act, cleanup, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import * as assets from '@/data/assets';
import { MessageAttachments } from '../ChatAttachments';
import { renderInWorkspace } from '@/__tests__/renderInWorkspace';
import { TEST_WORKSPACE_ID } from '@/__tests__/workspace';

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
  const load = vi.spyOn(assets, 'loadAssetBlob').mockResolvedValue(new Blob(['png'], { type: 'image/png' }));
  const view = renderInWorkspace(<MessageAttachments attachments={[{ kind: 'image', asset_id: 'asset-1', filename: 'chart.png' }]} />);
  expect(load).not.toHaveBeenCalled();
  // Said in text: an aria-label on a bare svg is read by few screen readers (U-19).
  expect(screen.getByText('Loading image preview').className).toContain('sr-only');
  await act(async () => { visible(); visible(); });
  await waitFor(() => expect(screen.getByRole('img', { name: 'chart.png' }).getAttribute('src')).toBe('blob:test-image'));
  expect(load).toHaveBeenCalledWith(TEST_WORKSPACE_ID, 'asset-1', expect.any(AbortSignal), 'thumbnail');
  expect(load).toHaveBeenCalledTimes(1);
  expect(disconnect).toHaveBeenCalled();
  view.unmount();
  expect(revokeObjectURL).toHaveBeenCalledWith('blob:test-image');
  expect(load.mock.calls[0]?.[2].aborted).toBe(true);
});
