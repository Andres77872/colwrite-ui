import { useMemo } from 'react';
import { useEditor } from '@/editor';
import { countWords } from '@/lib/text';

/**
 * DocumentFooter — the status bar under the canvas.
 *
 * It previously listed block/heading/paragraph/divider counts: structural
 * trivia that told a writer nothing. Word and character counts lead, with the
 * structural totals kept as secondary detail.
 */
export function DocumentFooter() {
  const { blocks, documentId, hasAnyRemoteDocs } = useEditor();

  const stats = useMemo(() => {
    let words = 0;
    let characters = 0;
    let headings = 0;
    let inlines = 0;

    for (const block of blocks) {
      if (block.type === 'heading') headings += 1;
      if (block.type === 'paragraph') inlines += block.children?.length ?? 0;
      if ('html' in block) {
        const text = block.html
          .replace(/<[^>]*>/g, ' ')
          .replace(/&nbsp;/g, ' ')
          .trim();
        words += countWords(block.html);
        characters += text.replace(/\s+/g, ' ').length;
      }
    }

    return { words, characters, blocks: blocks.length, headings, inlines };
  }, [blocks]);

  // Nothing worth reporting on the welcome screen.
  if (hasAnyRemoteDocs === false && !documentId) return null;

  const items: Array<[string, number]> = [
    ['words', stats.words],
    ['characters', stats.characters],
    ['blocks', stats.blocks],
  ];
  if (stats.headings > 0) items.push(['headings', stats.headings]);
  if (stats.inlines > 0) items.push(['inline widgets', stats.inlines]);

  return (
    <div className="flex flex-shrink-0 flex-wrap items-center gap-x-4 gap-y-1 border-t border-border/50 bg-card px-4 py-2">
      {items.map(([label, value]) => (
        <span key={label} className="text-xs text-muted-foreground">
          <span className="font-medium tabular-nums text-foreground/80">
            {value.toLocaleString()}
          </span>{' '}
          {value === 1 ? label.replace(/s$/, '') : label}
        </span>
      ))}
    </div>
  );
}
