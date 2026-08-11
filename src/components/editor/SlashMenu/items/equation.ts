import { Sigma, SquareRadical } from 'lucide-react';
import type { SlashItem } from '../types';
import { insertInlineChild } from './insertChild';

export const equationItem: SlashItem = {
  id: 'equation',
  label: 'Equation',
  desc: 'LaTeX maths in the run of text',
  icon: Sigma,
  keywords: ['math', 'maths', 'latex', 'formula', 'tex', 'inline'],
  group: 'insert',
  onSelect: (ctx) => insertInlineChild(ctx, (id) => ({ id, type: 'equation', latex: '' })),
};

export const displayEquationItem: SlashItem = {
  id: 'equation-display',
  label: 'Display equation',
  desc: 'Numbered maths on its own centred line',
  icon: SquareRadical,
  keywords: ['math', 'maths', 'latex', 'formula', 'tex', 'block', 'numbered'],
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
