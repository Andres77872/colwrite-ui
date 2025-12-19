import { cn } from '@/lib/utils';
import { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { useEditor } from '../../../editor';
import { aiBeatItem } from './items/aiBeat';
import { tableItem } from './items/table';
import { citationItem } from './items/citation';
import { equationItem } from './items/equation';
import { graphItem } from './items/graph';
import { serializeEditableHtml } from '../../common/Editable/Editable';
import type { SlashContext, SlashItem } from './types';
import { Search } from 'lucide-react';

export const SLASH_MENU_EVENT = 'colwrite:open-slash-menu';
export const SLASH_MENU_VISIBILITY_EVENT = 'colwrite:slash-menu-visibility';

let slashMenuOpen = false;
export function isSlashMenuOpen(): boolean { return slashMenuOpen; }

type OpenDetail = { blockId: string };

export function openSlashMenu(blockId: string) {
  const ev = new CustomEvent<OpenDetail>(SLASH_MENU_EVENT as any, { detail: { blockId } as any } as any);
  window.dispatchEvent(ev);
  try {
    const visEv = new CustomEvent<{ visible: boolean }>(SLASH_MENU_VISIBILITY_EVENT as any, { detail: { visible: true } as any } as any);
    window.dispatchEvent(visEv);
  } catch {}
}

// Group definitions for menu organization
const GROUPS = [
  { id: 'basic', label: 'Basic Blocks', icon: '📝' },
  { id: 'actions', label: 'AI Actions', icon: '✨' },
  { id: 'insert', label: 'Insert', icon: '➕' },
] as const;

export function SlashMenu() {
  const { refs, updateHtml, addParagraphChild, documentId, createRemote, blocks } = useEditor();
  const [visible, setVisible] = useState(false);
  const [pos, setPos] = useState({ top: 0, left: 0 });
  const [blockId, setBlockId] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);

  const zeroRect = (r: DOMRect | undefined | null) => !r || (r.width === 0 && r.height === 0);
  const rectFromNode = (n: Node | null): DOMRect | null => {
    if (!n) return null;
    if (n.nodeType === Node.ELEMENT_NODE) {
      const el = n as HTMLElement;
      const r1 = el.getBoundingClientRect();
      if (!zeroRect(r1)) return r1;
      try {
        const r = document.createRange();
        r.selectNodeContents(el);
        const r2 = r.getBoundingClientRect();
        if (!zeroRect(r2)) return r2;
      } catch {}
      return null;
    }
    if (n.nodeType === Node.TEXT_NODE) {
      try {
        const r = document.createRange();
        r.selectNode(n);
        const r2 = r.getBoundingClientRect();
        return zeroRect(r2) ? null : r2;
      } catch { return null; }
    }
    return null;
  };

  const openAtCaret = (bid: string) => {
    const sel = document.getSelection();
    if (!sel || sel.rangeCount === 0) return;
    const range = sel.getRangeAt(0);
    let rect = (range.getClientRects()[0] as DOMRect | undefined) || range.getBoundingClientRect();
    if (zeroRect(rect)) {
      const sc = range.startContainer as Node;
      rect = rectFromNode(sc) || rectFromNode(sc.previousSibling as Node | null) || rectFromNode(sc.nextSibling as Node | null) || rect;
    }
    if (zeroRect(rect)) return;
    setPos({ top: rect.bottom + 8, left: rect.left });
    setBlockId(bid);
    setVisible(true);
    setQuery('');
    setActiveIndex(0);
    // Focus the input after opening
    setTimeout(() => inputRef.current?.focus(), 10);
  };

  useEffect(() => {
    const openListener = (e: Event) => {
      const ce = e as CustomEvent<OpenDetail>;
      const bid = ce.detail?.blockId;
      if (!bid) return;
      const targetBlock = blocks.find(b => b.id === bid);
      if (!targetBlock || targetBlock.type !== 'paragraph') return;
      openAtCaret(bid);
    };
    window.addEventListener(SLASH_MENU_EVENT, openListener as EventListener);
    return () => window.removeEventListener(SLASH_MENU_EVENT, openListener as EventListener);
  }, [blocks]);

  useEffect(() => {
    slashMenuOpen = visible;
    try {
      const ev = new CustomEvent<{ visible: boolean }>(SLASH_MENU_VISIBILITY_EVENT as any, { detail: { visible } as any } as any);
      window.dispatchEvent(ev);
    } catch {}
  }, [visible]);

  const items = useMemo(() => {
    const base: SlashItem[] = [aiBeatItem, tableItem, citationItem, equationItem, graphItem];
    return base;
  }, []);

  const filteredItems = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return items.slice();
    const out: SlashItem[] = [];
    for (const item of items) {
      const match = (item.label || '').toLowerCase().includes(q) || (item.desc || '').toLowerCase().includes(q);
      if (match) out.push(item);
    }
    return out.length ? out : items.slice();
  }, [items, query]);

  // Group items by their group property
  const groupedItems = useMemo(() => {
    const groups: Record<string, SlashItem[]> = {};
    for (const item of filteredItems) {
      const g = item.group || 'other';
      if (!groups[g]) groups[g] = [];
      groups[g].push(item);
    }
    return groups;
  }, [filteredItems]);

  const context = useCallback((): SlashContext => ({ 
    blockId: blockId!, 
    refs, 
    updateHtml: (id) => updateHtml(id, serializeEditableHtml(refs.current[id]!)), 
    addParagraphChild, 
    documentId, 
    createRemote 
  }), [blockId, refs, updateHtml, addParagraphChild, documentId, createRemote]);

  const handleSelect = useCallback((item: SlashItem) => {
    setVisible(false);
    item.onSelect(context());
  }, [context]);

  // Scroll active item into view
  useEffect(() => {
    if (!visible || !listRef.current) return;
    const activeEl = listRef.current.querySelector('[data-active="true"]');
    if (activeEl) {
      activeEl.scrollIntoView({ block: 'nearest' });
    }
  }, [activeIndex, visible]);

  useEffect(() => {
    if (!visible) return;
    const onDocClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement | null;
      const inside = !!ref.current && !!target && ref.current.contains(target);
      const isControl = !!target?.closest?.('.floating-toolbar');
      if (!inside && !isControl) setVisible(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { setVisible(false); e.preventDefault(); return; }
      if (e.key === 'ArrowDown') { 
        setActiveIndex(i => Math.min(i + 1, filteredItems.length - 1)); 
        e.preventDefault(); 
      }
      if (e.key === 'ArrowUp') { 
        setActiveIndex(i => Math.max(i - 1, 0)); 
        e.preventDefault(); 
      }
      if (e.key === 'Enter') { 
        e.preventDefault(); 
        const item = filteredItems[activeIndex]; 
        if (item) handleSelect(item);
      }
    };
    document.addEventListener('mousedown', onDocClick);
    document.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('mousedown', onDocClick);
      document.removeEventListener('keydown', onKey, true);
    };
  }, [visible, filteredItems, activeIndex, handleSelect]);

  if (!visible) return null;
  
  return (
    <div 
      ref={ref} 
      className={cn(
        "slash-menu fixed z-[300]",
        "w-72 bg-popover border border-border rounded-xl shadow-xl",
        "overflow-hidden animate-in fade-in-0 zoom-in-95 duration-100"
      )}
      style={{ top: pos.top, left: pos.left }} 
      onMouseDown={(e) => e.stopPropagation()} 
      tabIndex={-1}
    >
      {/* Search header */}
      <div className="flex items-center gap-2 px-3 py-2.5 border-b border-border bg-card/50">
        <Search className="h-4 w-4 text-muted-foreground shrink-0" />
        <input
          ref={inputRef}
          type="text"
          className={cn(
            "flex-1 bg-transparent text-sm outline-none",
            "placeholder:text-muted-foreground"
          )}
          placeholder="Search commands..."
          value={query}
          onChange={(e) => { setQuery(e.target.value); setActiveIndex(0); }}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown' || e.key === 'ArrowUp' || e.key === 'Enter') {
              e.preventDefault();
            }
          }}
        />
        {query && (
          <button 
            className="text-xs text-muted-foreground hover:text-foreground"
            onClick={() => setQuery('')}
          >
            Clear
          </button>
        )}
      </div>

      {/* Scrollable list */}
      <div 
        ref={listRef}
        className="overflow-y-auto overscroll-contain"
        style={{ maxHeight: '320px' }}
      >
        {GROUPS.map(group => {
          const groupItems = groupedItems[group.id];
          if (!groupItems || groupItems.length === 0) return null;
          
          return (
            <div key={group.id} className="py-1">
              {/* Group header */}
              <div className="flex items-center gap-2 px-3 py-1.5 text-[11px] font-semibold text-muted-foreground uppercase tracking-wide">
                <span>{group.icon}</span>
                <span>{group.label}</span>
              </div>
              
              {/* Group items */}
              {groupItems.map((item) => {
                const itemIndex = filteredItems.findIndex(f => f.id === item.id);
                const isActive = itemIndex === activeIndex;
                
                return (
                  <button 
                    key={item.id}
                    data-active={isActive}
                    className={cn(
                      "w-full flex items-start gap-3 px-3 py-2 mx-1 rounded-lg text-left",
                      "transition-colors duration-75",
                      isActive ? "bg-accent" : "hover:bg-accent/50"
                    )}
                    style={{ width: 'calc(100% - 8px)' }}
                    onMouseDown={(e) => { e.preventDefault(); handleSelect(item); }} 
                    onMouseEnter={() => setActiveIndex(itemIndex)}
                  >
                    <span className="w-8 h-8 rounded-md bg-secondary flex items-center justify-center text-base shrink-0">
                      {item.icon || '•'}
                    </span>
                    <div className="flex-1 min-w-0 py-0.5">
                      <div className="font-medium text-sm">{item.label}</div>
                      {item.desc && (
                        <div className="text-xs text-muted-foreground mt-0.5 line-clamp-1">{item.desc}</div>
                      )}
                    </div>
                  </button>
                );
              })}
            </div>
          );
        })}

        {/* Empty state */}
        {filteredItems.length === 0 && (
          <div className="py-8 px-4 text-center text-sm text-muted-foreground">
            No commands found for "{query}"
          </div>
        )}
      </div>

      {/* Footer hint */}
      <div className="px-3 py-2 border-t border-border bg-card/30 text-[11px] text-muted-foreground flex items-center gap-3">
        <span><kbd className="px-1 py-0.5 bg-secondary rounded text-[10px]">↑↓</kbd> Navigate</span>
        <span><kbd className="px-1 py-0.5 bg-secondary rounded text-[10px]">↵</kbd> Select</span>
        <span><kbd className="px-1 py-0.5 bg-secondary rounded text-[10px]">Esc</kbd> Close</span>
      </div>
    </div>
  );
}
