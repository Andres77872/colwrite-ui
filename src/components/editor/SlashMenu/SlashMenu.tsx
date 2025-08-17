import './SlashMenu.css';
import { useEffect, useRef, useState } from 'react';
import { useEditor } from '../../../editor';
import { streamAiBeat } from '../../../services';

export const SLASH_MENU_EVENT = 'colwrite:open-slash-menu';

type OpenDetail = { blockId: string };

export function openSlashMenu(blockId: string) {
  const ev = new CustomEvent<OpenDetail>(SLASH_MENU_EVENT as any, { detail: { blockId } as any } as any);
  window.dispatchEvent(ev);
}

export function SlashMenu() {
  const { refs, updateHtml, documentId, createRemote } = useEditor();
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

    // Build widget
    const wrapper = document.createElement('span');
    wrapper.className = 'ai-beat-widget';
    wrapper.contentEditable = 'false';

    // Header with title + actions
    const header = document.createElement('div');
    header.className = 'ai-beat-header';
    const title = document.createElement('span');
    title.className = 'ai-beat-title';
    title.textContent = 'AIBeat';
    const headerActions = document.createElement('span');
    headerActions.className = 'ai-beat-header-actions';
    const collapseBtn = document.createElement('button');
    collapseBtn.type = 'button';
    collapseBtn.className = 'ai-beat-collapse';
    collapseBtn.title = 'Collapse / Expand';
    collapseBtn.textContent = '▾';
    const closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.className = 'ai-beat-close';
    closeBtn.title = 'Remove';
    closeBtn.textContent = '×';
    headerActions.append(collapseBtn, closeBtn);
    header.append(title, headerActions);

    // Message (main) area
    const messageInput = document.createElement('textarea');
    messageInput.className = 'ai-beat-input';
    messageInput.placeholder = 'What do you want to generate?';
    messageInput.rows = 2;
    messageInput.addEventListener('keydown', (ke) => {
      // Submit on Ctrl+Enter / Cmd+Enter inside the widget
      if ((ke.key === 'Enter' && (ke.ctrlKey || ke.metaKey))) {
        ke.preventDefault();
        genBtn.click();
      }
      if (ke.key === 'Escape') {
        ke.preventDefault();
        // Collapse on escape instead of removing to avoid accidental loss
        toggleCollapse();
      }
    });

    // Prompt (optional) area
    const promptRow = document.createElement('div');
    promptRow.className = 'ai-beat-prompt-row';
    const promptLabel = document.createElement('span');
    promptLabel.className = 'ai-beat-prompt-label';
    promptLabel.textContent = 'Prompt';
    const promptInput = document.createElement('input');
    promptInput.type = 'text';
    promptInput.className = 'ai-beat-prompt-input';
    promptInput.placeholder = 'You are a helpful assistant';
    promptInput.value = '';
    promptRow.append(promptLabel, promptInput);

    const errorEl = document.createElement('div');
    errorEl.className = 'ai-beat-error';
    errorEl.style.display = 'none';

    const output = document.createElement('div');
    output.className = 'ai-beat-output';

    const controls = document.createElement('span');
    controls.className = 'ai-beat-controls';
    const genBtn = document.createElement('button');
    genBtn.type = 'button';
    genBtn.className = 'ai-beat-generate';
    genBtn.title = 'Generate (Ctrl/Cmd+Enter)';
    genBtn.textContent = 'Generate';
    const acceptBtn = document.createElement('button');
    acceptBtn.type = 'button';
    acceptBtn.className = 'ai-beat-accept';
    acceptBtn.title = 'Accept and insert into document';
    acceptBtn.textContent = 'Accept';
    acceptBtn.disabled = true;
    const clearBtn = document.createElement('button');
    clearBtn.type = 'button';
    clearBtn.className = 'ai-beat-clear';
    clearBtn.title = 'Clear generated content';
    clearBtn.textContent = 'Clear';
    clearBtn.disabled = true;
    controls.append(acceptBtn, clearBtn, genBtn);

    const summary = document.createElement('div');
    summary.className = 'ai-beat-summary';
    summary.style.display = 'none';

    wrapper.append(header, messageInput, promptRow, errorEl, output, controls, summary);

    // Insert into DOM at caret
    range.insertNode(wrapper);
    // Keep caret inside widget while the input is focused
    updateHtml(blockId, editable.innerHTML);
    setVisible(false);
    // Focus input into the widget
    setTimeout(() => messageInput.focus(), 0);

    const removeWidget = () => {
      const parent = wrapper.parentNode;
      if (!parent) return;
      parent.removeChild(wrapper);
      updateHtml(blockId, editable.innerHTML);
    };

    closeBtn.onmousedown = (e) => { e.preventDefault(); e.stopPropagation(); removeWidget(); };

    const setError = (message: string | null) => {
      if (!message) {
        wrapper.removeAttribute('data-error');
        errorEl.style.display = 'none';
        errorEl.textContent = '';
      } else {
        wrapper.setAttribute('data-error', '1');
        errorEl.style.display = '';
        errorEl.textContent = message;
      }
    };

    const toggleCollapse = () => {
      const collapsed = wrapper.getAttribute('data-collapsed') === '1';
      if (collapsed) {
        wrapper.setAttribute('data-collapsed', '0');
        summary.style.display = 'none';
        messageInput.style.display = '';
        output.style.display = '';
        controls.style.display = '';
        collapseBtn.textContent = '▾';
      } else {
        // Build summary from output or input
        const text = (output.textContent || messageInput.value || '').trim();
        const preview = text.length > 80 ? text.slice(0, 80) + '…' : text || 'AIBeat';
        summary.textContent = preview;
        summary.style.display = '';
        messageInput.style.display = 'none';
        output.style.display = 'none';
        controls.style.display = 'none';
        wrapper.setAttribute('data-collapsed', '1');
        collapseBtn.textContent = '▸';
      }
      updateHtml(blockId, editable.innerHTML);
    };

    collapseBtn.onmousedown = (e) => { e.preventDefault(); e.stopPropagation(); toggleCollapse(); };

    const updateActionStates = () => {
      const hasContent = (output.textContent || '').trim().length > 0;
      acceptBtn.disabled = !hasContent;
      clearBtn.disabled = !hasContent;
    };

    genBtn.onmousedown = async (e) => {
      e.preventDefault();
      e.stopPropagation();
      const message = messageInput.value.trim();
      if (!message) return;
      // Prepare output area
      setError(null);
      wrapper.setAttribute('data-generating', '1');
      genBtn.disabled = true;
      // Clear previous output
      while (output.firstChild) output.removeChild(output.firstChild);
      updateHtml(blockId, editable.innerHTML);

      // Stream
      try {
        // Ensure we have a remote document id (create if missing)
        let docId = documentId;
        if (!docId) {
          try {
            docId = await createRemote();
          } catch (createErr) {
            throw new Error('Could not create document before generating.');
          }
        }
        await streamAiBeat({ message, prompt: promptInput.value.trim() || undefined, documentId: docId || undefined }, {
          onChunk: (delta: string) => {
            if (delta) {
              const last = output.lastChild;
              if (last && last.nodeType === Node.TEXT_NODE) {
                (last as Text).data += delta;
              } else {
                output.append(document.createTextNode(delta));
              }
              // Persist less frequently to avoid heavy writes; schedule via rAF
              requestAnimationFrame(() => updateHtml(blockId, editable.innerHTML));
              updateActionStates();
            }
          },
        });
      } catch (err) {
        setError((err as Error)?.message || 'Failed to generate.');
      } finally {
        wrapper.removeAttribute('data-generating');
        genBtn.disabled = false;
        genBtn.textContent = output.textContent?.trim() ? 'Regenerate' : 'Generate';
        // Update summary preview if collapsed later
        const txt = (output.textContent || '').trim();
        if (txt) summary.textContent = (txt.length > 80 ? txt.slice(0, 80) + '…' : txt);
        updateHtml(blockId, editable.innerHTML);
        updateActionStates();
      }
    };

    acceptBtn.onmousedown = (e) => {
      e.preventDefault(); e.stopPropagation();
      // Insert generated content after the widget and clear inside
      const parent = wrapper.parentNode;
      if (!parent) return;
      const hasContent = (output.textContent || '').trim().length > 0;
      if (!hasContent) return;
      const frag = document.createDocumentFragment();
      while (output.firstChild) frag.appendChild(output.firstChild);
      const marker = document.createTextNode('');
      parent.insertBefore(marker, wrapper.nextSibling);
      parent.insertBefore(frag, marker.nextSibling);
      parent.removeChild(marker);
      updateHtml(blockId!, editable.innerHTML);
      // Place caret after inserted content
      try {
        const lastInserted = (parent.childNodes[parent.childNodes.length - 1] || wrapper.nextSibling) as Node | null;
        if (lastInserted) {
          const r2 = document.createRange();
          if (lastInserted.nodeType === Node.ELEMENT_NODE) {
            r2.selectNodeContents(lastInserted as Element);
            r2.collapse(false);
          } else if (lastInserted.nodeType === Node.TEXT_NODE) {
            r2.setStart(lastInserted, ((lastInserted as Text).data || '').length);
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
      updateActionStates();
    };

    clearBtn.onmousedown = (e) => {
      e.preventDefault(); e.stopPropagation();
      while (output.firstChild) output.removeChild(output.firstChild);
      updateHtml(blockId!, editable.innerHTML);
      updateActionStates();
    };
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


