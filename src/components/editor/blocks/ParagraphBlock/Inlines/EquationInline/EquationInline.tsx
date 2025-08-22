import './EquationInline.css';
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
    <span ref={rootRef} className="equation-inline" role="group" aria-label="Equation" contentEditable={false as any} onMouseDown={(e) => e.stopPropagation()} onClick={(e) => e.stopPropagation()}>
      <button
        type="button"
        className="equation-pill"
        title="Edit equation"
        onMouseDown={(e) => { e.preventDefault(); setOpen(v => !v); }}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setOpen(v => !v); } }}
      >
        <span className="equation-label">
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
        <span className="caret" aria-hidden>▾</span>
      </button>
      {open && (
        <div className="equation-editor" onMouseDown={(e) => e.stopPropagation()}>
          <div className="row">
            <label className="lab">LaTeX</label>
            <input
              className="inp"
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
          <div className="row">
            <label className="lab">Numbered</label>
            <input
              className="inp-chk"
              type="checkbox"
              checked={numbered}
              onChange={(e) => setNumbered(e.target.checked)}
            />
          </div>
          <div className="row">
            <label className="lab">Label ID</label>
            <input
              className="inp"
              type="text"
              placeholder="eq:mass-energy"
              value={labelId}
              onChange={(e) => setLabelId(e.target.value)}
            />
          </div>
          <div className="preview">
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
          <div className="actions">
            <button type="button" className="btn danger" title="Remove equation" onMouseDown={onRemove}>Remove</button>
            <button type="button" className="btn" title="Close" onMouseDown={(e) => { e.preventDefault(); setOpen(false); }}>Done</button>
          </div>
        </div>
      )}
    </span>
  );
}
