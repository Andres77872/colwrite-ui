import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { createRef, useImperativeHandle } from 'react';
import { renderWithQueryClient as render } from '@/__tests__/queryClient';
import { agentSource } from '@/__tests__/agentSource';
import { ToastProvider } from '@/components/ui/toast';
import { TooltipProvider } from '@/components/ui/tooltip';
import type { AgentClaim } from '@/api/assistant/streamParser';

/**
 * A reply's claim check, as its claim card (P2.UI-3, 13 §7): the verdict,
 * the evidence level, each passage's stance with its work read from the
 * conversation's sources by handle, and Cite and Add to sources for it.
 */

const { EditorProvider } = await import('@/editor');
const { useEditorProbe } = await import('@/editor/__tests__/editorHarness');
const { ReplyClaims } = await import('../ReplyClaims');

const editorRef = createRef<ReturnType<typeof useEditorProbe>>();
function Capture() {
  const editor = useEditorProbe();
  useImperativeHandle(editorRef, () => editor, [editor]);
  return null;
}

const SWITCH = agentSource('S1', { key: 'arxiv:2101.03961', title: 'Switch Transformers', authors: 'William Fedus', year: 2022 });
const STMOE = agentSource('S2', { key: 'arxiv:2202.08906', title: 'ST-MoE', authors: 'Barret Zoph', year: 2022, flags: ['preprint'] });

const PARTLY: AgentClaim = {
  toolCallId: 'call_claim', verdict: 'partly', evidenceLevel: 'full_text', cannotAssess: false,
  passages: [
    { id: 'S1.1', level: 'full_text', stance: 'supports' },
    { id: 'S2.1', level: 'abstract', stance: 'limits' },
    { id: 'S9.1', level: 'snippet', stance: 'unrelated' },
  ],
};

function mount(claims: AgentClaim[]) {
  return render(
    <ToastProvider>
      <TooltipProvider>
        <EditorProvider>
          <Capture />
          <ReplyClaims claims={claims} sources={[SWITCH, STMOE]} />
        </EditorProvider>
      </TooltipProvider>
    </ToastProvider>,
  );
}

beforeEach(() => localStorage.clear());
afterEach(cleanup);

describe('a reply’s claim card', () => {
  it('shows the verdict with each passage, its stance, its level and its work', () => {
    mount([PARTLY]);
    const card = screen.getByRole('region', { name: 'Claim check' });
    expect(within(card).getByText('Partly supported')).toBeTruthy();
    expect(within(card).getByText('Judged on: full text')).toBeTruthy();
    expect(within(card).getByText('The source’s scope is narrower than the claim.')).toBeTruthy();
    const [first, second, missing] = within(card).getAllByRole('listitem');
    expect(first?.textContent).toContain('Supports');
    expect(first?.textContent).toContain('Full text');
    expect(first?.textContent).toContain('Switch Transformers');
    expect(second?.textContent).toContain('Narrows the claim');
    expect(second?.textContent).toContain('Abstract only');
    expect(within(second!).getByText('Preprint')).toBeTruthy();
    // A passage whose source never arrived says so, and offers nothing to cite.
    expect(missing?.textContent).toContain('Passage S9.1: its source was not received.');
    expect(within(missing!).queryByRole('button')).toBeNull();
  });

  it('adds a passage’s work to the page’s sources as its record', async () => {
    mount([PARTLY]);
    fireEvent.click(screen.getByRole('button', { name: 'Add “ST-MoE” to sources' }));
    await waitFor(() => expect(editorRef.current?.doc.sources).toEqual([STMOE.record]));
  });

  it('says it cannot assess a claim on abstracts alone, and how to get the full text', () => {
    mount([{ toolCallId: 'call_2', verdict: 'insufficient', evidenceLevel: 'abstract', cannotAssess: true, passages: [{ id: 'S2.1', level: 'abstract', stance: 'unrelated' }] }]);
    const card = screen.getByRole('region', { name: 'Claim check' });
    expect(card.getAttribute('data-claim-verdict')).toBe('cannot_assess');
    expect(within(card).getByText('Cannot assess without the full text')).toBeTruthy();
    expect(card.textContent).toContain('Upload the paper’s PDF and attach it, or find an open-access copy');
  });
});
