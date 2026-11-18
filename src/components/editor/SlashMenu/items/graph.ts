import { ChartColumn } from 'lucide-react';
import type { SlashItem } from '../types';
import type { GraphChild } from '@/editor/types';
import { insertInlineChild } from './insertChild';

/** The starter inserted by /Chart. */
export function newGraphChild(id: string): GraphChild {
  return { id, type: 'graph', kind: 'bar', data: { values: [3, 5, 2], labels: ['A', 'B', 'C'] } };
}

export const graphItem: SlashItem = {
  id: 'graph',
  // "Chart", not "Figure": the structured-figure block owns that word, and
  // two menu rows both called Figure made the author guess.
  label: 'Chart',
  desc: 'A bar, line, area or pie chart',
  icon: ChartColumn,
  keywords: ['graph', 'chart', 'plot', 'bar', 'line', 'pie', 'data', 'image', 'figure'],
  group: 'insert',
  onSelect: (ctx) => void insertInlineChild(ctx, newGraphChild),
};
