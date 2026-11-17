/** The API's plan lifecycle and pending-section edit rules, in the mock store. */
import type { ChatPlan, ChatPlanUpdateRequest, PlanData, PlanEdit } from '@/api/schema';
import { uid } from '@/lib/uid';
import { fixtures } from './fixtures';

export const planEtag = (plan: Pick<ChatPlan, 'revision'>) => `"cwplan:${plan.revision}"`;

export class MockPlanRefusal extends Error {
  readonly code: 'plan_not_found' | 'invalid_request' | 'stale_plan';
  readonly expected_head: string | null;
  readonly current_head: string | null;

  constructor(
    code: MockPlanRefusal['code'],
    message: string,
    expected_head: string | null = null,
    current_head: string | null = null,
  ) {
    super(message);
    this.code = code;
    this.expected_head = expected_head;
    this.current_head = current_head;
  }
}

export function planOf(workspaceId: string, documentId: string, chatId: string, planId: string): ChatPlan | null {
  const stored = fixtures.plans.get(planId);
  return stored && stored.workspaceId === workspaceId && stored.documentId === documentId && stored.chatId === chatId
    ? stored.plan : null;
}

export function proposePlan(workspaceId: string, documentId: string, chatId: string): ChatPlan {
  const now = new Date().toISOString();
  for (const stored of fixtures.plans.values()) {
    if (stored.workspaceId === workspaceId && stored.chatId === chatId && stored.plan.state === 'proposed') {
      stored.plan = { ...stored.plan, state: 'superseded', revision: stored.plan.revision + 1, updated_at: now };
    }
  }
  const plan: ChatPlan = {
    plan_id: uid(), kind: 'outline', effort: 'deep', state: 'proposed', revision: 1, run_id: null,
    brief: 'Draft a related-work section on expert routing, separating the mechanism, evidence and open questions.',
    sections: [
      { id: 'mechanism', title: 'Routing mechanisms', goal: 'Explain the mechanism using the page’s terminology.', sources: [], state: 'pending', change_set_ids: [] },
      { id: 'evidence', title: 'Evidence and limits', goal: 'Describe what the cited studies establish and what remains uncertain.', sources: [], state: 'pending', change_set_ids: [] },
      { id: 'questions', title: 'Open questions', goal: 'Name the unresolved questions without inventing results.', sources: [], state: 'pending', change_set_ids: [] },
    ],
    open_questions: ['Should the section cover work before 2020?'], created_at: now, updated_at: now,
  };
  fixtures.plans.set(plan.plan_id, { workspaceId, documentId, chatId, plan });
  return plan;
}

function checkedRevision(plan: ChatPlan, revision: number): void {
  if (revision !== plan.revision) {
    throw new MockPlanRefusal('stale_plan', 'The plan changed since this edit was made.', `"cwplan:${revision}"`, planEtag(plan));
  }
}

function newSectionId(title: string, taken: Set<string>): string {
  const stem = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'section';
  let id = stem;
  for (let number = 2; taken.has(id); number++) id = `${stem}-${number}`;
  taken.add(id);
  return id;
}

export function editPlan(plan: ChatPlan, edit: PlanEdit): ChatPlan {
  if (!['proposed', 'running', 'stopped'].includes(plan.state)) {
    throw new MockPlanRefusal('plan_not_found', `This plan is ${plan.state} and can no longer be edited.`);
  }
  checkedRevision(plan, edit.revision);
  if (edit.brief != null && (!edit.brief.trim() || edit.brief.length > 4_000)) {
    throw new MockPlanRefusal('invalid_request', 'The brief must have 1 to 4,000 characters.');
  }
  if (plan.state === 'running' && edit.brief != null && edit.brief !== plan.brief) {
    throw new MockPlanRefusal('invalid_request', 'The brief of a plan that is being written cannot change.');
  }
  const changed = structuredClone(plan);
  if (edit.brief != null) changed.brief = edit.brief;
  if (edit.open_questions != null) {
    if (edit.open_questions.length > 10 || edit.open_questions.some((question) => !question.trim() || question.length > 500)) {
      throw new MockPlanRefusal('invalid_request', 'Open questions must be at most ten sentences of up to 500 characters.');
    }
    changed.open_questions = [...edit.open_questions];
  }
  if (edit.sections != null) {
    if (!edit.sections.length || edit.sections.length > 20) throw new MockPlanRefusal('invalid_request', 'A plan needs 1 to 20 sections.');
    const held = new Map(plan.sections.map((section) => [section.id, section]));
    const taken = new Set(held.keys());
    const seen = new Set<string>();
    changed.sections = edit.sections.map((given): ChatPlan['sections'][number] => {
      const sources = given.sources ?? [];
      const goal = given.goal ?? '';
      if (!given.title.trim() || given.title.length > 200 || goal.length > 1_000
        || sources.length > 20 || sources.some((source) => !/^S[1-9][0-9]{0,5}$/.test(source))) {
        throw new MockPlanRefusal('invalid_request', 'A section has an invalid title, goal or source handle.');
      }
      const id = given.id ?? newSectionId(given.title, taken);
      if (seen.has(id)) throw new MockPlanRefusal('invalid_request', 'A section id is listed twice.');
      seen.add(id);
      const old = given.id ? held.get(given.id) : undefined;
      if (given.id && !old) throw new MockPlanRefusal('invalid_request', 'Send a new section without an id.');
      if (old && old.state !== 'pending' && (
        old.title !== given.title || old.goal !== goal || JSON.stringify(old.sources) !== JSON.stringify(sources)
      )) throw new MockPlanRefusal('invalid_request', `Section ${old.id} is ${old.state} and cannot change.`);
      return { id, title: given.title, goal, sources, state: old?.state ?? 'pending', change_set_ids: old?.change_set_ids ?? [] };
    });
    if (plan.sections.some((section) => section.state !== 'pending' && !seen.has(section.id))) {
      throw new MockPlanRefusal('invalid_request', 'A section already written or being written cannot be removed.');
    }
  }
  return savePlan(changed);
}

export function updatePlan(plan: ChatPlan, revision: number, body: ChatPlanUpdateRequest): ChatPlan {
  if (body.state === 'discarded') {
    checkedRevision(plan, revision);
    if (body.brief != null || body.sections != null || body.open_questions != null) throw new MockPlanRefusal('invalid_request', 'Discarding a plan changes nothing else.');
    if (plan.state !== 'proposed' && plan.state !== 'stopped') throw new MockPlanRefusal('invalid_request', `A ${plan.state} plan cannot be discarded.`);
    return savePlan({ ...plan, state: 'discarded' });
  }
  return editPlan(plan, {
    revision, brief: body.brief ?? null, open_questions: body.open_questions ?? null,
    sections: body.sections?.map((section) => ({ ...section, id: section.id ?? null })) ?? null,
  });
}

export function savePlan(plan: ChatPlan): ChatPlan {
  const stored = fixtures.plans.get(plan.plan_id);
  if (!stored) throw new MockPlanRefusal('plan_not_found', 'Plan not found.');
  const updated = { ...structuredClone(plan), revision: plan.revision + 1, updated_at: new Date().toISOString() };
  stored.plan = updated;
  return updated;
}

export function planEvent(plan: ChatPlan): PlanData {
  return {
    plan_id: plan.plan_id, kind: plan.kind, brief: plan.brief, effort: plan.effort, state: plan.state, revision: plan.revision,
    sections: plan.sections.map(({ change_set_ids: _sets, ...section }) => structuredClone(section)),
    open_questions: [...plan.open_questions],
  };
}

/** Starting is distinct from an HTTP edit: only a Deep run approves it. */
export function beginPlan(plan: ChatPlan, runId: string): ChatPlan {
  const sections: ChatPlan['sections'] = plan.sections.map((section) => ({
    ...structuredClone(section), state: section.state === 'proposed' ? 'proposed' : 'pending',
  }));
  const current = sections.find((section) => section.state !== 'proposed');
  if (current) current.state = 'working';
  return savePlan({ ...plan, state: 'running', run_id: runId, sections });
}

export function writtenSection(plan: ChatPlan, sectionId: string, changeSetId: string): ChatPlan {
  const sections = structuredClone(plan.sections);
  const section = sections.find((item) => item.id === sectionId);
  if (!section) throw new MockPlanRefusal('plan_not_found', 'The section being written is no longer in this plan.');
  section.state = 'proposed';
  section.change_set_ids.push(changeSetId);
  const following = sections.find((item) => item.state !== 'proposed');
  if (following) following.state = 'working';
  return savePlan({ ...plan, sections });
}

export function endPlan(plan: ChatPlan): ChatPlan {
  return savePlan({
    ...plan,
    state: plan.sections.every((section) => section.state === 'proposed') ? 'done' : 'stopped',
    sections: plan.sections.map((section) => ({
      ...structuredClone(section), state: section.state === 'working' ? 'needs_attention' : section.state,
    })),
  });
}
