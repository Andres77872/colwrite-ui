import { act, cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { renderInWorkspace } from '@/__tests__/renderInWorkspace';
import { HttpResponse, http, pathOf, recordRequests, server } from '@/__tests__/server';
import { assetFixture, imageFile, TEST_ASSET_ID } from '@/__tests__/asset';
import { TEST_WORKSPACE_ID } from '@/__tests__/workspace';
import { EditorActionsContext, type EditorActionsContextValue } from '@/editor/editorContextState';
import { DocumentSessionContext, PageReadOnlyContext, type DocumentSessionValue } from '@/editor/documentSessionState';
import { createBlockActions } from '@/editor/blockActions';
import { figureNumbers } from '@/editor/blockKinds';
import type { Doc, ImageBlock as ImageBlockModel } from '@/editor/types';
import { ImageBlock } from './ImageBlock';
import { ImageUploadHost } from './ImageUploadHost';
import { openImageUpload } from './imageUpload';

afterEach(async () => {
  cleanup();
  // Radix returns focus on a deferred unmount event. Settle it before the
  // jsdom realm (and this test's globals) can be replaced by another file.
  await act(async () => { await new Promise<void>((resolve) => setTimeout(resolve, 0)); });
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
const block: ImageBlockModel = {
  id: 'image', type: 'image', assetId: TEST_ASSET_ID, alt: 'Blue rectangle', caption: 'The pipeline',
  width: 0.7, origin: { kind: 'upload' },
};

function binary() {
  server.use(http.get('/workspaces/{workspace_id}/assets/{asset_id}/content', ({ response }) => response.untyped(
    new HttpResponse(new Uint8Array([1, 2, 3]), { headers: { 'Content-Type': 'image/png' } }),
  )));
  const revoke = vi.fn();
  vi.stubGlobal('URL', class extends URL {
    static createObjectURL = vi.fn(() => 'blob:image-preview');
    static revokeObjectURL = revoke;
  });
  return revoke;
}

function mountImage(extra: Partial<ImageBlockModel> = {}, readOnly = false) {
  const update = vi.fn();
  const view = renderInWorkspace(
    <EditorActionsContext.Provider value={{ updateImageDetails: update } as unknown as EditorActionsContextValue}>
      <DocumentSessionContext.Provider value={{ readOnly } as DocumentSessionValue}>
        <PageReadOnlyContext.Provider value={readOnly}>
          <ImageBlock block={{ ...block, ...extra }} number={2} />
        </PageReadOnlyContext.Provider>
      </DocumentSessionContext.Provider>
    </EditorActionsContext.Provider>,
  );
  return { ...view, update };
}

it('draws the authenticated display rendition with alt text and a shared figure number, and releases its URL', async () => {
  const revoke = binary();
  const sent = recordRequests();
  const view = mountImage();
  expect((await screen.findByRole('img', { name: 'Blue rectangle' })).getAttribute('src')).toBe('blob:image-preview');
  expect(screen.getByText('Figure 2.')).toBeTruthy();
  expect(sent.map(pathOf)).toContain(`/api/workspaces/${TEST_WORKSPACE_ID}/assets/${TEST_ASSET_ID}/content?rendition=display`);
  view.unmount();
  expect(revoke).toHaveBeenCalledWith('blob:image-preview');
});

it('edits only author fields, never the asset identity or server-owned origin', () => {
  binary();
  const view = mountImage({ origin: { kind: 'generated', generationId: 'gen-00000000-0000-4000-8000-000000000003' } });
  expect(screen.getByRole('button', { name: 'AI-generated image · Details' })).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Edit image details' }));
  fireEvent.change(screen.getByLabelText('Alt text'), { target: { value: 'A blue square' } });
  fireEvent.change(screen.getByLabelText('Caption'), { target: { value: 'Updated pipeline' } });
  fireEvent.change(screen.getByLabelText('Width (%)'), { target: { value: '50' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save details' }));
  expect(view.update).toHaveBeenCalledExactlyOnceWith('image', { alt: 'A blue square', caption: 'Updated pipeline', width: 0.5, label: undefined });
  expect(screen.queryByLabelText(/origin|asset/i)).toBeNull();
});

it.each([{ locked: true }, { readOnly: true }])('does not expose image editing for a protected page/block: %o', (condition) => {
  binary();
  mountImage('locked' in condition ? { locked: true } : {}, 'readOnly' in condition);
  expect(screen.queryByRole('button', { name: 'Edit image details' })).toBeNull();
});

it('inserts a complete uploaded image as one action, rather than an invalid empty image block', async () => {
  const insert = vi.fn();
  const getBlock = vi.fn(() => ({ id: 'anchor', type: 'paragraph', html: '', children: [] }));
  server.use(http.post('/workspaces/{workspace_id}/assets', ({ response }) => response(201).json(assetFixture())));
  renderInWorkspace(<EditorActionsContext.Provider value={{ getBlock, insertBlocksAfter: insert } as unknown as EditorActionsContextValue}>
    <ImageUploadHost />
  </EditorActionsContext.Provider>);
  act(() => openImageUpload('anchor'));
  fireEvent.change(screen.getByLabelText('Image file'), { target: { files: [imageFile()] } });
  fireEvent.change(screen.getByLabelText('Alt text'), { target: { value: 'Blue rectangle' } });
  fireEvent.submit(screen.getByRole('button', { name: 'Insert image' }).closest('form')!);
  await waitFor(() => expect(insert).toHaveBeenCalledOnce());
  expect(insert).toHaveBeenCalledWith('anchor', [expect.objectContaining({
    type: 'image', assetId: TEST_ASSET_ID, alt: 'Blue rectangle', origin: { kind: 'upload' },
  })], { replaceAnchor: true });
});

it('keeps identity/origin on edits, drops duplicate labels, and will not merge text into an image', () => {
  let doc: Doc = { blocks: [block, { id: 'after', type: 'paragraph', html: 'Text' }] };
  const actions = createBlockActions((update) => { doc = update(doc); }, () => doc);
  actions.updateImageDetails('image', { alt: 'New alt', caption: 'New caption', width: 0.5, label: 'fig:pipeline' });
  expect(doc.blocks[0]).toMatchObject({ assetId: TEST_ASSET_ID, origin: { kind: 'upload' }, alt: 'New alt' });
  expect(actions.mergeWithPrevious('after')).toBeNull();
  const id = actions.duplicateBlock('image');
  expect(doc.blocks.find((item) => item.id === id)).not.toHaveProperty('label');
  expect(figureNumbers(doc.blocks, () => null).get('image')).toBe(1);
  expect(figureNumbers(doc.blocks, () => null).get(id!)).toBe(2);
});
