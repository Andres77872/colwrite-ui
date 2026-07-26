import type { SlashItem } from '../types';
import { insertInlineChild } from './insertChild';

export const tableItem: SlashItem = {
  id: 'table',
  label: 'Table',
  desc: 'Rows and columns you can type straight into',
  icon: '▦',
  group: 'insert',
  onSelect: (ctx) =>
    insertInlineChild(ctx, (id) => ({
      id,
      type: 'table',
      // A header plus two body rows: enough shape to show what the table is
      // for, few enough that Tab-to-add is the obvious next move.
      rows: 3,
      cols: 3,
      data: Array.from({ length: 3 }, () => Array.from({ length: 3 }, () => '')),
      header: true,
      align: ['left', 'left', 'left'],
    })),
};
