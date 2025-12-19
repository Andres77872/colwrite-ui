import { useEffect, useMemo, useRef, useState, type MutableRefObject } from 'react';
import type { ParagraphChild } from '../../../../../../editor';
import { serializeEditableHtml } from '../../../../../../components/common/Editable/Editable';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

export function EquationInline({
  blockId,
  child,
  updateParagraphChild,
  removeParagraphChild,
  updateHtml,
  refs,
}: {
  blockId: string;
  child: ParagraphChild;
  updateParagraphChild: (blockId: string, childId: string, next: Partial<ParagraphChild>) => void;
  removeParagraphChild: (blockId: string, childId: string) => void;
  updateHtml: (id: string, html: string) => void;
  refs: MutableRefObject<Record<string, HTMLDivElement | null>>;
}) {
  if (child.type !== 'equation') return null;

  // Local UI state
  const [latex, setLatex] = useState(child.latex || '');
  const [numbered, setNumbered] = useState(!!child.numbered);
  const [labelId, setLabelId] = useState(child.labelId || '');
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLSpanElement | null>(null);
  const initialRef = useRef<{ latex: string; numbered: boolean; labelId: string }>({ latex: child.latex || '', numbered: !!child.numbered, labelId: child.labelId || '' });
  const [katexReady, setKatexReady] = useState(() => !!(typeof window !== 'undefined' && (window as any)?.katex));

  // Sync when identity changes
  useEffect(() => {
    setLatex(child.latex || '');
    setNumbered(!!child.numbered);
    setLabelId(child.labelId || '');
    initialRef.current = { latex: child.latex || '', numbered: !!child.numbered, labelId: child.labelId || '' };
  }, [child.id]);

  // Debounced persistence to JSON
  useEffect(() => {
    const id = window.setTimeout(() => {
      const next: ParagraphChild = {
        ...(child as any),
        latex,
        numbered,
        labelId,
      } as any;
      if (JSON.stringify(child) !== JSON.stringify(next)) {
        updateParagraphChild(blockId, child.id, { latex, numbered, labelId } as any);
      }
    }, 60);
    return () => window.clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [latex, numbered, labelId]);

  // Close popover on outside click
  useEffect(() => {
    if (!open) return;
    const onDocMouseDown = (e: MouseEvent) => {
      const t = e.target as HTMLElement | null;
      const inside = !!t && !!rootRef.current && rootRef.current.contains(t);
      if (!inside) setOpen(false);
    };
    document.addEventListener('mousedown', onDocMouseDown, true);
    return () => document.removeEventListener('mousedown', onDocMouseDown, true);
  }, [open]);

  const pillText = useMemo(() => {
    const txt = (latex || '').trim();
    return txt ? (txt.length > 80 ? txt.slice(0, 80) + '…' : txt) : 'Equation';
  }, [latex]);

  // Detect when KaTeX becomes available (script may load after component mounts)
  useEffect(() => {
    if (katexReady) return;
    let timer: number | null = null;
    let tries = 0;
    const check = () => {
      if ((window as any)?.katex) {
        setKatexReady(true);
        return;
      }
      if (tries++ < 40) { // ~6s max at 150ms
        timer = window.setTimeout(check, 150);
      }
    };
    check();
    return () => { if (timer) window.clearTimeout(timer); };
  }, [katexReady]);

  // Optional KaTeX rendering for preview (uses global window.katex if present)
  const katexHtml = useMemo(() => {
    const src = (latex || '').trim();
    if (!src) return '';
    const k = (window as any)?.katex;
    if (!k || typeof k.renderToString !== 'function') return '';
    try {
      return k.renderToString(src, { displayMode: false, throwOnError: false });
    } catch {
      return '';
    }
  }, [latex, katexReady]);

  const onRemove = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const host = refs.current[blockId];
    const el = host?.querySelector(`[data-child-id="${child.id}"]`);
    el?.parentNode?.removeChild(el as any);
    removeParagraphChild(blockId, child.id);
    const editable = refs.current[blockId];
    if (editable) updateHtml(blockId, serializeEditableHtml(editable));
  };

  return (
    <span 
      ref={rootRef} 
      className="equation-inline inline-block align-baseline relative" 
      role="group" 
      aria-label="Equation" 
      contentEditable={false as any} 
      onMouseDown={(e) => e.stopPropagation()} 
      onClick={(e) => e.stopPropagation()}
    >
      <button
        type="button"
        className={cn(
          "inline-flex items-center gap-1 px-1.5 py-0.5",
          "bg-amber-950/40 text-amber-400 border border-amber-700/50 rounded",
          "hover:bg-amber-900/50 transition-colors cursor-pointer font-mono text-sm"
        )}
        title="Edit equation"
        onMouseDown={(e) => { e.preventDefault(); setOpen(v => !v); }}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setOpen(v => !v); } }}
      >
        <span>
          {latex ? (
            katexHtml ? (
              <span dangerouslySetInnerHTML={{ __html: katexHtml }} />
            ) : (
              <code>{pillText}</code>
            )
          ) : (
            'Equation'
          )}
        </span>
        <span className="text-xs opacity-60" aria-hidden>▾</span>
      </button>
      {open && (
        <div 
          className="absolute left-0 top-full mt-1 z-50 bg-popover border border-border rounded-lg shadow-lg p-3 min-w-[280px]" 
          onMouseDown={(e) => e.stopPropagation()}
        >
          <div className="flex items-center gap-2 mb-2">
            <label className="text-xs text-muted-foreground w-20 shrink-0">LaTeX</label>
            <Input
              className="h-8 text-sm font-mono"
              type="text"
              placeholder="E=mc^2"
              value={latex}
              onChange={(e) => setLatex(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') { e.preventDefault(); setOpen(false); }
                if (e.key === 'Escape') { e.preventDefault(); const init = initialRef.current; setLatex(init.latex); setNumbered(init.numbered); setLabelId(init.labelId); setOpen(false); }
              }}
            />
          </div>
          <div className="flex items-center gap-2 mb-2">
            <label className="text-xs text-muted-foreground w-20 shrink-0">Numbered</label>
            <input
              type="checkbox"
              className="h-4 w-4 rounded border-border"
              checked={numbered}
              onChange={(e) => setNumbered(e.target.checked)}
            />
          </div>
          <div className="flex items-center gap-2 mb-3">
            <label className="text-xs text-muted-foreground w-20 shrink-0">Label ID</label>
            <Input
              className="h-8 text-sm"
              type="text"
              placeholder="eq:mass-energy"
              value={labelId}
              onChange={(e) => setLabelId(e.target.value)}
            />
          </div>
          <div className="p-3 bg-muted rounded-md text-center mb-3 min-h-[40px] flex items-center justify-center">
            {latex ? (
              katexHtml ? (
                <span dangerouslySetInnerHTML={{ __html: katexHtml }} />
              ) : (
                <code className="font-mono text-sm">{latex}</code>
              )
            ) : (
              <span className="text-muted-foreground text-sm">Equation preview</span>
            )}
          </div>
          <div className="flex items-center justify-end gap-2">
            <Button type="button" variant="destructive" size="sm" onMouseDown={onRemove}>Remove</Button>
            <Button type="button" variant="outline" size="sm" onMouseDown={(e) => { e.preventDefault(); setOpen(false); }}>Done</Button>
          </div>
        </div>
      )}
    </span>
  );
}
