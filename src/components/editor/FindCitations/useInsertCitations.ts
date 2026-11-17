import { useBibliography, useEditorActions, type CitationChild, type ReferenceRecord } from '@/editor';
import { uid } from '@/lib/uid';
import { serializeEditableHtml } from '@/components/common/Editable/editableHtml';
import { proseRange, proseText } from '@/components/editor/References/citeAtCursor';
import { placements, type Sentence } from './findCitations';

export type InsertResult = { inserted: number; missed: Sentence[] };

/**
 * Insert the ticked citations into a paragraph as one undo step: each after
 * its sentence (before its closing punctuation), the works new to the page
 * added to its library, all in one `batch()`. A sentence the author edited
 * away since the search is `missed` and gets nothing.
 */
export function useInsertCitations(): (blockId: string, picks: ReadonlyArray<{ sentence: Sentence; records: ReferenceRecord[] }>) => InsertResult {
  const { refs, getBlock, addParagraphChild, updateHtml, upsertSources, batch, markRecentlyChanged } = useEditorActions();
  const bibliography = useBibliography();
  return (blockId, picks) => {
      const block = getBlock(blockId);
      const el = refs.current[blockId];
      if (!el || block?.type !== 'paragraph' || block.locked) return { inserted: 0, missed: picks.map((pick) => pick.sentence) };
      const { placed, missed } = placements(proseText(el), picks);
      if (placed.length === 0) return { inserted: 0, missed };
      const style = bibliography.documentStyle ?? bibliography.style;
      batch(() => {
        const records = new Map<string, ReferenceRecord>();
        for (const { records: works } of placed) for (const record of works) if (!records.has(record.key)) records.set(record.key, record);
        upsertSources([...records.values()]);
        // Later sentences first: a placeholder adds no prose, but a text node
        // split before an earlier point would move it.
        for (const { at, records: works } of placed) {
          const child: CitationChild = { id: uid(), type: 'citation', keys: works.map((work) => work.key), sources: [...works], style };
          const range = proseRange(el, at, at);
          range.collapse(true);
          const placeholder = document.createElement('span');
          placeholder.setAttribute('data-child-id', child.id);
          placeholder.setAttribute('contenteditable', 'false');
          range.insertNode(placeholder);
          // Children before html: html naming a child the block lacks breaks the invariant.
          addParagraphChild(blockId, child);
        }
        updateHtml(blockId, serializeEditableHtml(el));
      });
      markRecentlyChanged([blockId]);
      return { inserted: placed.length, missed };
  };
}
