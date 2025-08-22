import type { SlashItem } from '../types';
import { uid } from '../../../../lib/uid';
import { serializeEditableHtml } from '../../../common/Editable/Editable';

export const equationItem: SlashItem = {
  id: 'equation',
  label: 'Equation',
  desc: 'Insert an inline equation (LaTeX)',
  icon: '∑',
  group: 'insert',
  onSelect: ({ blockId, refs, updateHtml, addParagraphChild }) => {
    const editable = refs.current[blockId];
    if (!editable) return;
    const sel = document.getSelection();
    if (!sel || sel.rangeCount === 0) return;
    const range = sel.getRangeAt(0);

    const childId = uid();
    const placeholder = document.createElement('span');
    placeholder.setAttribute('data-child-id', childId);
    placeholder.contentEditable = 'false';
    placeholder.textContent = '';
    range.insertNode(placeholder);

    const spacer = document.createTextNode(' ');
    if (placeholder.nextSibling) placeholder.parentNode?.insertBefore(spacer, placeholder.nextSibling);
    else placeholder.parentNode?.appendChild(spacer);

    updateHtml(blockId, serializeEditableHtml(editable));

    addParagraphChild(blockId, { id: childId, type: 'equation', latex: '', numbered: false, labelId: '' } as any);
  },
};
