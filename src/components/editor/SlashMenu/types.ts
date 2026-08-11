import type { ElementType, MutableRefObject } from 'react';
import type { Block, ParagraphChild } from '../../../editor';

export type SlashContext = {
  blockId: string;
  /**
   * The paragraph selection captured before the command search took focus.
   * Reading document.getSelection() when a command runs would return the
   * search input (or document body) instead of the insertion point.
   */
  insertionRange: Range;
  refs: MutableRefObject<Record<string, HTMLDivElement | null>>;
  updateHtml: (id: string, html: string) => void;
  addParagraphChild: (blockId: string, child: ParagraphChild) => string;
  /**
   * Turn the caret's block into one of `type`, or add one below it when the
   * block already holds text. Returns the id of the block to put the caret in.
   */
  replaceOrInsertBlock: (type: Block['type'], level?: 1 | 2 | 3) => string;
  /** Put the caret in a block once React has rendered it. */
  focusBlock: (id: string) => void;
  documentId: string | null;
  createRemote: () => Promise<string>;
};

export type SlashItem = {
  id: string;
  label: string;
  desc?: string;
  /**
   * A lucide component, like every other menu in the app.
   *
   * These used to be emoji strings — ✨ ▦ 🔖 ∑ 𝑓 📈 — which inherit neither
   * colour nor weight from the item and render differently on every platform.
   */
  icon?: ElementType;
  /**
   * Extra terms the filter matches on, for the words people actually type.
   * With label and description alone, "graph" missed Figure, "cite" missed
   * Citation, and "math" and "latex" both landed on the empty state.
   */
  keywords?: readonly string[];
  group: 'basic' | 'actions' | 'insert' | string;
  onSelect: (ctx: SlashContext) => Promise<void> | void;
};

