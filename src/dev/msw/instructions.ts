import type { AgentContext, DocumentContentOutput, InstructionSource } from '@/api/schema';

export type StandingInstruction = InstructionSource & { text: string };

/** The same section boundaries as the API's standing_instructions. Text stays
 * inside the scripted run; only identities go into events and reply records. */
export function standingInstructions(page: DocumentContentOutput, context: Partial<AgentContext> | null, inline: boolean): StandingInstruction[] {
  const items: StandingInstruction[] = [];
  if (page.instructions?.trim()) items.push({ scope: 'page', block_id: null, label: 'Page', text: page.instructions });
  const focus = new Set([context?.block_id, context?.selection?.block_id, ...(context?.block_ids ?? [])]);
  const blocks = page.blocks ?? [];
  blocks.forEach((heading, index) => {
    if (heading.type !== 'heading' || heading.aiHidden || !heading.instructions?.trim()) return;
    const following = blocks.findIndex((block, at) => at > index && block.type === 'heading' && block.level <= heading.level);
    const scope = blocks.slice(index, following === -1 ? undefined : following).filter((block) => !block.aiHidden);
    if (inline && !scope.some((block) => focus.has(block.id))) return;
    items.push({ scope: 'section', block_id: heading.id,
      label: heading.html.replace(/<[^>]*>/g, '').slice(0, 160) || 'Untitled section', text: heading.instructions });
  });
  return items;
}
