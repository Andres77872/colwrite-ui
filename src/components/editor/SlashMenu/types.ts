import type { MutableRefObject } from 'react';
import type { ParagraphChild } from '../../../editor';

export type SlashContext = {
  blockId: string;
  refs: MutableRefObject<Record<string, HTMLDivElement | null>>;
  updateHtml: (id: string, html: string) => void;
  addParagraphChild: (blockId: string, child: ParagraphChild) => string;
  documentId: string | null;
  createRemote: () => Promise<string>;
};

export type SlashItem = {
  id: string;
  label: string;
  desc?: string;
  icon?: string;
  group: 'actions' | 'insert' | string;
  onSelect: (ctx: SlashContext) => Promise<void> | void;
};


