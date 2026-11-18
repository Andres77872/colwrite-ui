import { act, cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderInWorkspace } from '@/__tests__/renderInWorkspace';
import { recordRequests, pathOf, jsonOf } from '@/__tests__/server';
import { TEST_WORKSPACE_ID } from '@/__tests__/workspace';
import { fixtures } from '@/dev/msw/fixtures';
import { FIXTURE_DOCUMENT_ID } from '@/dev/fixtureDocument';
import { enableImageFixture, proposeGeneration } from '@/dev/msw/imageGenerations';
import { EditorActionsContext, EditorActiveBlockContext, type EditorActionsContextValue } from '@/editor/editorContextState';
import { DocumentSessionContext, type DocumentSessionValue } from '@/editor/documentSessionState';
import { createBlockActions } from '@/editor/blockActions';
import type { Doc } from '@/editor/types';
import { ImageGenerationCard } from './ImageGenerationCard';
import { confirmImage, editImageRequest, proposeImage, proposeImageAgain } from '@/data/imageGenerations';
import { uid } from '@/lib/uid';

afterEach(async () => {
  cleanup();
  await act(async () => { await new Promise<void>((resolve) => setTimeout(resolve, 0)); });
  vi.unstubAllGlobals();
});

function proposal() {
  enableImageFixture();
  return proposeGeneration(TEST_WORKSPACE_ID, FIXTURE_DOCUMENT_ID, {
    purpose: 'illustration', description: 'A conceptual blue river', style: '', exact_text: '', aspect_ratio: '3:2',
  }, 'Illustrate a blue river winding through the mountains. No lettering.', 'gateway');
}

function mount(generationId: string, readOnly = false) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  let doc: Doc = { blocks: [{ id: 'anchor', type: 'paragraph', html: 'Opening paragraph.' }] };
  const edits: Doc[] = [];
  const actions = createBlockActions((update) => { edits.push(doc); doc = update(doc); }, () => doc);
  const view = renderInWorkspace(<QueryClientProvider client={client}>
    <DocumentSessionContext.Provider value={{ documentId: FIXTURE_DOCUMENT_ID, readOnly } as DocumentSessionValue}>
      <EditorActiveBlockContext.Provider value={{ activeId: 'anchor', setActive: vi.fn() }}>
        <EditorActionsContext.Provider value={actions as unknown as EditorActionsContextValue}>
          <ImageGenerationCard generationId={generationId} />
        </EditorActionsContext.Provider>
      </EditorActiveBlockContext.Provider>
    </DocumentSessionContext.Provider>
  </QueryClientProvider>);
  return { ...view, doc: () => doc, edits, client };
}

it('shows the exact request, generator, estimate and venue caution without ever confirming on mount', async () => {
  const info = proposal();
  const requests = recordRequests();
  mount(info.generation_id);
  await screen.findByRole('button', { name: 'Generate' });
  expect(screen.getByText(info.prompt.replace(/\s+/g, ' ').trim())).toBeTruthy();
  expect(screen.getByText(/Science requires editor permission/)).toBeTruthy();
  expect(screen.getByText(/openai\/gpt-image-2.5-sunburst/)).toBeTruthy();
  expect(requests.some((request) => pathOf(request).endsWith('/confirm'))).toBe(false);
  expect(fixtures.assets.size).toBe(0);
});

it('confirms only the displayed token and inserts the resulting asset as one edit', async () => {
  const info = proposal();
  fixtures.jobDurationMs = 0;
  vi.stubGlobal('URL', class extends URL {
    static createObjectURL = vi.fn(() => 'blob:offline-image');
    static revokeObjectURL = vi.fn();
  });
  const requests = recordRequests();
  const view = mount(info.generation_id);
  const generate = await screen.findByRole('button', { name: 'Generate' });
  await waitFor(() => expect(generate.hasAttribute('disabled')).toBe(false));
  fireEvent.click(generate);
  fireEvent.click(await screen.findByRole('button', { name: 'Insert image' }));
  await waitFor(() => expect(view.doc().blocks).toHaveLength(2));
  expect(view.edits).toHaveLength(1);
  expect(view.edits[0]?.blocks).toHaveLength(1); // One undo restores the untouched page.
  expect(view.doc().blocks[1]).toMatchObject({ type: 'image', alt: 'A conceptual blue river', origin: { kind: 'generated', generationId: info.generation_id } });
  const confirm = requests.find((request) => pathOf(request).endsWith('/confirm'));
  expect(await jsonOf(confirm)).toEqual({ confirmation_token: info.confirmation_token });
  expect(confirm?.headers.get('Idempotency-Key')).toBeTruthy();
});

it('gives a viewer no confirmation, editing, discard or insertion controls', async () => {
  const info = proposal();
  mount(info.generation_id, true);
  await screen.findByText(info.prompt.replace(/\s+/g, ' ').trim());
  expect(screen.queryByRole('button', { name: 'Generate' })).toBeNull();
  expect(screen.queryByRole('button', { name: 'Edit request' })).toBeNull();
  expect(screen.queryByRole('button', { name: 'Discard' })).toBeNull();
});

it('keeps an unknown result explicit and never automatically retries spending', async () => {
  const info = proposal();
  info.status = 'unknown';
  info.error_code = 'image_generation_unknown';
  const requests = recordRequests();
  mount(info.generation_id);
  await screen.findByText(/may have completed and charged/);
  expect(screen.getByRole('button', { name: 'Generate again…' })).toBeTruthy();
  expect(requests.some((request) => request.method !== 'GET')).toBe(false);
});

it('the shared mock binds confirmation to the edited exact request and replays one job', async () => {
  const info = proposal();
  const originalToken = info.confirmation_token;
  const edited = await editImageRequest(TEST_WORKSPACE_ID, info.generation_id, {
    prompt: 'A conceptual blue square. No text.', aspect_ratio: '16:9', confirmation_token: info.confirmation_token,
  });
  await expect(confirmImage(TEST_WORKSPACE_ID, info.generation_id, originalToken, uid())).rejects.toMatchObject({ data: { code: 'generation_request_changed' } });
  const action = uid();
  const [first, replay] = await Promise.all([
    confirmImage(TEST_WORKSPACE_ID, info.generation_id, edited.confirmation_token, action),
    confirmImage(TEST_WORKSPACE_ID, info.generation_id, edited.confirmation_token, action),
  ]);
  expect(first.job.id).toBe(replay.job.id);
  expect(fixtures.jobs.size).toBe(1);
});

it('reuses the recorded prompt verbatim even when the original description is in another language', async () => {
  const previous = proposal();
  previous.arguments.description = 'Un río azul entre montañas.';
  previous.arguments.exact_text = 'Río de otoño';
  previous.prompt = 'Draw an editorial river landscape.\nLabel the river “Río de otoño”.';
  const requests = recordRequests();
  const next = await proposeImageAgain(TEST_WORKSPACE_ID, previous);
  expect(next.arguments.description).toBe(previous.arguments.description);
  expect(next.prompt).toBe(previous.prompt);
  expect(await jsonOf(requests.find((request) => request.method === 'POST'))).toMatchObject({ prompt: previous.prompt });
  expect(requests.some((request) => request.method === 'PATCH')).toBe(false);
});

it('the mock refuses model/quality injection instead of forwarding author-controlled provider settings', async () => {
  enableImageFixture();
  await expect(proposeImage(TEST_WORKSPACE_ID, {
    document_id: FIXTURE_DOCUMENT_ID, purpose: 'illustration', description: 'A blue square',
    engine: 'gateway', style: '', exact_text: '', aspect_ratio: '3:2',
    ...({ model: 'unapproved', quality: 'high', apply_mode: 'auto' } as object),
  }, uid())).rejects.toMatchObject({ data: { code: 'invalid_request' } });
  expect(fixtures.jobs.size).toBe(0);
});

it('disables confirmation with the server’s quota reason without spending', async () => {
  const info = proposal();
  for (let index = 0; index < 20; index += 1) {
    const prior = proposal();
    prior.status = 'discarded';
    prior.confirmed_at = new Date().toISOString();
  }
  const requests = recordRequests();
  mount(info.generation_id);
  await screen.findByText('Daily image confirmation quota reached.');
  expect(screen.getByRole('button', { name: 'Generate' }).hasAttribute('disabled')).toBe(true);
  expect(screen.getByRole('button', { name: 'Edit request' }).hasAttribute('disabled')).toBe(false);
  expect(screen.getByRole('button', { name: 'Discard' }).hasAttribute('disabled')).toBe(false);
  expect(requests.some((request) => pathOf(request).endsWith('/confirm'))).toBe(false);
});

it('edits a Codex prompt while leaving its disabled image settings untouched', async () => {
  const info = proposal();
  info.engine = 'codex';
  info.provider = 'codex';
  info.model = info.model_slug = info.quality = info.output_format = null;
  info.estimated_cost = null;
  const requests = recordRequests();
  mount(info.generation_id);
  fireEvent.click(await screen.findByRole('button', { name: 'Edit request' }));
  fireEvent.change(screen.getByLabelText('Exact prompt'), { target: { value: 'A conceptual green river. No text.' } });
  expect(screen.getByLabelText('Aspect ratio').hasAttribute('disabled')).toBe(true);
  fireEvent.click(screen.getByRole('button', { name: 'Save request' }));
  await screen.findByText('A conceptual green river. No text.');
  const edit = requests.find((request) => request.method === 'PATCH');
  expect(await jsonOf(edit)).toMatchObject({ prompt: 'A conceptual green river. No text.', aspect_ratio: '3:2' });
  expect(requests.some((request) => pathOf(request).endsWith('/confirm'))).toBe(false);
});
