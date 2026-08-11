import { Bookmark } from 'lucide-react';
import type { SlashItem } from '../types';
import { insertInlineChild } from './insertChild';

export const citationItem: SlashItem = {
  id: 'citation',
  label: 'Citation',
  desc: 'Cite a source, searchable by title',
  icon: Bookmark,
  keywords: ['cite', 'reference', 'source', 'bibliography', 'doi', 'paper'],
  group: 'insert',
  onSelect: (ctx) =>
    insertInlineChild(ctx, (id) => ({ id, type: 'citation', keys: [], style: 'numeric' })),
};
