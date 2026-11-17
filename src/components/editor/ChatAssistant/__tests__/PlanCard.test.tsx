import { act, cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderWithQueryClient as render } from '@/__tests__/queryClient';
import { recordRequests } from '@/__tests__/server';
import type { AgentPlan } from '@/api/assistant/streamParser';
import { FIXTURE_DOCUMENT_ID, PERSONAL_WORKSPACE_ID } from '@/dev/msw/fixtures';
import { beginPlan, planEvent, planOf, proposePlan, savePlan } from '@/dev/msw/plans';
import { emptyMessage, type ChatMessage } from '../chatUtils';
import { conversationPlans } from '../transcript';
import { PlanCard } from '../PlanCard';
import { PlanProgress } from '../PlanProgress';

afterEach(cleanup);

function fixture() {
  const plan = proposePlan(PERSONAL_WORKSPACE_ID, FIXTURE_DOCUMENT_ID, 'chat-method');
  const location = { workspaceId: PERSONAL_WORKSPACE_ID, documentId: FIXTURE_DOCUMENT_ID, chatId: 'chat-method', planId: plan.plan_id };
  return { plan, location, onStart: vi.fn(), busy: false, canEdit: true };
}
const title = (number: number) => screen.getByRole('textbox', { name: `Section ${number} title` }) as HTMLInputElement;
const brief = () => screen.getByRole('textbox', { name: 'Brief' }) as HTMLTextAreaElement;
const button = (name: string) => screen.getByRole('button', { name }) as HTMLButtonElement;
const ready = () => waitFor(() => expect(brief().readOnly).toBe(false));

describe('the editable plan card', () => {
  it('starts a revision-bound Deep plan, not an HTTP approval or page write', async () => {
    const props = fixture();
    const sent = recordRequests();
    render(<PlanCard {...props} />);
    await ready();
    fireEvent.change(brief(), { target: { value: 'My narrower brief.' } });
    fireEvent.change(screen.getByRole('textbox', { name: 'Section 1 goal' }), { target: { value: 'Keep the mechanism precise.' } });
    fireEvent.click(button('Start writing'));
    expect(props.onStart).toHaveBeenCalledWith(expect.objectContaining({ plan_id: props.plan.plan_id }), expect.objectContaining({
      revision: 1, brief: 'My narrower brief.',
      sections: expect.arrayContaining([expect.objectContaining({ id: 'mechanism', goal: 'Keep the mechanism precise.' })]),
    }));
    expect(sent.map((request) => request.method)).toEqual(['GET']);
  });

  it('offers focusable reorder/add/remove controls and preserves focus on the moved section', async () => {
    const props = fixture();
    render(<PlanCard {...props} />);
    await ready();
    const down = button('Move section 1 down');
    down.focus();
    expect(document.activeElement).toBe(down);
    fireEvent.click(down);
    expect(title(1).value).toBe('Evidence and limits');
    expect(title(2).value).toBe('Routing mechanisms');
    expect(document.activeElement).toBe(button('Move section 2 down'));
    fireEvent.click(button('Remove section 3'));
    expect(document.activeElement).toBe(title(2));
    fireEvent.click(button('Add a section'));
    expect(document.activeElement).toBe(title(3));
    fireEvent.change(title(3), { target: { value: 'Author-added section' } });
    fireEvent.click(button('Start writing'));
    expect(props.onStart.mock.calls[0]?.[1].sections.map((section: { id: string | null; title: string }) => [section.id, section.title])).toEqual([
      ['evidence', 'Evidence and limits'], ['mechanism', 'Routing mechanisms'], [null, 'Author-added section'],
    ]);
  });

  it('saves with the actual GET validator, shows the revision and does not start writing', async () => {
    const props = fixture();
    const sent = recordRequests();
    render(<PlanCard {...props} />);
    await ready();
    fireEvent.change(brief(), { target: { value: 'The edited brief.' } });
    fireEvent.click(button('Save plan changes'));
    await screen.findByText('Plan updated to revision 2.');
    expect(brief().value).toBe('The edited brief.');
    expect(screen.getByText('Brief changed')).toBeTruthy();
    expect(sent.find((request) => request.method === 'PATCH')?.headers.get('If-Match')).toBe('"cwplan:1"');
    expect(planOf(PERSONAL_WORKSPACE_ID, FIXTURE_DOCUMENT_ID, 'chat-method', props.plan.plan_id)?.state).toBe('proposed');
    expect(props.onStart).not.toHaveBeenCalled();
  });

  it('lets only pending sections change while a run is working, including during streaming', async () => {
    const props = fixture();
    props.plan = beginPlan(props.plan, 'run-one');
    render(<PlanCard {...props} busy />);
    await waitFor(() => expect(title(2).readOnly).toBe(false));
    expect(brief().readOnly).toBe(true);
    expect(title(1).readOnly).toBe(true);
    expect(button('Remove section 1').disabled).toBe(true);
    expect(button('Move section 2 up').disabled).toBe(true);
    expect(screen.queryByRole('button', { name: 'Discard plan' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Start writing' })).toBeNull();
    fireEvent.change(title(2), { target: { value: 'Evidence after an author edit' } });
    fireEvent.click(button('Save plan changes'));
    await screen.findByText('Plan updated to revision 3.');
    const saved = planOf(PERSONAL_WORKSPACE_ID, FIXTURE_DOCUMENT_ID, 'chat-method', props.plan.plan_id);
    expect(saved?.sections[0]).toMatchObject({ title: 'Routing mechanisms', state: 'working' });
    expect(saved?.sections[1]).toMatchObject({ title: 'Evidence after an author edit', state: 'pending' });
  });

  it('retains stale edits and their old validator; adopting the current plan is explicit', async () => {
    const props = fixture();
    const sent = recordRequests();
    render(<PlanCard {...props} />);
    await ready();
    fireEvent.change(brief(), { target: { value: 'My unsaved brief.' } });
    savePlan({ ...props.plan, brief: 'Someone else’s brief.' });
    fireEvent.click(button('Save plan changes'));
    await screen.findByText(/The plan changed\. Your edits are kept here/);
    await screen.findByRole('button', { name: 'Use current plan' });
    expect(brief().value).toBe('My unsaved brief.');
    expect(button('Save plan changes').disabled).toBe(true);
    expect(button('Start writing').disabled).toBe(true);
    const patches = sent.filter((request) => request.method === 'PATCH');
    expect(patches).toHaveLength(1);
    expect(patches[0]?.headers.get('If-Match')).toBe('"cwplan:1"');
    fireEvent.click(button('Use current plan'));
    await ready();
    expect(brief().value).toBe('Someone else’s brief.');
    expect(button('Save plan changes').disabled).toBe(true);
    expect(props.onStart).not.toHaveBeenCalled();
  });

  it.each(['proposed', 'stopped'] as const)('discards a %s plan through HTTP without accepting any section', async (state) => {
    const props = fixture();
    props.plan = savePlan({ ...props.plan, state });
    render(<PlanCard {...props} />);
    await ready();
    fireEvent.click(button('Discard plan'));
    await screen.findByText(/Deep · Discarded/);
    expect(screen.queryByRole('button', { name: /Start writing|Continue writing/ })).toBeNull();
    expect(props.onStart).not.toHaveBeenCalled();
  });

  it('keeps a viewer’s plan readable without editable controls', async () => {
    const props = fixture();
    render(<PlanCard {...props} canEdit={false} />);
    expect(brief().readOnly).toBe(true);
    expect(screen.queryByRole('button', { name: 'Start writing' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Save plan changes' })).toBeNull();
  });

  it('does not remount an unsaved card when a later reply carries a newer revision', async () => {
    const props = fixture();
    const first = { ...emptyMessage('assistant'), plan: planEvent(props.plan) };
    function Branch({ rows }: { rows: ChatMessage[] }) {
      return [...conversationPlans(rows)].map(([messageId, plan]) => (
        <div key={messageId}><PlanCard {...props} plan={plan} /></div>
      ));
    }
    const view = render(<Branch rows={[first]} />);
    await ready();
    const field = brief();
    fireEvent.change(field, { target: { value: 'Keep this draft in its first card.' } });
    const newer = savePlan({ ...props.plan, brief: 'An updated server brief.' });
    await act(async () => view.rerender(<Branch rows={[first, { ...emptyMessage('assistant'), plan: planEvent(newer) }]} />));
    expect(screen.getAllByRole('region', { name: 'Plan' })).toHaveLength(1);
    expect(brief()).toBe(field);
    expect(brief().value).toBe('Keep this draft in its first card.');
    expect(screen.getByRole('button', { name: 'Use current plan' })).toBeTruthy();
  });
});

describe('the pinned plan progress', () => {
  it('counts proposed sections as proposals for review, never as accepted changes', () => {
    const plan: AgentPlan = planEvent(fixture().plan);
    plan.state = 'running';
    plan.sections[0]!.state = 'proposed';
    plan.sections[1]!.state = 'working';
    render(<PlanProgress plan={plan} />);
    expect(screen.getByText('1/3 sections proposed for review')).toBeTruthy();
    expect(screen.getByRole('status').textContent).toBe('Working: Evidence and limits');
    expect(screen.queryByText(/accepted/i)).toBeNull();
  });
});
