import type { ElementType, MutableRefObject } from 'react';
import type { BlockKindId, ParagraphChild } from '../../../editor';

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
   * Open the editor of a widget just inserted into `blockId` and put focus
   * in its first field. When the editor closes with the widget still empty
   * (`isEmpty`), the widget is removed and the caret returns to where it
   * stood; otherwise the caret lands just after it, ready to keep typing.
   */
  editInline?: (childId: string, isEmpty: (child: ParagraphChild) => boolean) => void;
  /**
   * Turn the caret's block into `kind` when the command was typed on an
   * otherwise empty line, or add a block of that kind below it when the line
   * holds text. Returns the id of the block to put the caret in.
   */
  applyKind: (kind: BlockKindId) => string;
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
  /**
   * What typing does the same thing: the markdown prefix for a block kind,
   * `Space` for Ask AI. Shown right-aligned in the row, not folded into the
   * description where it used to be truncated away.
   */
  hint?: string;
  /** An AI command: its icon takes the AI colour, as AI does everywhere. */
  ai?: boolean;
  group: 'ai' | 'basic' | 'insert';
  onSelect: (ctx: SlashContext) => Promise<void> | void;
};

