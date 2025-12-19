import { useEffect, useMemo, useRef, useState, type MutableRefObject } from 'react';
import type { ParagraphChild } from '../../../../../../editor';
import { serializeEditableHtml } from '../../../../../../components/common/Editable/Editable';
import { useEditor } from '../../../../../../editor';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

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
    <span 
      ref={rootRef} 
      className="citation-inline inline-block align-baseline relative" 
      role="group" 
      aria-label="Citation" 
      contentEditable={false as any} 
      onMouseDown={(e) => e.stopPropagation()} 
      onClick={(e) => e.stopPropagation()}
    >
      <button 
        type="button" 
        className={cn(
          "inline-flex items-center gap-1 px-1.5 py-0.5 text-sm",
          "bg-emerald-950/40 text-emerald-400 border border-emerald-700/50 rounded",
          "hover:bg-emerald-900/50 transition-colors cursor-pointer"
        )}
        title="Edit citation" 
        onMouseDown={(e) => { e.preventDefault(); setOpen(v => !v); }} 
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setOpen(v => !v); } }}
      >
        <span>{pillText}</span>
        <span className="text-xs opacity-60" aria-hidden>▾</span>
      </button>
      {open && (
        <div 
          className="absolute left-0 top-full mt-1 z-50 bg-popover border border-border rounded-lg shadow-lg p-3 min-w-[240px]" 
          onMouseDown={(e) => e.stopPropagation()}
        >
          <div className="flex items-center gap-2 mb-2">
            <label className="text-xs text-muted-foreground w-16 shrink-0">Keys</label>
            <Input className="h-8 text-sm" type="text" placeholder="smith2020, doe2021" value={keysStr} onChange={(e) => setKeysStr(e.target.value)} />
          </div>
          <div className="flex items-center gap-2 mb-2">
            <label className="text-xs text-muted-foreground w-16 shrink-0">Style</label>
            <select 
              className="flex-1 h-8 px-2 text-sm border border-input rounded-md bg-background"
              value={style} 
              onChange={(e) => setStyle(e.target.value as any)}
            >
              <option value="numeric">Numeric</option>
              <option value="author-year">Author–year</option>
              <option value="ieee">IEEE</option>
            </select>
          </div>
          <div className="flex items-center gap-2 mb-2">
            <label className="text-xs text-muted-foreground w-16 shrink-0">Prefix</label>
            <Input className="h-8 text-sm" type="text" placeholder="see" value={prefix} onChange={(e) => setPrefix(e.target.value)} />
          </div>
          <div className="flex items-center gap-2 mb-2">
            <label className="text-xs text-muted-foreground w-16 shrink-0">Locator</label>
            <Input className="h-8 text-sm" type="text" placeholder="p. 12" value={locator} onChange={(e) => setLocator(e.target.value)} />
          </div>
          <div className="flex items-center gap-2 mb-3">
            <label className="text-xs text-muted-foreground w-16 shrink-0">Suffix</label>
            <Input className="h-8 text-sm" type="text" placeholder="ch. 2" value={suffix} onChange={(e) => setSuffix(e.target.value)} />
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
