import './SlashMenu.css';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useEditor } from '../../../editor';
import { aiBeatItem } from './items/aiBeat';
import { tableItem } from './items/table';
import { serializeEditableHtml } from '../../common/Editable/Editable';
import type { SlashContext, SlashItem } from './types';

export const SLASH_MENU_EVENT = 'colwrite:open-slash-menu';
export const SLASH_MENU_VISIBILITY_EVENT = 'colwrite:slash-menu-visibility';

// Lightweight module-level flag so other components can detect current visibility synchronously
let slashMenuOpen = false;
export function isSlashMenuOpen(): boolean { return slashMenuOpen; }

type OpenDetail = { blockId: string };

export function openSlashMenu(blockId: string) {
  const ev = new CustomEvent<OpenDetail>(SLASH_MENU_EVENT as any, { detail: { blockId } as any } as any);
  window.dispatchEvent(ev);
  // Proactively broadcast visibility to suppress other floating UI immediately
  try {
    const visEv = new CustomEvent<{ visible: boolean }>(SLASH_MENU_VISIBILITY_EVENT as any, { detail: { visible: true } as any } as any);
    window.dispatchEvent(visEv);
  } catch {}
}

export function SlashMenu() {
  const { refs, updateHtml, addParagraphChild, documentId, createRemote } = useEditor();
  const [visible, setVisible] = useState(false);
  const [pos, setPos] = useState({ top: 0, left: 0 });
  const [blockId, setBlockId] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement | null>(null);
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);

  // Utilities adapted from FloatingToolbar to compute caret rect reliably
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
    if (zeroRect(rect)) {
      try {
        const marker = document.createElement('span');
        marker.style.display = 'inline-block';
        marker.style.width = '1px';
        marker.style.height = '1em';
        marker.style.opacity = '0';
        marker.textContent = '\u200b';
        range.insertNode(marker);
        rect = marker.getBoundingClientRect();
        const r2 = document.createRange();
        r2.setStartAfter(marker);
        r2.collapse(true);
        const s2 = window.getSelection();
        s2?.removeAllRanges();
        s2?.addRange(r2);
        marker.parentNode?.removeChild(marker);
      } catch {}
    }
    if (zeroRect(rect)) return;
    setPos({ top: rect.top + 20, left: rect.left });
    setBlockId(bid);
    setVisible(true);
    setQuery('');
    setActiveIndex(0);
  };

  useEffect(() => {
    const openListener = (e: Event) => {
      const ce = e as CustomEvent<OpenDetail>;
      const bid = ce.detail?.blockId;
      if (!bid) return;
      openAtCaret(bid);
    };
    window.addEventListener(SLASH_MENU_EVENT, openListener as EventListener);
    return () => window.removeEventListener(SLASH_MENU_EVENT, openListener as EventListener);
  }, []);

  // Broadcast visibility so other floating UIs (e.g., FloatingToolbar) can suspend while the slash menu is open
  useEffect(() => {
    slashMenuOpen = visible;
    try {
      const ev = new CustomEvent<{ visible: boolean }>(SLASH_MENU_VISIBILITY_EVENT as any, { detail: { visible } as any } as any);
      window.dispatchEvent(ev);
    } catch {}
  }, [visible]);

  const items = useMemo(() => {
    const base: SlashItem[] = [aiBeatItem, tableItem];
    return base;
  }, []);

  const filteredItems = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return items.slice();
    const out: any[] = [];
    for (const item of items) {
      const match = (item.label || '').toLowerCase().includes(q) || (item.desc || '').toLowerCase().includes(q);
      if (match) out.push(item);
    }
    return out.length ? out : items.slice();
  }, [items, query]);

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
      if (e.key === 'ArrowDown') { setActiveIndex(i => Math.min(i + 1, filteredItems.length - 1)); e.preventDefault(); }
      if (e.key === 'ArrowUp') { setActiveIndex(i => Math.max(i - 1, 0)); e.preventDefault(); }
      if (e.key === 'Enter') { e.preventDefault(); const item = filteredItems[activeIndex]; if (item) { setVisible(false); item.onSelect(context()); } }
      if (e.key.length === 1 && !e.metaKey && !e.ctrlKey && !e.altKey) {
        setQuery(q => q + e.key);
        e.preventDefault();
      }
      if (e.key === 'Backspace') { setQuery(q => q.slice(0, -1)); e.preventDefault(); }
    };
    const onScroll = () => setVisible(false);
    document.addEventListener('mousedown', onDocClick);
    document.addEventListener('keydown', onKey, true);
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', onScroll);
    return () => {
      document.removeEventListener('mousedown', onDocClick);
      document.removeEventListener('keydown', onKey, true);
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', onScroll);
    };
  }, [visible, filteredItems, activeIndex, query]);

  // Do not move focus away from the editable when opening the slash menu.
  // We capture keys at the document level for navigation/filtering.

  const context = (): SlashContext => ({ blockId: blockId!, refs, updateHtml: (id) => updateHtml(id, serializeEditableHtml(refs.current[id]!)), addParagraphChild, documentId, createRemote });

  if (!visible) return null;
  return (
    <div ref={ref} className="slash-menu" style={{ top: pos.top, left: pos.left }} onMouseDown={(e) => e.preventDefault()} tabIndex={-1}>
      <input className="slash-search" placeholder="Type to filter…" value={query} onChange={(e) => setQuery(e.target.value)} />
      <div className="slash-menu-group">
        {/* Actions group */}
        {filteredItems.some(i => i.group === 'actions') && <div className="slash-group-title">Actions</div>}
        {filteredItems.filter(i => i.group === 'actions').map((it) => {
          const absoluteIndex = filteredItems.findIndex(f => f.id === it.id);
          const active = absoluteIndex === activeIndex;
          return (
            <button key={it.id} className={["slash-item", active ? 'active' : ''].filter(Boolean).join(' ')} onMouseDown={(e) => { e.preventDefault(); setVisible(false); it.onSelect(context()); }} onMouseEnter={() => setActiveIndex(absoluteIndex)}>
              <span className="icon">{it.icon || '•'}</span>
              <span className="label">
                <span className="title">{it.label}</span>
                {it.desc && <span className="desc">{it.desc}</span>}
              </span>
            </button>
          );
        })}
        {/* Insert group */}
        {filteredItems.some(i => i.group === 'insert') && <div className="slash-group-title">Insert</div>}
        {filteredItems.filter(i => i.group === 'insert').map((it) => {
          const absoluteIndex = filteredItems.findIndex(f => f.id === it.id);
          const active = absoluteIndex === activeIndex;
          return (
            <button key={it.id} className={["slash-item", active ? 'active' : ''].filter(Boolean).join(' ')} onMouseDown={(e) => { e.preventDefault(); setVisible(false); it.onSelect(context()); }} onMouseEnter={() => setActiveIndex(absoluteIndex)}>
              <span className="icon">{it.icon || '•'}</span>
              <span className="label">
                <span className="title">{it.label}</span>
                {it.desc && <span className="desc">{it.desc}</span>}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}


