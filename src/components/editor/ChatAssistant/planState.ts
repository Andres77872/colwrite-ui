import type { AgentPlan } from '@/api/assistant/streamParser';

export const SECTION_STATUS = {
  pending: 'Pending', working: 'Working', proposed: 'Proposed for review', needs_attention: 'Needs attention',
};
export const PLAN_STATUS = {
  proposed: 'Proposed', running: 'Writing', stopped: 'Stopped', done: 'Drafted', discarded: 'Discarded', superseded: 'Superseded',
};

/** Name content changes, not every progress tick, when a revision arrives. */
export function planChanges(before: AgentPlan, after: AgentPlan): string[] {
  const changes = [];
  if (before.brief !== after.brief) changes.push('Brief changed');
  const held = new Map(before.sections.map((section) => [section.id, section]));
  for (const section of after.sections) {
    const old = held.get(section.id);
    if (!old) changes.push(`Added: ${section.title}`);
    else if (old.title !== section.title || old.goal !== section.goal || JSON.stringify(old.sources) !== JSON.stringify(section.sources)) {
      changes.push(`Updated: ${section.title}`);
    }
  }
  const kept = new Set(after.sections.map((section) => section.id));
  for (const section of before.sections) if (!kept.has(section.id)) changes.push(`Removed: ${section.title}`);
  if (before.sections.map((section) => section.id).join(',') !== after.sections.map((section) => section.id).join(',')) changes.push('Section order changed');
  if (before.open_questions.join('\n') !== after.open_questions.join('\n')) changes.push('Open questions changed');
  return changes;
}
