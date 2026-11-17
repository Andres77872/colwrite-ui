import type { Block, CitationChild, ParagraphBlock } from '@/editor';
import type { AgentSource } from '@/api/assistant/streamParser';
import { resolveAssistantOutput } from '@/editor/assistantOutput';
import { assistantOutputBlocks } from '@/editor/markdown';

/**
 * An inline run's reply, markdown, as document blocks: `[S#]` handles become
 * citations of what the run found, and the target's own `[@key]` markers
 * keep their citations.
 */
export function resultBlocks({
  text,
  citations,
  sources,
}: {
  text: string;
  /** Citations present in the target, the only ones a result may repeat. */
  citations: ReadonlyMap<string, CitationChild>;
  /** What the run's research tools returned, for resolving `[S#]` handles. */
  sources: readonly AgentSource[];
}): Block[] {
  return assistantOutputBlocks(resolveAssistantOutput(text, sources), citations);
}

/** Commentary goes in as callouts, so it reads as a note rather than as the author's prose. */
export function asNotes(blocks: Block[]): Block[] {
  return blocks.map((block) =>
    block.type === 'paragraph' && !block.variant ? ({ ...block, variant: 'callout' } as ParagraphBlock) : block,
  );
}
