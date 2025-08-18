import './DocumentFooter.css';
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
    <div className="doc-footer">
      <div className="df-item"><span className="label">Blocks</span><span className="value">{stats.total}</span></div>
      {stats.headings > 0 && (
        <div className="df-item"><span className="label">Headings</span><span className="value">{headingsLabel(stats.headings)}</span></div>
      )}
      {stats.paragraphs > 0 && (
        <div className="df-item"><span className="label">Paragraphs</span><span className="value">{stats.paragraphs}</span></div>
      )}
      {stats.dividers > 0 && (
        <div className="df-item"><span className="label">Dividers</span><span className="value">{stats.dividers}</span></div>
      )}
      {stats.inlines > 0 && (
        <div className="df-item"><span className="label">Inline widgets</span><span className="value">{stats.inlines}</span></div>
      )}
    </div>
  );
}

function headingsLabel(count: number): string { return String(count); }


