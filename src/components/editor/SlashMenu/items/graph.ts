import type { SlashItem } from '../types';
import { uid } from '../../../../lib/uid';
import { serializeEditableHtml } from '../../../common/Editable/Editable';

export const graphItem: SlashItem = {
  id: 'graph',
  label: 'Graph',
  desc: 'Insert an inline chart (bar/line/pie)',
  icon: '📈',
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

    addParagraphChild(
      blockId,
      {
        id: childId,
        type: 'graph',
        kind: 'bar',
        data: { values: [3, 5, 2], labels: ['A', 'B', 'C'] },
        title: '',
      } as any,
    );
  },
};
