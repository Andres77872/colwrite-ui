import { BLOCK_KINDS } from '@/editor';
import type { SlashItem } from '../types';

/**
 * The "Basic blocks" group, one item per block kind.
 *
 * Built from the kind registry, so a new kind appears here, in Turn into and
 * in the markdown shortcuts at once. A kind command typed on an empty line
 * turns that line into the kind; on a line with text it adds the block below.
 */
export const basicBlockItems: readonly SlashItem[] = BLOCK_KINDS.map((kind) => ({
  id: `block-${kind.id}`,
  label: kind.label,
  desc: kind.description,
  hint: kind.markdown,
  icon: kind.icon,
  keywords: kind.keywords,
  group: 'basic',
  onSelect: (ctx) => {
    const target = ctx.applyKind(kind.id);
    ctx.focusBlock(target);
  },
}));
