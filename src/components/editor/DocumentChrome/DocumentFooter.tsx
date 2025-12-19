import { useMemo } from 'react';
import { cn } from '@/lib/utils';
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
    <div className={cn(
      "sticky bottom-0 z-10 flex flex-wrap gap-2",
      "border-t border-border/50 -mx-4 -mb-4 mt-4 px-4 py-2",
      "bg-card/95 backdrop-blur-sm"
    )}>
      <div className="inline-flex gap-1.5 items-center px-2 py-1 rounded-md text-xs bg-muted/50">
        <span className="text-muted-foreground">Blocks</span>
        <span className="font-medium">{stats.total}</span>
      </div>
      {stats.headings > 0 && (
        <div className="inline-flex gap-1.5 items-center px-2 py-1 rounded-md text-xs bg-muted/50">
          <span className="text-muted-foreground">Headings</span>
          <span className="font-medium">{stats.headings}</span>
        </div>
      )}
      {stats.paragraphs > 0 && (
        <div className="inline-flex gap-1.5 items-center px-2 py-1 rounded-md text-xs bg-muted/50">
          <span className="text-muted-foreground">Paragraphs</span>
          <span className="font-medium">{stats.paragraphs}</span>
        </div>
      )}
      {stats.dividers > 0 && (
        <div className="inline-flex gap-1.5 items-center px-2 py-1 rounded-md text-xs bg-muted/50">
          <span className="text-muted-foreground">Dividers</span>
          <span className="font-medium">{stats.dividers}</span>
        </div>
      )}
      {stats.inlines > 0 && (
        <div className="inline-flex gap-1.5 items-center px-2 py-1 rounded-md text-xs bg-muted/50">
          <span className="text-muted-foreground">Inline widgets</span>
          <span className="font-medium">{stats.inlines}</span>
        </div>
      )}
    </div>
  );
}
