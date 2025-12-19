import { cn } from '@/lib/utils';
import { useEffect, useRef, useState } from 'react';
import { useEditor } from '../../../editor';
import { streamAiAction, type AiAction } from '../../../services';
import { AIActionMenu } from './AIActionMenu/AIActionMenu';
import { Bold, Italic, Underline, Strikethrough } from 'lucide-react';

export function FloatingToolbar() {
  const { exec, refs, updateHtml } = useEditor();
  const [visible, setVisible] = useState(false);
  const [pos, setPos] = useState({ top: 0, left: 0 });
  const [anchor, setAnchor] = useState<'center' | 'left'>('center');
  const [states, setStates] = useState({ bold: false, italic: false, underline: false, strike: false });
  const [hasSelection, setHasSelection] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const slashOpenRef = useRef<boolean>(false);

  useEffect(() => {
    const onSlashVisibility = (e: Event) => {
      const ce = e as CustomEvent<{ visible: boolean }>;
      slashOpenRef.current = !!ce.detail?.visible;
      if (slashOpenRef.current) {
        setVisible(false);
      }
    };
    window.addEventListener('colwrite:slash-menu-visibility', onSlashVisibility as EventListener);
    return () => window.removeEventListener('colwrite:slash-menu-visibility', onSlashVisibility as EventListener);
  }, []);

  useEffect(() => {
    const onSelection = () => {
      const sel = document.getSelection();
      if (!sel || sel.rangeCount === 0) { setHasSelection(false); setVisible(false); return; }

      let node: Node | null = sel.anchorNode;
      let inside = false;
      let editableEl: HTMLElement | null = null;
      while (node) {
        if ((node as HTMLElement).classList && (node as HTMLElement).classList.contains('editable')) { inside = true; editableEl = node as HTMLElement; break; }
        node = (node as Node).parentNode;
      }
      if (!inside || !editableEl) { setHasSelection(false); setVisible(false); return; }

      if (slashOpenRef.current) { setHasSelection(false); setVisible(false); return; }

      const range = sel.getRangeAt(0);
      if (!sel.isCollapsed) {
        let rect = range.getBoundingClientRect();
        if (!rect || (rect.width === 0 && rect.height === 0)) { setHasSelection(false); setVisible(false); return; }
        setPos({ top: rect.top - 44, left: rect.left + rect.width / 2 });
        setAnchor('center');
        try {
          setStates({
            bold: document.queryCommandState('bold'),
            italic: document.queryCommandState('italic'),
            underline: document.queryCommandState('underline'),
            strike: document.queryCommandState('strikeThrough'),
          });
        } catch { /* no-op */ }
        setHasSelection(true);
        setVisible(true);
        return;
      }

      // Collapsed caret handling (simplified from original)
      setHasSelection(false);
      setVisible(false);
    };
    document.addEventListener('selectionchange', onSelection);
    window.addEventListener('scroll', onSelection, true);
    window.addEventListener('resize', onSelection);
    return () => {
      document.removeEventListener('selectionchange', onSelection);
      window.removeEventListener('scroll', onSelection, true);
      window.removeEventListener('resize', onSelection);
    };
  }, []);

  const onFormat = (cmd: string) => (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    exec(cmd);
  };

  const findEditableAndBlockId = (node: Node | null): { el: HTMLDivElement | null; id: string | null } => {
    let cur: Node | null = node;
    while (cur) {
      if ((cur as HTMLElement).classList && (cur as HTMLElement).classList.contains('editable')) break;
      cur = (cur as Node).parentNode;
    }
    const el = (cur as HTMLDivElement) || null;
    if (!el) return { el: null, id: null };
    let found: string | null = null;
    const map = refs.current || {};
    for (const [id, dom] of Object.entries(map)) { if (dom === el) { found = id; break; } }
    return { el, id: found };
  };

  const onAi = (action: AiAction) => async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const sel = document.getSelection();
    if (!sel || sel.rangeCount === 0 || sel.isCollapsed) return;
    const range = sel.getRangeAt(0);
    const { el: editable, id: blockId } = findEditableAndBlockId(range.commonAncestorContainer);
    if (!editable || !blockId) return;

    const selectedText = sel.toString();
    if (!selectedText.trim()) return;

    abortRef.current?.abort();
    abortRef.current = new AbortController();

    const wrapper = document.createElement('span');
    wrapper.className = 'ai-suggest bg-primary/10 rounded px-0.5';
    wrapper.setAttribute('data-action', action);
    wrapper.contentEditable = 'true';
    wrapper.setAttribute('data-generating', '1');

    const original = document.createElement('span');
    original.className = 'ai-original line-through opacity-50';
    original.contentEditable = 'false';
    const generated = document.createElement('span');
    generated.className = 'ai-generated text-primary';
    generated.contentEditable = 'true';

    const controls = document.createElement('span');
    controls.className = 'ai-controls inline-flex gap-1 ml-1';
    controls.contentEditable = 'false';
    
    const acceptBtn = document.createElement('button');
    acceptBtn.type = 'button';
    acceptBtn.className = 'ai-accept inline-flex items-center justify-center w-5 h-5 rounded bg-green-600 text-white text-xs hover:bg-green-500';
    acceptBtn.title = 'Accept';
    acceptBtn.textContent = '✔';
    
    const rejectBtn = document.createElement('button');
    rejectBtn.type = 'button';
    rejectBtn.className = 'ai-reject inline-flex items-center justify-center w-5 h-5 rounded bg-red-600 text-white text-xs hover:bg-red-500';
    rejectBtn.title = 'Reject';
    rejectBtn.textContent = '✖';
    
    const stopBtn = document.createElement('button');
    stopBtn.type = 'button';
    stopBtn.className = 'ai-stop inline-flex items-center justify-center w-5 h-5 rounded bg-zinc-600 text-white text-xs hover:bg-zinc-500';
    stopBtn.title = 'Stop generating';
    stopBtn.textContent = '⏹';
    controls.append(acceptBtn, rejectBtn, stopBtn);

    let originalFrag: DocumentFragment | null = null;
    try {
      originalFrag = range.extractContents();
    } catch {
      originalFrag = document.createDocumentFragment();
      originalFrag.append(document.createTextNode(selectedText));
    }
    if (originalFrag) original.append(originalFrag);
    wrapper.append(original, generated, controls);
    range.insertNode(wrapper);

    updateHtml(blockId, editable.innerHTML);
    setVisible(false);

    let rafPending = false;
    const schedulePersist = () => {
      if (rafPending) return;
      rafPending = true;
      requestAnimationFrame(() => {
        rafPending = false;
        updateHtml(blockId, editable.innerHTML);
      });
    };

    generated.addEventListener('input', () => schedulePersist());

    let stopped = false;
    const setStopMode = () => {
      stopBtn.className = 'ai-stop inline-flex items-center justify-center w-5 h-5 rounded bg-zinc-600 text-white text-xs hover:bg-zinc-500';
      stopBtn.title = 'Stop generating';
      stopBtn.textContent = '⏹';
      stopBtn.onmousedown = (e) => { e.preventDefault(); e.stopPropagation(); stopped = true; abortRef.current?.abort(); };
    };
    const setRegenMode = () => {
      stopBtn.className = 'ai-regenerate inline-flex items-center justify-center w-5 h-5 rounded bg-indigo-600 text-white text-xs hover:bg-indigo-500';
      stopBtn.title = 'Regenerate';
      stopBtn.textContent = '🔄';
      stopBtn.onmousedown = (e) => { e.preventDefault(); e.stopPropagation(); runStream(); };
    };

    const runStream = async () => {
      stopped = false;
      wrapper.setAttribute('data-generating', '1');
      wrapper.removeAttribute('data-error');
      while (generated.firstChild) generated.removeChild(generated.firstChild);
      setStopMode();
      abortRef.current?.abort();
      abortRef.current = new AbortController();
      
      const onChunk = (delta: string) => {
        if (stopped) return;
        if (delta) {
          const last = generated.lastChild;
          if (last && last.nodeType === Node.TEXT_NODE) {
            (last as Text).data += delta;
          } else {
            generated.append(document.createTextNode(delta));
          }
          schedulePersist();
        }
      };
      
      try {
        await streamAiAction({ message: selectedText, action }, { signal: abortRef.current.signal, onChunk });
      } catch (err) {
        if (!stopped) wrapper.setAttribute('data-error', '1');
      } finally {
        wrapper.removeAttribute('data-generating');
        setRegenMode();
      }
    };

    await runStream();

    const replaceWithFragment = (frag: DocumentFragment) => {
      const parent = wrapper.parentNode;
      if (!parent) return;
      const marker = document.createTextNode('');
      parent.insertBefore(marker, wrapper);
      while (frag.firstChild) {
        parent.insertBefore(frag.firstChild, marker);
      }
      parent.removeChild(wrapper);
      parent.removeChild(marker);
      schedulePersist();
    };

    acceptBtn.onmousedown = (ev) => {
      ev.preventDefault(); ev.stopPropagation();
      stopped = true; abortRef.current?.abort();
      const frag = document.createDocumentFragment();
      while (generated.firstChild) frag.appendChild(generated.firstChild);
      if (!frag.firstChild) {
        while (original.firstChild) frag.appendChild(original.firstChild);
      }
      replaceWithFragment(frag);
      updateHtml(blockId, editable.innerHTML);
    };
    
    rejectBtn.onmousedown = (ev) => {
      ev.preventDefault(); ev.stopPropagation();
      stopped = true; abortRef.current?.abort();
      const frag = document.createDocumentFragment();
      while (original.firstChild) frag.appendChild(original.firstChild);
      replaceWithFragment(frag);
      updateHtml(blockId, editable.innerHTML);
    };
  };

  if (!visible) return null;
  
  return (
    <div
      ref={ref}
      className={cn(
        "floating-toolbar fixed z-[100] inline-flex gap-1.5 p-1.5",
        "bg-popover border border-border rounded-md shadow-md",
        anchor === 'center' && "-translate-x-1/2 -translate-y-2",
        anchor === 'left' && "-translate-y-2"
      )}
      style={{ top: pos.top, left: pos.left }}
      onMouseDown={(e) => { e.preventDefault(); }}
    >
      <button 
        className={cn(
          "w-7 h-7 rounded grid place-items-center transition-colors",
          "hover:bg-accent",
          states.bold && "bg-primary/10 text-primary"
        )} 
        onMouseDown={onFormat('bold')} 
        title="Bold"
      >
        <Bold className="h-4 w-4" />
      </button>
      <button 
        className={cn(
          "w-7 h-7 rounded grid place-items-center transition-colors",
          "hover:bg-accent",
          states.italic && "bg-primary/10 text-primary"
        )}
        onMouseDown={onFormat('italic')} 
        title="Italic"
      >
        <Italic className="h-4 w-4" />
      </button>
      <button 
        className={cn(
          "w-7 h-7 rounded grid place-items-center transition-colors",
          "hover:bg-accent",
          states.underline && "bg-primary/10 text-primary"
        )}
        onMouseDown={onFormat('underline')} 
        title="Underline"
      >
        <Underline className="h-4 w-4" />
      </button>
      <button 
        className={cn(
          "w-7 h-7 rounded grid place-items-center transition-colors",
          "hover:bg-accent",
          states.strike && "bg-primary/10 text-primary"
        )}
        onMouseDown={onFormat('strikeThrough')} 
        title="Strikethrough"
      >
        <Strikethrough className="h-4 w-4" />
      </button>
      <div className="w-px h-6 bg-border mx-1" />
      <AIActionMenu disabled={!hasSelection} onAction={(action: AiAction, e: React.MouseEvent) => onAi(action)(e)} />
    </div>
  );
}
