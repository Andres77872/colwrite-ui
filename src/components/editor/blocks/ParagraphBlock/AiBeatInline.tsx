import { useEffect, useMemo, useRef, useState, type MutableRefObject } from 'react';
import type { ParagraphChild } from '../../../../editor';
import { streamAiBeat } from '../../../../services';
import { serializeEditableHtml } from '../../../common/Editable/Editable';

export function AiBeatInline({
  blockId,
  child,
  updateParagraphChild,
  removeParagraphChild,
  updateHtml,
  refs,
  documentId,
  createRemote,
}: {
  blockId: string;
  child: ParagraphChild;
  updateParagraphChild: (blockId: string, childId: string, next: Partial<ParagraphChild>) => void;
  removeParagraphChild: (blockId: string, childId: string) => void;
  updateHtml: (id: string, html: string) => void;
  refs: MutableRefObject<Record<string, HTMLDivElement | null>>;
  documentId: string | null;
  createRemote: () => Promise<string>;
}) {
  if (child.type !== 'aiBeat') return null;
  const [message, setMessage] = useState(child.message);
  const [prompt, setPrompt] = useState(child.prompt);
  const [output, setOutput] = useState(child.output);
  const [collapsed, setCollapsed] = useState(!!child.collapsed);
  const [generating, setGenerating] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  // Initialize local state from child only when the child identity changes.
  // Avoid syncing on every prop field change to prevent feedback loops during streaming updates.
  useEffect(() => {
    setMessage(child.message);
    setPrompt(child.prompt);
    setOutput(child.output);
    setCollapsed(!!child.collapsed);
  }, [child.id]);

  // Keep message/prompt/output persisted in the child's JSON so the widget state survives remounts.
  // Throttle writes to avoid loops when streaming updates are frequent.
  useEffect(() => {
    const id = window.setTimeout(() => {
      if (child.message !== message || child.prompt !== prompt || child.output !== output) {
        updateParagraphChild(blockId, child.id, { message, prompt, output });
      }
    }, 60);
    return () => window.clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [message, prompt, output]);

  // Persist collapsed state independently
  useEffect(() => {
    updateParagraphChild(blockId, child.id, { collapsed });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [collapsed]);

  const onGenerate = async () => {
    if (generating) return;
    const controller = new AbortController();
    abortRef.current = controller;
    setGenerating(true);
    setOutput('');
    try {
      let docId = documentId;
      if (!docId) { docId = await createRemote(); }
      await streamAiBeat({ message, prompt, documentId: docId || undefined }, {
        signal: controller.signal,
        onChunk: (delta) => {
          // Streaming callback may fire very frequently; batch updates via rAF to avoid effect thrash
          setOutput(prev => prev + delta);
        },
      });
    } catch (err) {
      // ignore for now; surfaced visually via output text
    } finally {
      setGenerating(false);
    }
  };

  const onStop = () => { abortRef.current?.abort(); setGenerating(false); };

  const summaryText = useMemo(() => {
    const txt = (output || message || '').trim();
    return txt.length > 80 ? txt.slice(0, 80) + '…' : txt || 'AIBeat';
  }, [output, message]);

  return (
    <span className="ai-beat-widget" contentEditable={false as any} onMouseDown={(e) => e.stopPropagation()} onClick={(e) => e.stopPropagation()}>
      <div className="ai-beat-header">
        <span className="ai-beat-title">AIBeat</span>
        <span className="ai-beat-header-actions">
          <button type="button" className="ai-beat-collapse" title="Collapse / Expand" onMouseDown={(e) => { e.preventDefault(); setCollapsed(v => !v); }}>
            {collapsed ? '▸' : '▾'}
          </button>
          <button type="button" className="ai-beat-close" title="Remove" onMouseDown={(e) => { e.preventDefault(); e.stopPropagation(); const host = refs.current[blockId]; const el = host?.querySelector(`[data-child-id=\"${child.id}\"]`); el?.parentNode?.removeChild(el as any); removeParagraphChild(blockId, child.id); const editable = refs.current[blockId]; if (editable) updateHtml(blockId, serializeEditableHtml(editable)); }}>
            ×
          </button>
        </span>
      </div>
      {!collapsed && (
        <>
          <textarea className="ai-beat-input" placeholder="What do you want to generate?" rows={2} value={message} onChange={(e) => setMessage(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); onGenerate(); } if (e.key === 'Escape') { e.preventDefault(); setCollapsed(true); } }} />
          <div className="ai-beat-prompt-row">
            <span className="ai-beat-prompt-label">Prompt</span>
            <input type="text" className="ai-beat-prompt-input" placeholder="You are a helpful assistant" value={prompt} onChange={(e) => setPrompt(e.target.value)} />
          </div>
          <div className="ai-beat-error" style={{ display: 'none' }} />
          <div className="ai-beat-output">{output}</div>
          <span className="ai-beat-controls">
            <button type="button" className="ai-beat-accept" title="Accept and insert into document" disabled={!output.trim()} onMouseDown={(e) => {
              e.preventDefault();
              const editable = refs.current[blockId];
              if (!editable) return;
              const span = editable.querySelector(`[data-child-id="${child.id}"]`);
              if (!span) return;
              const parent = span.parentNode; if (!parent) return;
              const afterMarker = document.createTextNode('');
              parent.insertBefore(afterMarker, (span as any).nextSibling);
              parent.insertBefore(document.createTextNode(output), afterMarker.nextSibling);
              parent.removeChild(afterMarker);
              updateHtml(blockId, serializeEditableHtml(editable as HTMLDivElement));
            }}>
              Accept
            </button>
            <button type="button" className="ai-beat-clear" title="Clear generated content" disabled={!output.trim()} onMouseDown={(e) => { e.preventDefault(); setOutput(''); }}>
              Clear
            </button>
            {generating ? (
              <button type="button" className="ai-beat-generate" title="Stop" onMouseDown={(e) => { e.preventDefault(); onStop(); }}>Stop</button>
            ) : (
              <button type="button" className="ai-beat-generate" title="Generate (Ctrl/Cmd+Enter)" onMouseDown={(e) => { e.preventDefault(); onGenerate(); }}>{output.trim() ? 'Regenerate' : 'Generate'}</button>
            )}
          </span>
        </>
      )}
      {collapsed && (
        <div className="ai-beat-summary" style={{ display: '' }}>{summaryText}</div>
      )}
    </span>
  );
}


