import './ChatTaggedInput.css';
import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';

type SelectionRange = { start: number; end: number };

export type ChatTaggedInputHandle = {
  focus: () => void;
  getHost: () => HTMLDivElement | null;
  setSelectionRange: (start: number, end: number) => void;
  getSelectionRange: () => SelectionRange | null;
};

export function parseRefParts(text: string): Array<string | { kind: 'document' | 'block'; start: number; end: number; refText: string; docId?: string; blockId?: string; source?: 'this' | 'doc' }>{
  const parts: Array<string | { kind: 'document' | 'block'; start: number; end: number; refText: string; docId?: string; blockId?: string; source?: 'this' | 'doc' }> = [];
  if (!text) return [''];
  const pattern = /#doc\/([A-Za-z0-9_-]+)\/([A-Za-z0-9_-]+)|#this\/([A-Za-z0-9_-]+)|#doc\/([A-Za-z0-9_-]+)/g;
  let lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = pattern.exec(text)) !== null) {
    const matchStart = m.index;
    const matchStr = m[0];
    const matchEnd = matchStart + matchStr.length;
    if (matchStart > lastIndex) parts.push(text.slice(lastIndex, matchStart));
    if (m[1] && m[2]) {
      parts.push({ kind: 'block', start: matchStart, end: matchEnd, refText: matchStr, docId: m[1], blockId: m[2], source: 'doc' });
    } else if (m[3]) {
      parts.push({ kind: 'block', start: matchStart, end: matchEnd, refText: matchStr, blockId: m[3], source: 'this' });
    } else if (m[4]) {
      parts.push({ kind: 'document', start: matchStart, end: matchEnd, refText: matchStr, docId: m[4] });
    }
    lastIndex = matchEnd;
  }
  if (lastIndex < text.length) parts.push(text.slice(lastIndex));
  return parts;
}

function shorten(id: string, max = 10): string {
  if (!id) return '';
  if (id.length <= max) return id;
  return id.slice(0, Math.ceil(max / 2)) + '…' + id.slice(-Math.floor(max / 2));
}

export const ChatTaggedInput = forwardRef<ChatTaggedInputHandle, {
  value: string;
  onChange: (next: string) => void;
  placeholder?: string;
  disabled?: boolean;
  onTriggerPicker?: (anchorIndex: number) => void;
  onEditRef?: (start: number, refText: string) => void;
  onRemoveRef?: (start: number, refText: string) => void;
  onKeyDown?: (e: React.KeyboardEvent<HTMLDivElement>) => void;
}>(function ChatTaggedInput({ value, onChange, placeholder, disabled, onTriggerPicker, onEditRef, onRemoveRef, onKeyDown }, ref) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const pendingCaretRef = useRef<SelectionRange | null>(null);

  useImperativeHandle(ref, () => ({
    focus: () => hostRef.current?.focus(),
    getHost: () => hostRef.current,
    setSelectionRange: (start: number, end: number) => { pendingCaretRef.current = { start, end }; restoreCaretSoon(); },
    getSelectionRange: () => getCaretRange(),
  }), []);

  const getCaretRange = (): SelectionRange | null => {
    const root = hostRef.current;
    if (!root) return null;
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) return null;
    const r = sel.getRangeAt(0);
    if (!root.contains(r.startContainer)) return null;
    // Find the top-level child containing the caret
    let top: ChildNode = r.startContainer as ChildNode;
    while (top && top.parentNode !== root && top.parentNode) top = top.parentNode as unknown as ChildNode;
    let index = 0;
    const children = Array.from(root.childNodes) as ChildNode[];
    const lenOf = (n: Node): number => {
      if (n.nodeType === Node.TEXT_NODE) return (n.textContent || '').length;
      if (n.nodeType === Node.ELEMENT_NODE && (n as HTMLElement).dataset?.refText) return ((n as HTMLElement).dataset.refText || '').length;
      return 0;
    };
    for (const child of children) {
      if (child === top) break;
      index += lenOf(child);
    }
    if (top.nodeType === Node.TEXT_NODE) {
      index += Math.min(r.startOffset, (top.textContent || '').length);
    } else if ((top as HTMLElement).dataset?.refText) {
      const parent = r.startContainer === root ? root : (r.startContainer.parentNode as Node | null);
      const childIndex = children.indexOf(top);
      const offsetInParent = r.startContainer === root ? r.startOffset : (parent ? Array.prototype.indexOf.call(parent.childNodes, top) + 1 : childIndex + 1);
      index += offsetInParent > childIndex ? lenOf(top) : 0;
    }
    return { start: index, end: index };
  };

  const setCaretRange = (start: number, _end: number = start) => {
    const root = hostRef.current;
    if (!root) return;
    let remaining = start;
    const sel = window.getSelection();
    if (!sel) return;
    const children = Array.from(root.childNodes) as ChildNode[];
    const lenOf = (n: Node): number => {
      if (n.nodeType === Node.TEXT_NODE) return (n.textContent || '').length;
      if (n.nodeType === Node.ELEMENT_NODE && (n as HTMLElement).dataset?.refText) return ((n as HTMLElement).dataset.refText || '').length;
      return 0;
    };
    let targetNode: ChildNode | null = null;
    let targetIsTag = false;
    for (const child of children) {
      const len = lenOf(child);
      if (remaining <= len) { targetNode = child; targetIsTag = child.nodeType === Node.ELEMENT_NODE && !!(child as HTMLElement).dataset?.refText; break; }
      remaining -= len;
    }
    if (!targetNode) { targetNode = root as unknown as ChildNode; remaining = 0; }
    try {
      const range = document.createRange();
      if (targetNode.nodeType === Node.TEXT_NODE) {
        range.setStart(targetNode, Math.min(remaining, (targetNode.textContent || '').length));
      } else if (targetIsTag) {
        const idx = children.indexOf(targetNode);
        const before = remaining === 0;
        range.setStart(root, Math.max(0, idx + (before ? 0 : 1)));
      } else {
        // Fallback: place at end
        range.setStart(root, root.childNodes.length);
      }
      range.collapse(true);
      sel.removeAllRanges();
      sel.addRange(range);
    } catch {}
  };

  const rebuildModelFromDOM = (): { text: string; caret: SelectionRange | null } => {
    const root = hostRef.current;
    if (!root) return { text: value, caret: null };
    let out = '';
    const children = Array.from(root.childNodes);
    for (const child of children) {
      if (child.nodeType === Node.TEXT_NODE) out += child.textContent || '';
      else if (child.nodeType === Node.ELEMENT_NODE && (child as HTMLElement).dataset?.refText) out += (child as HTMLElement).dataset.refText || '';
    }
    const caret = getCaretRange();
    return { text: out, caret };
  };

  const handleInput = () => {
    const { text, caret } = rebuildModelFromDOM();
    pendingCaretRef.current = caret;
    onChange(text);
  };

  const handleKeyUp = (_e: React.KeyboardEvent<HTMLDivElement>) => {
    const caret = getCaretRange();
    if (!caret) return;
    const anchor = caret.start;
    if (value[anchor - 1] === '#') {
      onTriggerPicker?.(anchor - 1);
    }
  };

  const restoreCaretSoon = () => {
    requestAnimationFrame(() => {
      const caret = pendingCaretRef.current;
      if (!caret) return;
      setCaretRange(caret.start, caret.end);
      pendingCaretRef.current = null;
    });
  };

  // Sync DOM when value changes externally
  useEffect(() => {
    const root = hostRef.current;
    if (!root) return;
    // Build DOM content from value
    const parts = parseRefParts(value);
    const frag = document.createDocumentFragment();
    parts.forEach((p) => {
      if (typeof p === 'string') {
        frag.appendChild(document.createTextNode(p));
      } else {
        const tag = document.createElement('span');
        tag.className = ['ref-tag', p.kind].join(' ');
        tag.setAttribute('contenteditable', 'false');
        tag.dataset.refText = p.refText;
        tag.dataset.start = String(p.start);
        const pill = document.createElement('span');
        pill.className = 'ref-tag-pill';
        const icon = document.createElement('span');
        icon.className = 'ref-tag-icon';
        icon.textContent = p.kind === 'document' ? '📄' : '🔖';
        const text = document.createElement('span');
        text.className = 'ref-tag-text';
        text.textContent = p.kind === 'document'
          ? `Doc ${shorten(p.docId || '')}`
          : (p.source === 'this' ? `Block` : `Block ${shorten(p.blockId || '')} · Doc ${shorten(p.docId || '')}`);
        pill.appendChild(icon);
        pill.appendChild(text);
        const remove = document.createElement('button');
        remove.type = 'button';
        remove.className = 'ref-tag-remove';
        remove.title = 'Remove';
        remove.textContent = '×';
        remove.addEventListener('mousedown', (ev) => ev.preventDefault());
        remove.addEventListener('click', (ev) => {
          ev.stopPropagation();
          const start = Number(tag.dataset.start || '0');
          const refText = tag.dataset.refText || '';
          const next = value.slice(0, start) + value.slice(start + refText.length);
          onChange(next);
          onRemoveRef?.(start, refText);
          queueMicrotask(() => setCaretRange(start, start));
        });
        tag.addEventListener('mousedown', (ev) => ev.preventDefault());
        tag.addEventListener('click', () => {
          const start = Number(tag.dataset.start || '0');
          const refText = tag.dataset.refText || '';
          onEditRef?.(start, refText);
        });
        tag.appendChild(pill);
        tag.appendChild(remove);
        frag.appendChild(tag);
      }
    });
    root.replaceChildren(frag);
    // restore caret after rebuilding
    if (pendingCaretRef.current) {
      restoreCaretSoon();
    }
  }, [value]);

  return (
    <div className="chat-tagged-input">
      <div
        ref={hostRef}
        className="tagged-ce"
        contentEditable={!disabled}
        role="textbox"
        aria-multiline="true"
        data-placeholder={placeholder || ''}
        onInput={handleInput}
        onKeyUp={handleKeyUp}
        onPaste={(e) => {
          e.preventDefault();
          const text = (e.clipboardData || (window as any).clipboardData).getData('text/plain');
          document.execCommand('insertText', false, text);
        }}
        onKeyDown={onKeyDown}
      />
    </div>
  );
});


