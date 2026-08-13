import { Heading1, Heading2, Heading3, Minus, Type } from 'lucide-react';
import type { SlashItem } from '../types';

/**
 * The "Basic blocks" group.
 *
 * The menu declared this group and registered nothing under it, so it never
 * rendered — while the welcome screen told new users to press "/" to insert
 * headings. Every one of these reaches an action the editor context already
 * exposed; the gutter menu was simply the only thing wired to them.
 *
 * A block command replaces the paragraph the caret is in when that paragraph
 * is empty — pressing "/" on a blank line and choosing Heading should give a
 * heading, not a heading underneath an empty paragraph.
 */
function blockItem({
  id,
  label,
  desc,
  icon,
  keywords,
  insert,
}: {
  id: string;
  label: string;
  desc: string;
  icon: SlashItem['icon'];
  keywords: string[];
  insert: (ctx: Parameters<SlashItem['onSelect']>[0]) => string;
}): SlashItem {
  return {
    id,
    label,
    desc,
    icon,
    keywords,
    group: 'basic',
    onSelect: (ctx) => {
      const newId = insert(ctx);
      ctx.focusBlock(newId);
    },
  };
}

export const basicBlockItems: readonly SlashItem[] = [
  blockItem({
    id: 'block-paragraph',
    label: 'Paragraph',
    desc: 'Plain body text',
    icon: Type,
    keywords: ['text', 'body', 'prose', 'p'],
    insert: (ctx) => ctx.replaceOrInsertBlock('paragraph'),
  }),
  blockItem({
    id: 'block-heading-1',
    label: 'Heading 1',
    desc: 'Top-level section title',
    icon: Heading1,
    keywords: ['h1', 'title', 'section'],
    insert: (ctx) => ctx.replaceOrInsertBlock('heading', 1),
  }),
  blockItem({
    id: 'block-heading-2',
    label: 'Heading 2',
    desc: 'Section title',
    icon: Heading2,
    keywords: ['h2', 'subtitle', 'section'],
    insert: (ctx) => ctx.replaceOrInsertBlock('heading', 2),
  }),
  blockItem({
    id: 'block-heading-3',
    label: 'Heading 3',
    desc: 'Sub-section title',
    icon: Heading3,
    keywords: ['h3', 'subsection'],
    insert: (ctx) => ctx.replaceOrInsertBlock('heading', 3),
  }),
  blockItem({
    id: 'block-divider',
    label: 'Divider',
    desc: 'A horizontal rule between sections',
    icon: Minus,
    keywords: ['hr', 'rule', 'separator', 'line', 'break'],
    insert: (ctx) => ctx.replaceOrInsertBlock('divider'),
  }),
];
