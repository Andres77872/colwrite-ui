import { useMemo } from 'react';
import { useEditor } from '../../../editor';

export function DocumentFooter() {
  const { blocks } = useEditor();

  const stats = useMemo(() => {
    let paragraphs = 0, headings = 0, dividers = 0, inlines = 0;
    for (const b of blocks) {
      if (b.type === 'paragraph') { paragraphs++; inlines += (b.children || []).length; }
      else if (b.type === 'heading') headings++;
      else if (b.type === 'divider') dividers++;
    }
    return { total: blocks.length, paragraphs, headings, dividers, inlines };
  }, [blocks]);

  return (
    <div className="sticky bottom-0 z-[1000] flex flex-wrap gap-3 border-t border-border mt-3 -mx-3 -mb-3 px-3 py-2 bg-panel rounded-b-[var(--radius-lg)] shadow-[var(--shadow-sm)]">
      <div className="inline-flex gap-2 items-center px-2 py-1 border border-border rounded-sm bg-card transition-colors hover:bg-elev">
        <span className="text-[var(--color-muted-foreground)] text-sm">Blocks</span>
        <span className="font-semibold">{stats.total}</span>
      </div>
      {stats.headings > 0 && (
        <div className="inline-flex gap-2 items-center px-2 py-1 border border-border rounded-sm bg-card transition-colors hover:bg-elev">
          <span className="text-[var(--color-muted-foreground)] text-sm">Headings</span>
          <span className="font-semibold">{headingsLabel(stats.headings)}</span>
        </div>
      )}
      {stats.paragraphs > 0 && (
        <div className="inline-flex gap-2 items-center px-2 py-1 border border-border rounded-sm bg-card transition-colors hover:bg-elev">
          <span className="text-[var(--color-muted-foreground)] text-sm">Paragraphs</span>
          <span className="font-semibold">{stats.paragraphs}</span>
        </div>
      )}
      {stats.dividers > 0 && (
        <div className="inline-flex gap-2 items-center px-2 py-1 border border-border rounded-sm bg-card transition-colors hover:bg-elev">
          <span className="text-[var(--color-muted-foreground)] text-sm">Dividers</span>
          <span className="font-semibold">{stats.dividers}</span>
        </div>
      )}
      {stats.inlines > 0 && (
        <div className="inline-flex gap-2 items-center px-2 py-1 border border-border rounded-sm bg-card transition-colors hover:bg-elev">
          <span className="text-[var(--color-muted-foreground)] text-sm">Inline widgets</span>
          <span className="font-semibold">{stats.inlines}</span>
        </div>
      )}
    </div>
  );
}

function headingsLabel(count: number): string { return String(count); }


