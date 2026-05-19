import { useEffect, useMemo, useRef, useState, type MutableRefObject } from 'react';
import type { ParagraphChild } from '../../../../../../editor';
import { streamAgentChat } from '../../../../../../services/agentChat';
import { serializeEditableHtml } from '../../../../../../components/common/Editable/Editable';
import { Button } from '@/components/ui/button';

const MAX_PROMPT_LENGTH = 2000;

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

  // ── Client-side validation ──
  const messageOverLimit = message.length > MAX_PROMPT_LENGTH;
  const promptOverLimit = prompt.length > MAX_PROMPT_LENGTH;
  const hasValidationError = messageOverLimit || promptOverLimit;

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
    if (generating || hasValidationError) return;
    const controller = new AbortController();
    abortRef.current = controller;
    setGenerating(true);
    setOutput('');
    try {
      let docId = documentId;
      if (!docId) { docId = await createRemote(); }
      const combined = `Use this prompt: ${prompt}\n\nGenerate response for: ${message}`;
      await streamAgentChat(
        { message: combined, document_id: docId },
        { onToken: (content) => setOutput(prev => prev + content) },
        { signal: controller.signal },
      );
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
    <span 
      className="ai-beat-widget inline-block align-top bg-gradient-to-br from-violet-950/30 to-indigo-950/30 border border-indigo-500/30 rounded-lg p-3 my-1 min-w-[280px] max-w-full shadow-sm" 
      contentEditable={false as any} 
      onMouseDown={(e) => e.stopPropagation()} 
      onClick={(e) => e.stopPropagation()}
    >
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs font-semibold text-indigo-400 flex items-center gap-1">
          <span>✨</span> AIBeat
        </span>
        <span className="flex items-center gap-1">
          <button 
            type="button" 
            className="w-6 h-6 flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-black/5 rounded transition-colors" 
            title="Collapse / Expand" 
            onMouseDown={(e) => { e.preventDefault(); setCollapsed(v => !v); }}
          >
            {collapsed ? '▸' : '▾'}
          </button>
          <button 
            type="button" 
            className="w-6 h-6 flex items-center justify-center text-muted-foreground hover:text-destructive hover:bg-destructive/10 rounded transition-colors" 
            title="Remove" 
            onMouseDown={(e) => { 
              e.preventDefault(); 
              e.stopPropagation(); 
              const host = refs.current[blockId]; 
              const el = host?.querySelector(`[data-child-id=\"${child.id}\"]`); 
              el?.parentNode?.removeChild(el as any); 
              removeParagraphChild(blockId, child.id); 
              const editable = refs.current[blockId]; 
              if (editable) updateHtml(blockId, serializeEditableHtml(editable)); 
            }}
          >
            ×
          </button>
        </span>
      </div>
      {!collapsed && (
        <>
          <textarea 
            className="w-full min-h-[52px] p-2 text-sm border border-border rounded-md bg-input resize-y focus:outline-none focus:ring-2 focus:ring-primary/30" 
            placeholder="What do you want to generate?" 
            rows={2} 
            maxLength={MAX_PROMPT_LENGTH}
            value={message} 
            onChange={(e) => setMessage(e.target.value)} 
            onKeyDown={(e) => { 
              if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); onGenerate(); } 
              if (e.key === 'Escape') { e.preventDefault(); setCollapsed(true); } 
            }} 
          />
          <span className={`text-xs ${messageOverLimit ? 'text-destructive' : 'text-muted-foreground'}`}>
            {message.length}/{MAX_PROMPT_LENGTH}
          </span>
          {messageOverLimit && (
            <span className="ml-2 text-xs text-destructive">Message must be ≤{MAX_PROMPT_LENGTH} characters</span>
          )}
          <div className="flex items-center gap-2 mt-2">
            <span className="text-xs text-muted-foreground shrink-0">Prompt</span>
            <input 
              type="text" 
              className="flex-1 px-2 py-1 text-xs border border-border rounded bg-input focus:outline-none focus:ring-2 focus:ring-primary/30" 
              placeholder="You are a helpful assistant" 
              maxLength={MAX_PROMPT_LENGTH}
              value={prompt} 
              onChange={(e) => setPrompt(e.target.value)} 
            />
          </div>
          <span className={`text-xs ${promptOverLimit ? 'text-destructive' : 'text-muted-foreground'}`}>
            {prompt.length}/{MAX_PROMPT_LENGTH}
          </span>
          {promptOverLimit && (
            <span className="ml-2 text-xs text-destructive">Prompt must be ≤{MAX_PROMPT_LENGTH} characters</span>
          )}
          {output && (
            <div className="mt-2 p-2 bg-secondary border border-border rounded text-sm whitespace-pre-wrap max-h-[200px] overflow-auto">
              {output}
            </div>
          )}
          <div className="flex items-center gap-2 mt-2">
            <Button 
              type="button" 
              variant="outline" 
              size="sm"
              disabled={!output.trim()} 
              onMouseDown={(e) => {
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
              }}
            >
              Accept
            </Button>
            <Button 
              type="button" 
              variant="outline" 
              size="sm"
              disabled={!output.trim()} 
              onMouseDown={(e) => { e.preventDefault(); setOutput(''); }}
            >
              Clear
            </Button>
            {generating ? (
              <Button 
                type="button" 
                variant="destructive" 
                size="sm"
                onMouseDown={(e) => { e.preventDefault(); onStop(); }}
              >
                Stop
              </Button>
            ) : (
              <Button 
                type="button" 
                size="sm"
                disabled={hasValidationError}
                onMouseDown={(e) => { e.preventDefault(); onGenerate(); }}
              >
                {output.trim() ? 'Regenerate' : 'Generate'}
              </Button>
            )}
          </div>
        </>
      )}
      {collapsed && (
        <div className="text-sm text-muted-foreground truncate">{summaryText}</div>
      )}
    </span>
  );
}




