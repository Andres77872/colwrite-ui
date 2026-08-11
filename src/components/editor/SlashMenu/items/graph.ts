import { ChartColumn } from 'lucide-react';
import type { SlashItem } from '../types';
import { insertInlineChild } from './insertChild';

export const graphItem: SlashItem = {
  id: 'graph',
  label: 'Figure',
  desc: 'A bar, line, area or pie chart',
  icon: ChartColumn,
  keywords: ['graph', 'chart', 'plot', 'bar', 'line', 'pie', 'data', 'image'],
  group: 'insert',
  onSelect: (ctx) =>
    insertInlineChild(ctx, (id) => ({
      id,
      type: 'graph',
      kind: 'bar',
      // Placeholder data rather than an empty chart: a blank axis says nothing
      // about what to do next, whereas three labelled bars do.
      data: { values: [3, 5, 2], labels: ['A', 'B', 'C'] },
    })),
};
