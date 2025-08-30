import { useEffect, useMemo, useRef, useState, type MutableRefObject } from 'react';
import type { ParagraphChild } from '../../../../../../editor';
import { serializeEditableHtml } from '../../../../../../components/common/Editable/Editable';

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
      className="equation-inline relative inline-flex items-center"
      role="group"
      aria-label="Equation"
      contentEditable={false as any}
      onMouseDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
    >
      <button
        type="button"
        className="inline-flex items-center gap-1.5 px-2 py-0.5 border border-border rounded-full bg-card cursor-pointer shadow-[0_1px_0_rgba(0,0,0,0.02)] text-[14px] hover:bg-elev"
        title="Edit equation"
        onMouseDown={(e) => { e.preventDefault(); setOpen(v => !v); }}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setOpen(v => !v); } }}
      >
        <span className="whitespace-nowrap font-mono">
          {latex ? (
            katexHtml ? (
              <span className="katex-inline" dangerouslySetInnerHTML={{ __html: katexHtml }} />
            ) : (
              <code>{pillText}</code>
            )
          ) : (
            'Equation'
          )}
        </span>
        <span className="opacity-60" aria-hidden>▾</span>
      </button>
      {open && (
        <div
          className="absolute left-0 top-[calc(100%+6px)] min-w-[420px] bg-popover border border-border rounded-sm shadow-sm p-2.5 z-10"
          onMouseDown={(e) => e.stopPropagation()}
        >
          <div className="grid grid-cols-[92px_1fr] items-center gap-2 mb-2">
            <label className="text-[12px] text-[var(--color-muted-foreground)]">LaTeX</label>
            <input
              className="w-full border border-border bg-card px-2 py-1.5 rounded-md outline-none focus:ring-2 focus:ring-accent focus:border-transparent"
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
          <div className="grid grid-cols-[92px_1fr] items-center gap-2 mb-2">
            <label className="text-[12px] text-[var(--color-muted-foreground)]">Numbered</label>
            <input
              className="w-4 h-4"
              type="checkbox"
              checked={numbered}
              onChange={(e) => setNumbered(e.target.checked)}
            />
          </div>
          <div className="grid grid-cols-[92px_1fr] items-center gap-2 mb-2 last:mb-0">
            <label className="text-[12px] text-[var(--color-muted-foreground)]">Label ID</label>
            <input
              className="w-full border border-border bg-card px-2 py-1.5 rounded-md outline-none focus:ring-2 focus:ring-accent focus:border-transparent"
              type="text"
              placeholder="eq:mass-energy"
              value={labelId}
              onChange={(e) => setLabelId(e.target.value)}
            />
          </div>
          <div className="mt-1.5 p-2 bg-elev rounded-md text-[14px]">
            {latex ? (
              katexHtml ? (
                <span className="katex-preview" dangerouslySetInnerHTML={{ __html: katexHtml }} />
              ) : (
                <code>{latex}</code>
              )
            ) : (
              'Equation preview'
            )}
          </div>
          <div className="flex justify-end gap-2 mt-2">
            <button
              type="button"
              className="px-2.5 py-1.5 rounded-md border border-danger text-danger bg-card hover:opacity-90"
              title="Remove equation"
              onMouseDown={onRemove}
            >
              Remove
            </button>
            <button
              type="button"
              className="px-2.5 py-1.5 rounded-md border border-border bg-card hover:bg-elev"
              title="Close"
              onMouseDown={(e) => { e.preventDefault(); setOpen(false); }}
            >
              Done
            </button>
          </div>
        </div>
      )}
    </span>
  );
}
