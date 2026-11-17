import { useState } from 'react';
import { libraryEntry, useEditorActions, useEditorDoc, type ReferenceRecord } from '@/editor';
import { useCiteAndAnnounce } from './citeAtCursor';

/**
 * Cite a reference at the caret, or keep it in the page's sources: what a
 * paper result, an answer's source and a claim's passage all offer, from
 * the record as it came (`libraryEntry`), never from anything shown about
 * it. "In sources" is the page's library and its citations as they are, so
 * a work already there never offers to be added again.
 */
export function useSourceActions(record: ReferenceRecord) {
  const cite = useCiteAndAnnounce();
  const { upsertSources } = useEditorActions();
  const { doc, blocks } = useEditorDoc();
  const [added, setAdded] = useState(false);
  const inLibrary = doc.sources?.some((source) => source.key === record.key) ?? false;
  const cited = blocks.some((block) =>
    block.type === 'paragraph' && block.children?.some((child) => child.type === 'citation' && child.keys.includes(record.key)),
  );
  return {
    inSources: added || inLibrary || cited,
    /** Says where the citation went, which is not always the caret. */
    cite: () => {
      cite([libraryEntry(record)]);
    },
    save: () => {
      upsertSources([libraryEntry(record)]);
      setAdded(true);
    },
  };
}
