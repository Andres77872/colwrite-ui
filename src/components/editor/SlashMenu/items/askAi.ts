import { Sparkles } from 'lucide-react';
import { openAskAi } from '../../AskAi/askAiEvents';
import type { SlashItem } from '../types';

/** `/ai` — the same prompt Space on an empty line and Mod+J open. */
export const askAiItem: SlashItem = {
  id: 'ask-ai',
  label: 'Ask AI',
  desc: 'Write, edit or explain with AI',
  hint: 'Space',
  icon: Sparkles,
  ai: true,
  keywords: ['ai', 'assistant', 'write', 'continue', 'draft', 'generate', 'summarize', 'improve'],
  group: 'ai',
  onSelect: (ctx) => {
    openAskAi({ blockId: ctx.blockId });
  },
};
