import type { ParagraphChild } from '@/editor';
import { uid } from '@/lib/uid';
import { serializeEditableHtml } from '@/components/common/Editable/Editable';
import type { SlashContext } from '../types';

/**
 * Put an inline widget where the caret is.
 *
 * All five insert commands were fifteen identical lines apart from the child
 * object at the end — and each ended in an `as any` cast, so a widget could be
 * inserted with fields its component did not understand and no compiler would
 * say so. `build` receives the generated id and returns a properly typed
 * child.
 *
 * The placeholder span and the `children` entry are written in one pass: they
 * are the two halves of the same thing, and a paragraph whose html and
 * children disagree fails validation for every later edit.
 */
export function insertInlineChild(
  ctx: SlashContext,
  build: (id: string) => ParagraphChild,
): void {
  const { blockId, insertionRange, refs, updateHtml, addParagraphChild } = ctx;
  const editable = refs.current[blockId];
  if (!editable) return;

  const range = insertionRange.cloneRange();
  // Never fall back to the live document selection: the command search owns
  // focus by this point. A detached bookmark or one from another paragraph is
  // safer to reject than to turn into a misplaced/orphan child.
  if (
    !range.startContainer.isConnected ||
    !range.endContainer.isConnected ||
    !editable.contains(range.startContainer) ||
    !editable.contains(range.endContainer)
  ) {
    return;
  }

  const childId = uid();
  const placeholder = document.createElement('span');
  placeholder.setAttribute('data-child-id', childId);
  placeholder.contentEditable = 'false';

  range.deleteContents();
  range.insertNode(placeholder);

  // A trailing text node gives the caret somewhere to land: a placeholder at
  // the very end of a paragraph leaves nowhere to type after the widget.
  const spacer = document.createTextNode(' ');
  placeholder.parentNode?.insertBefore(spacer, placeholder.nextSibling);

  const caret = document.createRange();
  caret.setStart(spacer, 1);
  caret.collapse(true);

  // Focus first because Editable's programmatic-focus path moves the selection
  // to the end. Installing the final range afterwards leaves immediate typing
  // exactly after the newly inserted widget.
  editable.focus({ preventScroll: true });
  const selection = document.getSelection();
  if (selection) {
    selection.removeAllRanges();
    selection.addRange(caret);
  }

  addParagraphChild(blockId, build(childId));
  updateHtml(blockId, serializeEditableHtml(editable));
}
