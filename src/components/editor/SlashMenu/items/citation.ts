import { Bookmark } from 'lucide-react';
import type { SlashItem } from '../types';
import { insertAndEditInlineChild } from './insertChild';

export const citationItem: SlashItem = {
  id: 'citation',
  label: 'Citation',
  desc: 'Cite a source, searchable by title',
  icon: Bookmark,
  keywords: ['cite', 'reference', 'source', 'bibliography', 'doi', 'paper'],
  group: 'insert',
  onSelect: (ctx) => {
    insertAndEditInlineChild(
      ctx,
      (id) => ({ id, type: 'citation', keys: [], style: 'numeric' }),
      (child) => child.type === 'citation' && (child.keys ?? []).length === 0,
    );
  },
};
