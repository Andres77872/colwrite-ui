import type { AgentPlan } from '@/api/assistant/streamParser';
import { Button } from '@/components/ui/button';
import { scrollBehavior } from '@/lib/motion';
import { SECTION_STATUS } from './planState';

/** A proposed section still needs review: never call it accepted or finished. */
export function PlanProgress({ plan }: { plan: AgentPlan }) {
  const proposed = plan.sections.filter((section) => section.state === 'proposed').length;
  const current = plan.sections.find((section) => section.state === 'working')
    ?? plan.sections.find((section) => section.state !== 'proposed');
  return (
    <section aria-label="Plan progress" className="mb-2 rounded-lg border border-border bg-popover px-3 py-2 text-xs">
      <div className="flex items-center justify-between gap-2">
        <span>{proposed}/{plan.sections.length} sections proposed for review</span>
        <Button type="button" variant="ghost" size="xs" onClick={() => {
          const card = document.getElementById(`assistant-plan-${plan.plan_id}`);
          card?.scrollIntoView({ block: 'nearest', behavior: scrollBehavior() });
          card?.focus({ preventScroll: true });
        }}>View plan</Button>
      </div>
      <p role="status" className="mt-1 font-medium">{current ? `${SECTION_STATUS[current.state]}: ${current.title}` : 'All sections proposed for review'}</p>
    </section>
  );
}
