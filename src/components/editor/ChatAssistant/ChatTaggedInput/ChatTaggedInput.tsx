import { forwardRef, useEffect, useImperativeHandle, useRef, useState, useCallback } from 'react';
import { cn } from '@/lib/utils';
import { parseRefParts } from './refParts';

type SelectionRange = { start: number; end: number };

export type ChatTaggedInputHandle = {
  focus: () => void;
  getHost: () => HTMLDivElement | null;
  setSelectionRange: (start: number, end: number) => void;
  getSelectionRange: () => SelectionRange | null;
};

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
  maxLength?: number;
  showStatus?: boolean;
}>(function ChatTaggedInput({ value, onChange, placeholder, disabled, onTriggerPicker, onEditRef, onRemoveRef, onKeyDown, maxLength = 2000, showStatus = true }, ref) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const pendingCaretRef = useRef<SelectionRange | null>(null);
  const [isFocused, setIsFocused] = useState(false);

  const getCaretRange = useCallback((): SelectionRange | null => {
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
  }, []);

  const setCaretRange = useCallback((start: number, _end: number = start) => {
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
    } catch { /* caret restore is best-effort */ }
  }, []);

  const rebuildModelFromDOM = useCallback((): { text: string; caret: SelectionRange | null } => {
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
  }, [getCaretRange, value]);

  const handleInput = useCallback(() => {
    const { text, caret } = rebuildModelFromDOM();
    pendingCaretRef.current = caret;
    
    // Enforce max length
    if (maxLength && text.length > maxLength) {
      const truncated = text.slice(0, maxLength);
      onChange(truncated);
      return;
    }
    
    onChange(text);
  }, [maxLength, onChange, rebuildModelFromDOM]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLDivElement>) => {
    // Enhanced keyboard shortcuts
    if (e.metaKey || e.ctrlKey) {
      switch (e.key) {
        case 'a':
          // Select all - let browser handle this
          break;
        case 'Backspace': {
          // Delete word backwards
          e.preventDefault();
          const selection = window.getSelection();
          if (selection && selection.rangeCount > 0) {
            const range = selection.getRangeAt(0);
            const text = range.startContainer.textContent || '';
            const words = text.split(/\s+/);
            if (words.length > 1) {
              document.execCommand('delete');
            }
          }
          break;
        }
      }
    }
    
    // Call external handler
    onKeyDown?.(e);
  }, [onKeyDown]);

  const handleKeyUp = useCallback((_e: React.KeyboardEvent<HTMLDivElement>) => {
    const caret = getCaretRange();
    if (!caret) return;
    const anchor = caret.start;
    if (value[anchor - 1] === '#') {
      onTriggerPicker?.(anchor - 1);
    }
  }, [getCaretRange, onTriggerPicker, value]);

  const restoreCaretSoon = useCallback(() => {
    requestAnimationFrame(() => {
      const caret = pendingCaretRef.current;
      if (!caret) return;
      setCaretRange(caret.start, caret.end);
      pendingCaretRef.current = null;
    });
  }, [setCaretRange]);

  useImperativeHandle(ref, () => ({
    focus: () => hostRef.current?.focus(),
    getHost: () => hostRef.current,
    setSelectionRange: (start: number, end: number) => {
      pendingCaretRef.current = { start, end };
      restoreCaretSoon();
    },
    getSelectionRange: getCaretRange,
  }), [getCaretRange, restoreCaretSoon]);

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
  }, [onChange, onEditRef, onRemoveRef, restoreCaretSoon, setCaretRange, value]);

  const charCount = value.length;
  const isOverLimit = maxLength && charCount > maxLength;

  return (
    <div className="chat-tagged-input">
      <div
        ref={hostRef}
        className={cn(
          "tagged-ce min-h-[60px] max-h-[120px] overflow-auto p-2 text-sm",
          "border border-input rounded-md bg-background",
          "focus:outline-none focus:ring-2 focus:ring-ring",
          "empty:before:content-[attr(data-placeholder)] empty:before:text-muted-foreground empty:before:pointer-events-none",
          isOverLimit && "border-destructive focus:ring-destructive"
        )}
        contentEditable={!disabled}
        role="textbox"
        aria-multiline="true"
        aria-label={placeholder ? `Input field: ${placeholder}` : 'Text input field'}
        aria-describedby={showStatus ? 'input-status' : undefined}
        data-placeholder={placeholder || ''}
        onInput={handleInput}
        onKeyUp={handleKeyUp}
        onFocus={() => setIsFocused(true)}
        onBlur={() => setIsFocused(false)}
        onPaste={(e) => {
          e.preventDefault();
          const text = e.clipboardData.getData('text/plain');
          
          // Check length before pasting
          const newLength = charCount + text.length;
          if (maxLength && newLength > maxLength) {
            const allowedLength = maxLength - charCount;
            const truncatedText = text.slice(0, allowedLength);
            document.execCommand('insertText', false, truncatedText);
          } else {
            document.execCommand('insertText', false, text);
          }
        }}
        onKeyDown={handleKeyDown}
      />
      {showStatus && (
        <div id="input-status" className="flex items-center justify-between mt-1 text-[10px] text-muted-foreground">
          <div className="flex items-center gap-2">
            <span className="flex items-center gap-0.5">
              <kbd className="px-1 py-0.5 bg-muted rounded text-[9px]">#</kbd> Reference
            </span>
            {isFocused && (
              <>
                <span className="flex items-center gap-0.5">
                  <kbd className="px-1 py-0.5 bg-muted rounded text-[9px]">⌘</kbd>+<kbd className="px-1 py-0.5 bg-muted rounded text-[9px]">⌫</kbd> Delete word
                </span>
              </>
            )}
          </div>
          <div className={cn(isOverLimit && "text-destructive")}>
            {charCount}{maxLength ? `/${maxLength}` : ''}
          </div>
        </div>
      )}
    </div>
  );
});
