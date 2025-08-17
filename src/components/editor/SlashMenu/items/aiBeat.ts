import type { SlashItem } from '../types';
import { uid } from '../../../../lib/uid';
import { serializeEditableHtml } from '../../../common/Editable/Editable';

export const aiBeatItem: SlashItem = {
  id: 'aibeat',
  label: 'AIBeat',
  desc: 'Generate content with message and prompt',
  icon: '✨',
  group: 'actions',
  onSelect: ({ blockId, refs, updateHtml, addParagraphChild }) => {
    const editable = refs.current[blockId];
    if (!editable) return;
    const sel = document.getSelection();
    if (!sel || sel.rangeCount === 0) return;
    const range = sel.getRangeAt(0);
    const childId = uid();
    // Insert placeholder span for React portal
    const placeholder = document.createElement('span');
    placeholder.setAttribute('data-child-id', childId);
    placeholder.contentEditable = 'false';
    placeholder.textContent = '';
    range.insertNode(placeholder);
    // trailing space for caret
    const spacer = document.createTextNode(' ');
    if (placeholder.nextSibling) placeholder.parentNode?.insertBefore(spacer, placeholder.nextSibling);
    else placeholder.parentNode?.appendChild(spacer);
    // Persist sanitized HTML (placeholders only)
    updateHtml(blockId, serializeEditableHtml(editable));
    // Add the child definition; UI renders via ParagraphBlock portal
    addParagraphChild(blockId, { id: childId, type: 'aiBeat', message: '', prompt: '', output: '', collapsed: false } as any);
  },
};


