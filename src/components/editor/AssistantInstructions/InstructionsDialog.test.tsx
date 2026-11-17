import { createRef, useImperativeHandle, useState } from 'react';
import { act, cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { renderWithQueryClient as render } from '@/__tests__/queryClient';
import { EditorProvider } from '@/editor';
import { useEditorProbe, type EditorProbe } from '@/editor/__tests__/editorHarness';
import { fixtures, FIXTURE_DOCUMENT_ID, PERSONAL_WORKSPACE_ID } from '@/dev/msw/fixtures';
import { lastPageKey, writeItem } from '@/lib/storageKeys';
import { InstructionsDialog } from './InstructionsDialog';
import { resetModuleState } from '@/lib/moduleState';
import { getDocument } from '@/data/documents';

const ref = createRef<EditorProbe>();
function Host({ blockId }: { blockId?: string }) {
  const editor = useEditorProbe();
  useImperativeHandle(ref, () => editor, [editor]);
  const [open, setOpen] = useState(true);
  return <InstructionsDialog open={open} onOpenChange={setOpen} blockId={blockId} />;
}
const probe = () => {
  if (!ref.current) throw new Error('Editor not mounted');
  return ref.current;
};
async function mount(blockId?: string) {
  writeItem(lastPageKey(PERSONAL_WORKSPACE_ID), FIXTURE_DOCUMENT_ID);
  // Wait for the actual document before opening the form, as the page menu does.
  const result = render(<EditorProvider><Capture /></EditorProvider>);
  await waitFor(() => expect(probe().loadingDocumentId).toBeNull());
  await waitFor(() => expect(probe().documentId).toBe(FIXTURE_DOCUMENT_ID));
  result.rerender(<EditorProvider><Capture /><Host blockId={blockId} /></EditorProvider>);
  return result;
}
function Capture() {
  const editor = useEditorProbe();
  useImperativeHandle(ref, () => editor, [editor]);
  return null;
}
beforeEach(() => { localStorage.clear(); resetModuleState(); });
afterEach(async () => {
  if (ref.current) await act(async () => { await probe().flushPendingSave(); });
  cleanup();
});

describe('author assistant instructions', () => {
  it('saves page instructions and document type together, reads them back and undoes them together', async () => {
    await mount();
    fireEvent.change(screen.getByLabelText('Page instructions'), { target: { value: 'Use British spelling.' } });
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'technical-report' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save instructions' }));
    expect(probe().doc).toMatchObject({ instructions: 'Use British spelling.', documentType: 'technical-report' });
    await act(async () => { await probe().flushPendingSave(); });
    expect(fixtures.documents.get(FIXTURE_DOCUMENT_ID)).toMatchObject({
      instructions: 'Use British spelling.', documentType: 'technical-report',
    });
    expect((await getDocument(PERSONAL_WORKSPACE_ID, FIXTURE_DOCUMENT_ID)).doc).toMatchObject({
      instructions: 'Use British spelling.', documentType: 'technical-report',
    });
    act(() => probe().undo());
    expect(probe().doc.instructions).toBeUndefined();
    expect(probe().doc.documentType).toBeUndefined();
  });

  it('edits only the heading instructions and preserves them across a real save/read', async () => {
    const page = fixtures.documents.get(FIXTURE_DOCUMENT_ID)!;
    const heading = page.blocks.find((block) => block.type === 'heading')!;
    await mount(heading.id);
    fireEvent.change(screen.getByLabelText('Section instructions'), { target: { value: 'Keep under 400 words.' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save instructions' }));
    await act(async () => { await probe().flushPendingSave(); });
    expect(fixtures.documents.get(FIXTURE_DOCUMENT_ID)?.blocks.find((block) => block.id === heading.id))
      .toMatchObject({ instructions: 'Keep under 400 words.' });
    expect((await getDocument(PERSONAL_WORKSPACE_ID, FIXTURE_DOCUMENT_ID)).doc.blocks.find((block) => block.id === heading.id))
      .toMatchObject({ instructions: 'Keep under 400 words.' });
    expect(probe().doc.instructions).toBeUndefined();
  });

  it('does not write a locked heading or discard a draft changed elsewhere', async () => {
    const page = fixtures.documents.get(FIXTURE_DOCUMENT_ID)!;
    const heading = page.blocks.find((block) => block.type === 'heading')!;
    heading.locked = true;
    await mount(heading.id);
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Save instructions' }).disabled).toBe(true);
    act(() => probe().setHeadingInstructions(heading.id, 'Ignored'));
    expect(probe().blocks.find((block) => block.id === heading.id)).not.toHaveProperty('instructions', 'Ignored');
  });
});
