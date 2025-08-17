import './SlashMenu.css';
import { useEffect, useRef, useState } from 'react';
import { useEditor } from '../../../editor';
import { uid } from '../../../lib/uid';

export const SLASH_MENU_EVENT = 'colwrite:open-slash-menu';

type OpenDetail = { blockId: string };

export function openSlashMenu(blockId: string) {
  const ev = new CustomEvent<OpenDetail>(SLASH_MENU_EVENT as any, { detail: { blockId } as any } as any);
  window.dispatchEvent(ev);
}

export function SlashMenu() {
  const { refs, updateHtml, addParagraphChild } = useEditor();
  const [visible, setVisible] = useState(false);
  const [pos, setPos] = useState({ top: 0, left: 0 });
  const [blockId, setBlockId] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement | null>(null);

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

  useEffect(() => {
    if (!visible) return;
    const onDocClick = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setVisible(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setVisible(false); };
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
  }, [visible]);

  const insertAiBeatWidget = async () => {
    if (!blockId) return;
    const editable = refs.current[blockId];
    if (!editable) return;
    const sel = document.getSelection();
    if (!sel || sel.rangeCount === 0) return;
    const range = sel.getRangeAt(0);
    // Create a placeholder and a child entry; rendering is handled by ParagraphBlock via React
    const childId = uid();
    const placeholder = document.createElement('span');
    placeholder.setAttribute('data-child-id', childId);
    placeholder.contentEditable = 'false';
    placeholder.textContent = '';
    range.insertNode(placeholder);
    // Insert a trailing space for caret navigation
    const spacer = document.createTextNode(' ');
    if (placeholder.nextSibling) placeholder.parentNode?.insertBefore(spacer, placeholder.nextSibling);
    else placeholder.parentNode?.appendChild(spacer);

    // Persist html and child descriptor
    updateHtml(blockId, editable.innerHTML);
    addParagraphChild(blockId, { id: childId, type: 'aiBeat', message: '', prompt: '', output: '', collapsed: false });
    setVisible(false);
  };

  if (!visible) return null;
  return (
    <div ref={ref} className="slash-menu" style={{ top: pos.top, left: pos.left }} onMouseDown={(e) => e.preventDefault()}>
      <div className="slash-menu-group">
        <button className="slash-item" onMouseDown={(e) => { e.preventDefault(); insertAiBeatWidget(); }}>AIBeat</button>
      </div>
    </div>
  );
}


