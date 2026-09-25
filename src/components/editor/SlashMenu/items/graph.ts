import { ChartColumn } from 'lucide-react';
import type { SlashItem } from '../types';
import { insertInlineChild } from './insertChild';

export const graphItem: SlashItem = {
  id: 'graph',
  // "Chart", not "Figure": the structured-figure block owns that word, and
  // two menu rows both called Figure made the author guess.
  label: 'Chart',
  desc: 'A bar, line, area or pie chart',
  icon: ChartColumn,
  keywords: ['graph', 'chart', 'plot', 'bar', 'line', 'pie', 'data', 'image', 'figure'],
  group: 'insert',
  onSelect: (ctx) =>
    void insertInlineChild(ctx, (id) => ({
      id,
      type: 'graph',
      kind: 'bar',
      // Placeholder data rather than an empty chart: a blank axis says nothing
      // about what to do next, whereas three labelled bars do.
      data: { values: [3, 5, 2], labels: ['A', 'B', 'C'] },
    })),
};
