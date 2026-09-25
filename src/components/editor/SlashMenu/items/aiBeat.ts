import { WandSparkles } from 'lucide-react';
import type { SlashItem } from '../types';
import { insertInlineChild } from './insertChild';

export const aiBeatItem: SlashItem = {
  id: 'aibeat',
  label: 'AI passage',
  desc: 'Draft a passage here, then place it yourself',
  icon: WandSparkles,
  ai: true,
  keywords: ['ai', 'draft', 'write', 'generate', 'assistant'],
  group: 'insert',
  onSelect: (ctx) =>
    void insertInlineChild(ctx, (id) => ({
      id,
      type: 'aiBeat',
      message: '',
      prompt: '',
      output: '',
    })),
};
