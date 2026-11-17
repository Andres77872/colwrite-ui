import { createRef, useImperativeHandle } from 'react';
import { act, cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderWithQueryClient as render } from '@/__tests__/queryClient';
import { http, recordRequests, server } from '@/__tests__/server';
import { assistantRun } from '@/__tests__/assistantRun';
import { EditorProvider } from '@/editor';
import { useEditorProbe, type EditorProbe } from '@/editor/__tests__/editorHarness';
import { ProposalsProvider } from '@/editor/ProposalsContext';
import { ChatSessionsProvider } from '@/components/chat/ChatSessionsContext';
import { TooltipProvider } from '@/components/ui/tooltip';
import { ConfirmContext } from '@/components/ui/confirmContext';
import { ToastContext } from '@/components/ui/toastContext';
import { AgentSocket } from '@/api/assistant/agentSocket';
import { FIXTURE_DOCUMENT_ID, PERSONAL_WORKSPACE_ID, fixtures } from '@/dev/msw/fixtures';
import { previewRuns, seedPreviewRuns } from '@/dev/msw/socket';
import { lastPageKey, readJson, seenRunsKey, writeItem } from '@/lib/storageKeys';
import { resetModuleState } from '@/lib/moduleState';
import { ChatAssistant } from '../ChatAssistant';

const probeRef = createRef<EditorProbe>();
function Capture() {
  const editor = useEditorProbe();
  useImperativeHandle(probeRef, () => editor, [editor]);
  return null;
}
const probe = () => {
  if (!probeRef.current) throw new Error('The editor is not mounted');
  return probeRef.current;
};

async function mount(documentId = FIXTURE_DOCUMENT_ID) {
  writeItem(lastPageKey(PERSONAL_WORKSPACE_ID), documentId);
  const result = render(<ConfirmContext.Provider value={async () => true}><ToastContext.Provider value={{ toast: () => 'toast', dismiss: () => {} }}>
    <EditorProvider><ProposalsProvider><ChatSessionsProvider><TooltipProvider>
    <Capture /><ChatAssistant />
  </TooltipProvider></ChatSessionsProvider></ProposalsProvider></EditorProvider>
  </ToastContext.Provider></ConfirmContext.Provider>);
  await waitFor(() => expect(probe().documentId).toBe(documentId));
  await waitFor(() => expect(probe().loadingDocumentId).toBeNull());
  return result;
}
async function openRuns() {
  fireEvent.click(screen.getByRole('button', { name: 'Runs' }));
  return screen.findByRole('dialog', { name: 'Runs' });
}

beforeEach(() => {
  localStorage.clear();
  resetModuleState();
  Element.prototype.scrollIntoView = vi.fn();
  Element.prototype.scrollTo = vi.fn();
});
afterEach(async () => {
  if (probeRef.current) await act(async () => { await probe().flushPendingSave(); });
  cleanup();
  vi.restoreAllMocks();
});

describe('workspace Runs', () => {
  it('opens an older run’s exact chat branch without starting or resuming generation', async () => {
    seedPreviewRuns();
    const rpc = vi.spyOn(AgentSocket.prototype, 'request');
    const sent = recordRequests();
    await mount();
    const dialog = await openRuns();
    const title = await within(dialog).findByText('Plan a related-work section');
    const row = title.closest('li');
    if (!row) throw new Error('Missing run row');
    fireEvent.click(within(row).getByRole('button', { name: 'Open chat' }));
    await screen.findByText('Here is the related-work plan.');
    expect(screen.queryByText(/server restarted before/)).toBeNull();
    const planned = previewRuns(PERSONAL_WORKSPACE_ID).find((run) => run.id === 'run-preview-plan');
    const read = sent.find((request) => new URL(request.url).pathname.endsWith('/messages'));
    expect(new URL(read!.url).searchParams.get('leaf')).toBe(String(planned?.leaf_id));
    expect(rpc.mock.calls.some(([method]) => method === 'runs.start' || method === 'runs.resume')).toBe(false);
  });

  it('switches to the run’s page, resumes a new generation and writes only its remaining sections', async () => {
    seedPreviewRuns();
    const rpc = vi.spyOn(AgentSocket.prototype, 'request');
    const interrupted = previewRuns(PERSONAL_WORKSPACE_ID).find((run) => run.resumable);
    if (!interrupted?.request?.plan_id) throw new Error('Missing interrupted fixture');
    const originalPlan = fixtures.plans.get(interrupted.request.plan_id)?.plan;
    const firstSet = originalPlan?.sections[0]?.change_set_ids[0];
    await mount('66f0c0ffee0000000000d0c2');
    const dialog = await openRuns();
    fireEvent.click(await within(dialog).findByRole('button', { name: 'Resume' }));
    await waitFor(() => expect(probe().documentId).toBe(FIXTURE_DOCUMENT_ID));
    await waitFor(() => expect(rpc.mock.calls.filter(([method]) => method === 'runs.resume')).toHaveLength(1));
    await screen.findByText(/^3 sections proposed for review\./, {}, { timeout: 15_000 });
    expect(screen.getByText(/server restarted before the remaining two sections/)).toBeTruthy();
    const plan = fixtures.plans.get(interrupted.request.plan_id)?.plan;
    expect(plan?.state).toBe('done');
    expect(plan?.sections.map((section) => section.change_set_ids.length)).toEqual([1, 1, 1]);
    expect(plan?.sections[0]?.change_set_ids).toEqual([firstSet]);
    expect(rpc.mock.calls.some(([method]) => method === 'runs.start')).toBe(false);
    const continued = previewRuns(PERSONAL_WORKSPACE_ID).find((run) => run.resumed_from === interrupted.id);
    await waitFor(() => expect(previewRuns(PERSONAL_WORKSPACE_ID).find((run) => run.resumed_from === interrupted.id)?.status).toBe('completed'));
    expect(continued).toMatchObject({ request: { web: false, effort: 'deep', plan_id: interrupted.request.plan_id } });
    expect(continued?.id).not.toBe(interrupted.id);
  }, 20_000);

  it('marks a chat completed elsewhere until its reply is read, including after remount', async () => {
    seedPreviewRuns();
    const first = await mount();
    fireEvent.click(screen.getByRole('button', { name: /^Chats:/ }));
    const unread = await screen.findByRole('button', { name: 'Research run (checkpoint), reply finished elsewhere' });
    fireEvent.click(unread);
    await screen.findByText(/server restarted before the remaining two sections/);
    await waitFor(() => expect(readJson(seenRunsKey(PERSONAL_WORKSPACE_ID))).toContain('run-preview-plan'));
    fireEvent.click(screen.getByRole('button', { name: /^Chats:/ }));
    expect(screen.queryByRole('button', { name: /reply finished elsewhere/ })).toBeNull();
    first.unmount();
    first.queryClient.clear();
    await mount();
    fireEvent.click(screen.getByRole('button', { name: /^Chats:/ }));
    expect(screen.queryByRole('button', { name: /reply finished elsewhere/ })).toBeNull();
  });

  it('loads older cursor pages and never offers Resume for a run without a checkpoint', async () => {
    const sent = recordRequests();
    server.use(http.get('/workspaces/{workspace_id}/assistant/runs', ({ query, response }) => response(200).json(
      query.get('cursor') === 'older'
        ? { items: [assistantRun({ id: 'old-cli', request: null, resumable: false, engine: 'codex' })], next_cursor: null }
        : { items: [assistantRun({ id: 'recent', status: 'completed', resumable: false })], next_cursor: 'older' },
    )));
    await mount();
    const dialog = await openRuns();
    fireEvent.click(await within(dialog).findByRole('button', { name: 'Show older runs' }));
    await within(dialog).findByText('No checkpoint available. Open the plan to continue.');
    expect(within(dialog).queryByRole('button', { name: 'Resume' })).toBeNull();
    expect(sent.some((request) => new URL(request.url).searchParams.get('cursor') === 'older')).toBe(true);
  });
});
