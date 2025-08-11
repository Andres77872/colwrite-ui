import './FloatingToolbar.css';
import { useEffect, useRef, useState } from 'react';
import { useEditor } from '../../../editor';
import { streamAiAction, type AiAction } from '../../../services';
import { AIActionMenu } from './AIActionMenu/AIActionMenu';

export function FloatingToolbar() {
  const { exec, refs, updateHtml } = useEditor();
  const [visible, setVisible] = useState(false);
  const [pos, setPos] = useState({ top: 0, left: 0 });
  const [states, setStates] = useState({ bold: false, italic: false, underline: false, strike: false });
  const ref = useRef<HTMLDivElement | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    const onSelection = () => {
      const sel = document.getSelection();
      if (!sel || sel.rangeCount === 0 || sel.isCollapsed) { setVisible(false); return; }
      const range = sel.getRangeAt(0);
      const rect = range.getBoundingClientRect();
      if (!rect || (rect.width === 0 && rect.height === 0)) { setVisible(false); return; }
      // ensure selection is inside our editor
      let node: Node | null = sel.anchorNode;
      let inside = false;
      while (node) {
        if ((node as HTMLElement).classList && (node as HTMLElement).classList.contains('editable')) { inside = true; break; }
        node = (node as Node).parentNode;
      }
      if (!inside) { setVisible(false); return; }

      setPos({
        top: rect.top - 44,
        left: rect.left + rect.width / 2,
      });
      try {
        setStates({
          bold: document.queryCommandState('bold'),
          italic: document.queryCommandState('italic'),
          underline: document.queryCommandState('underline'),
          strike: document.queryCommandState('strikeThrough'),
        });
      } catch {
        // no-op
      }
      setVisible(true);
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

    // Cancel any previous stream
    abortRef.current?.abort();
    abortRef.current = new AbortController();

    // Build wrapper UI inside the editable element
    const wrapper = document.createElement('span');
    wrapper.className = 'ai-suggest';
    wrapper.setAttribute('data-action', action);
    wrapper.contentEditable = 'true';
    wrapper.setAttribute('data-generating', '1');

    const original = document.createElement('span');
    original.className = 'ai-original';
    // Do not allow editing of the original snapshot
    original.contentEditable = 'false';
    const generated = document.createElement('span');
    generated.className = 'ai-generated';
    generated.contentEditable = 'true';

    const controls = document.createElement('span');
    controls.className = 'ai-controls';
    controls.contentEditable = 'false';
    const acceptBtn = document.createElement('button');
    acceptBtn.type = 'button';
    acceptBtn.className = 'ai-accept';
    acceptBtn.title = 'Accept';
    acceptBtn.textContent = '✔';
    const rejectBtn = document.createElement('button');
    rejectBtn.type = 'button';
    rejectBtn.className = 'ai-reject';
    rejectBtn.title = 'Reject';
    rejectBtn.textContent = '✖';
    const stopBtn = document.createElement('button');
    stopBtn.type = 'button';
    stopBtn.className = 'ai-stop';
    stopBtn.title = 'Stop generating';
    stopBtn.textContent = '⏹';
    controls.append(acceptBtn, rejectBtn, stopBtn);

    // Move selection contents into original
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

    // Position caret inside generated for live editing
    try {
      const r = document.createRange();
      r.selectNodeContents(generated);
      r.collapse(false);
      sel.removeAllRanges();
      sel.addRange(r);
    } catch {}

    // Update doc HTML initially
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

    // Keep document updated when user edits generated content manually
    generated.addEventListener('input', () => schedulePersist());

    // Streaming helpers: stop -> regenerate flow
    let stopped = false;
    const setStopMode = () => {
      stopBtn.className = 'ai-stop';
      stopBtn.title = 'Stop generating';
      stopBtn.textContent = '⏹';
      stopBtn.onmousedown = (e) => { e.preventDefault(); e.stopPropagation(); stopped = true; abortRef.current?.abort(); };
    };
    const setRegenMode = () => {
      stopBtn.className = 'ai-regenerate';
      stopBtn.title = 'Regenerate';
      stopBtn.textContent = '🔄';
      stopBtn.onmousedown = (e) => { e.preventDefault(); e.stopPropagation(); runStream(); };
    };

    const runStream = async () => {
      // Prepare fresh state
      stopped = false;
      wrapper.setAttribute('data-generating', '1');
      wrapper.removeAttribute('data-error');
      // clear previous suggestion
      while (generated.firstChild) generated.removeChild(generated.firstChild);
      // ensure caret is in the generated area
      try {
        const r = document.createRange();
        r.selectNodeContents(generated);
        r.collapse(false);
        const s = window.getSelection();
        s?.removeAllRanges();
        s?.addRange(r);
      } catch {}
      setStopMode();
      // cancel previous and create fresh controller
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
        // after finishing (natural or aborted), allow regeneration
        setRegenMode();
      }
    };

    // kick off initial generation
    await runStream();

    // Controls handlers
    const replaceWithFragment = (frag: DocumentFragment) => {
      const parent = wrapper.parentNode;
      if (!parent) return;
      // Robustly replace wrapper with frag's children to avoid issues with
      // replaceChild(DocumentFragment) in some environments.
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
      // clone generated children into frag (move nodes)
      while (generated.firstChild) frag.appendChild(generated.firstChild);
      // If there is no generated content (e.g. early accept), fall back to original
      if (!frag.firstChild) {
        while (original.firstChild) frag.appendChild(original.firstChild);
      }
      const lastInserted = frag.lastChild as (Node | null);
      replaceWithFragment(frag);
      // Persist immediately to ensure state matches DOM
      updateHtml(blockId, editable.innerHTML);
      // Place caret at end of inserted content
      try {
        if (lastInserted) {
          const r2 = document.createRange();
          if (lastInserted.nodeType === Node.ELEMENT_NODE) {
            r2.selectNodeContents(lastInserted);
            r2.collapse(false);
          } else if (lastInserted.nodeType === Node.TEXT_NODE) {
            r2.setStart(lastInserted, (lastInserted as Text).data.length);
            r2.collapse(true);
          } else {
            r2.setStartAfter(lastInserted);
            r2.collapse(true);
          }
          const s2 = window.getSelection();
          s2?.removeAllRanges();
          s2?.addRange(r2);
        }
      } catch {}
    };
    rejectBtn.onmousedown = (ev) => {
      ev.preventDefault(); ev.stopPropagation();
      stopped = true; abortRef.current?.abort();
      const frag = document.createDocumentFragment();
      while (original.firstChild) frag.appendChild(original.firstChild);
      const lastInserted = frag.lastChild as (Node | null);
      replaceWithFragment(frag);
      // Persist immediately to ensure state matches DOM
      updateHtml(blockId, editable.innerHTML);
      // Place caret at end of restored content
      try {
        if (lastInserted) {
          const r2 = document.createRange();
          if (lastInserted.nodeType === Node.ELEMENT_NODE) {
            r2.selectNodeContents(lastInserted);
            r2.collapse(false);
          } else if (lastInserted.nodeType === Node.TEXT_NODE) {
            r2.setStart(lastInserted, (lastInserted as Text).data.length);
            r2.collapse(true);
          } else {
            r2.setStartAfter(lastInserted);
            r2.collapse(true);
          }
          const s2 = window.getSelection();
          s2?.removeAllRanges();
          s2?.addRange(r2);
        }
      } catch {}
    };
  };

  if (!visible) return null;
  return (
    <div
      ref={ref}
      className="floating-toolbar"
      style={{ top: pos.top, left: pos.left }}
      onMouseDown={(e) => { e.preventDefault(); }}
    >
      <button className={states.bold ? 'active' : ''} onMouseDown={onFormat('bold')} title="Bold">B</button>
      <button className={states.italic ? 'active' : ''} onMouseDown={onFormat('italic')} title="Italic"><i>I</i></button>
      <button className={states.underline ? 'active' : ''} onMouseDown={onFormat('underline')} title="Underline"><u>U</u></button>
      <button className={states.strike ? 'active' : ''} onMouseDown={onFormat('strikeThrough')} title="Strikethrough"><s>S</s></button>
      <div className="sep" />
      <AIActionMenu onAction={(action: AiAction, e: React.MouseEvent) => onAi(action)(e)} />
    </div>
  );
}
