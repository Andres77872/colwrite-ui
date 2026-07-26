import type { SlashItem } from '../types';
import { insertInlineChild } from './insertChild';

export const equationItem: SlashItem = {
  id: 'equation',
  label: 'Equation',
  desc: 'LaTeX maths in the run of text',
  icon: '∑',
  group: 'insert',
  onSelect: (ctx) => insertInlineChild(ctx, (id) => ({ id, type: 'equation', latex: '' })),
};

export const displayEquationItem: SlashItem = {
  id: 'equation-display',
  label: 'Display equation',
  desc: 'Numbered maths on its own centred line',
  icon: '𝑓',
  group: 'insert',
  onSelect: (ctx) =>
    insertInlineChild(ctx, (id) => ({
      id,
      type: 'equation',
      latex: '',
      display: true,
      numbered: true,
    })),
};
