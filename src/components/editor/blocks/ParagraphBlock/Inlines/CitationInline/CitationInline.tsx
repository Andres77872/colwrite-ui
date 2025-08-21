import './CitationInline.css';
import { useEffect, useMemo, useRef, useState, type MutableRefObject } from 'react';
import type { ParagraphChild } from '../../../../../../editor';
import { serializeEditableHtml } from '../../../../../../components/common/Editable/Editable';
import { useEditor } from '../../../../../../editor';

export function CitationInline({
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
  if (child.type !== 'citation') return null;
  const { blocks } = useEditor();

  // Local UI state
  const [keysStr, setKeysStr] = useState((child.keys || []).join(', '));
  const [style, setStyle] = useState(child.style || 'numeric');
  const [prefix, setPrefix] = useState(child.prefix || '');
  const [suffix, setSuffix] = useState(child.suffix || '');
  const [locator, setLocator] = useState(child.locator || '');
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLSpanElement | null>(null);

  // Sync when identity changes
  useEffect(() => {
    setKeysStr((child.keys || []).join(', '));
    setStyle(child.style || 'numeric');
    setPrefix(child.prefix || '');
    setSuffix(child.suffix || '');
    setLocator(child.locator || '');
  }, [child.id]);

  // Debounced persistence to JSON
  useEffect(() => {
    const id = window.setTimeout(() => {
      const keys = keysStr
        .split(/[,;\n]+/)
        .map(s => s.trim())
        .filter(Boolean);
      const next: ParagraphChild = {
        ...(child as any),
        keys,
        style: style as any,
        prefix,
        suffix,
        locator,
      } as any;
      // Only write if changed
      if (JSON.stringify(child) !== JSON.stringify(next)) {
        updateParagraphChild(blockId, child.id, {
          keys,
          style: style as any,
          prefix,
          suffix,
          locator,
        } as any);
      }
    }, 60);
    return () => window.clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [keysStr, style, prefix, suffix, locator]);

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

  const numberLabel = useMemo(() => {
    try {
      const blk = blocks.find(b => (b as any).id === blockId && (b as any).type === 'paragraph') as any;
      const children: ParagraphChild[] = Array.isArray(blk?.children) ? blk.children : [];
      const citations = children.filter(c => (c as any).type === 'citation');
      const idx = citations.findIndex(c => c.id === child.id);
      return (idx >= 0 ? (idx + 1) : 1);
    } catch {
      return 1;
    }
  }, [blocks, blockId, child.id]);

  const pillText = useMemo(() => {
    const keys = keysStr
      .split(/[,;\n]+/)
      .map(s => s.trim())
      .filter(Boolean);
    const locTxt = locator ? (style === 'numeric' ? `, ${locator}` : ` ${locator}`) : '';
    const sufTxt = suffix ? (style === 'numeric' ? `, ${suffix}` : `, ${suffix}`) : '';
    const preTxt = prefix ? `${prefix} ` : '';
    if (style === 'numeric') {
      return `${preTxt}[${numberLabel}]${locTxt}${sufTxt}`.trim();
    }
    // author-year or ieee (simplified placeholder based on keys)
    const body = keys.length ? keys.join('; ') : 'citation';
    return `${preTxt}(${body}${locator ? `, ${locator}` : ''}${suffix ? `, ${suffix}` : ''})`;
  }, [style, keysStr, numberLabel, prefix, suffix, locator]);

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
    <span ref={rootRef} className="citation-inline" role="group" aria-label="Citation" contentEditable={false as any} onMouseDown={(e) => e.stopPropagation()} onClick={(e) => e.stopPropagation()}>
      <button type="button" className="citation-pill" title="Edit citation" onMouseDown={(e) => { e.preventDefault(); setOpen(v => !v); }} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setOpen(v => !v); } } }>
        <span className="citation-label">{pillText}</span>
        <span className="caret" aria-hidden>▾</span>
      </button>
      {open && (
        <div className="citation-popover" onMouseDown={(e) => e.stopPropagation()}>
          <div className="row">
            <label className="lab">Keys</label>
            <input className="inp" type="text" placeholder="smith2020, doe2021" value={keysStr} onChange={(e) => setKeysStr(e.target.value)} />
          </div>
          <div className="row">
            <label className="lab">Style</label>
            <select className="inp" value={style} onChange={(e) => setStyle(e.target.value as any)}>
              <option value="numeric">Numeric</option>
              <option value="author-year">Author–year</option>
              <option value="ieee">IEEE</option>
            </select>
          </div>
          <div className="row">
            <label className="lab">Prefix</label>
            <input className="inp" type="text" placeholder="see" value={prefix} onChange={(e) => setPrefix(e.target.value)} />
          </div>
          <div className="row">
            <label className="lab">Locator</label>
            <input className="inp" type="text" placeholder="p. 12" value={locator} onChange={(e) => setLocator(e.target.value)} />
          </div>
          <div className="row">
            <label className="lab">Suffix</label>
            <input className="inp" type="text" placeholder="ch. 2" value={suffix} onChange={(e) => setSuffix(e.target.value)} />
          </div>
          <div className="actions">
            <button type="button" className="btn danger" title="Remove citation" onMouseDown={onRemove}>Remove</button>
            <button type="button" className="btn" title="Close" onMouseDown={(e) => { e.preventDefault(); setOpen(false); }}>Done</button>
          </div>
        </div>
      )}
    </span>
  );
}
