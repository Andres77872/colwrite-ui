import { Heading2, Minus, Type } from 'lucide-react';
import type { ElementType } from 'react';
import type { Block } from './types';

export interface BlockTypeMeta {
  type: Block['type'];
  label: string;
  icon: ElementType;
}

/**
 * The insertable block types, in menu order.
 *
 * The bottom "Add a block" bar, the gutter "+" menu and the block options
 * "Insert below" section each hard-coded this same list with its own icon
 * choices, so adding a block type meant editing three files.
 */
export const BLOCK_TYPES: readonly BlockTypeMeta[] = [
  { type: 'paragraph', label: 'Paragraph', icon: Type },
  { type: 'heading', label: 'Heading', icon: Heading2 },
  { type: 'divider', label: 'Divider', icon: Minus },
] as const;

const BLOCK_TYPE_LABELS: Record<Block['type'], string> = {
  paragraph: 'Paragraph',
  heading: 'Heading',
  divider: 'Divider',
  code: 'Code',
};

export function blockTypeLabel(type: Block['type']): string {
  return BLOCK_TYPE_LABELS[type] ?? 'Block';
}

export function blockTypeIcon(type: Block['type']): ElementType {
  return BLOCK_TYPES.find((meta) => meta.type === type)?.icon ?? Type;
}
