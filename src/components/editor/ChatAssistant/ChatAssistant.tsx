import { useEffect, useMemo, useRef, useState, type MutableRefObject } from 'react';
import { useEditor } from '../../../editor';
import type { Block, Doc } from '../../../editor';
import type { OpenAIChatMessage } from '../../../services';
import { streamDocumentAiChat } from '../../../services';
import { Button } from '@/components/ui/button';
import { ChatRefPicker, type ChatRefPickerHandle } from './ChatRefPicker';
import { ChatRefTags } from './ChatRefTags';
import { ChatTaggedInput, type ChatTaggedInputHandle } from './ChatTaggedInput';

type ChatMessage = OpenAIChatMessage;

// Streaming tag parser: extracts complete <EXTRAS_JSON>...</EXTRAS_JSON> blocks from a running buffer
// and returns the visible delta (with tags removed) along with any parsed extras objects.
function parseAndStripExtras(
  delta: string,
  bufferRef: MutableRefObject<string>
): { visibleDelta: string; parsedExtras: any[] } {
  const OPEN = '<EXTRAS_JSON>';
  const CLOSE = '</EXTRAS_JSON>';
  const GUARD = OPEN.length - 1; // keep a small tail to detect partial tag start

  let combined = (bufferRef.current || '') + (delta || '');
  let pos = 0;
  const parsed: any[] = [];
  let visible = '';

  while (true) {
    const openIdx = combined.indexOf(OPEN, pos);
    if (openIdx === -1) {
      // No more tags. Flush all safe visible content, keep a small trailing guard.
      const flushEnd = Math.max(pos, combined.length - GUARD);
      if (flushEnd > pos) visible += combined.slice(pos, flushEnd);
      bufferRef.current = combined.slice(flushEnd);
      break;
    }
    // Emit visible text up to the tag
    if (openIdx > pos) {
      visible += combined.slice(pos, openIdx);
    }

    const afterOpen = openIdx + OPEN.length;
    const closeIdx = combined.indexOf(CLOSE, afterOpen);
    if (closeIdx === -1) {
      // Incomplete extras block; keep from open tag in buffer and stop.
      bufferRef.current = combined.slice(openIdx);
      break;
    }

    const jsonStr = combined.slice(afterOpen, closeIdx);
    try {
      const obj = JSON.parse(jsonStr);
      parsed.push(obj);
    } catch {
      // ignore malformed blocks; could be partial JSON despite tags
    }
    pos = closeIdx + CLOSE.length;
    if (pos >= combined.length) {
      // processed everything
      bufferRef.current = '';
      break;
    }
  }

  return { visibleDelta: visible, parsedExtras: parsed };
}

type ExtrasIntent = 'ask' | 'edit' | 'create';
type InsertPatch = { op: 'insert'; block: Block; beforeOf?: string | null; afterOf?: string | null };
type UpdatePatch = { op: 'update'; blockId: string; fields: Partial<Block> };
type DeletePatch = { op: 'delete'; blockId: string };
type ExtrasPayload = { intent: ExtrasIntent; patches: Array<InsertPatch | UpdatePatch | DeletePatch>; nextDocument?: Doc | null };

// Apply extras if they are new (deduplicated by JSON stringification)
// Handles insert/update/delete patches and optional nextDocument replacement
// Respects placement rules: beforeOf, afterOf, afterOf:null => prepend, beforeOf:null => append
function useApplyExtras(
  deps: {
    blocks: Block[];
    insertBlockAt: (block: Block, beforeOf?: string | null, afterOf?: string | null) => void;
    updateBlockFields: (blockId: string, fields: Partial<Block>) => void;
    removeBlock: (id: string) => void;
    setFromJSON: (json: string) => void;
    lastAppliedExtrasRef: MutableRefObject<string>;
  }
) {
  const applyExtrasIfNew = (extras: unknown) => {
    if (!extras || typeof extras !== 'object') return;
    const key = safeStableStringify(extras as any);
    if (!key) return; // refuse to apply non-serializable
    if (deps.lastAppliedExtrasRef.current === key) return;
    deps.lastAppliedExtrasRef.current = key;

    const payload = extras as ExtrasPayload;
    // Full document replacement if provided
    if (payload && (payload as any).nextDocument) {
      try {
        deps.setFromJSON(JSON.stringify((payload as any).nextDocument));
      } catch {}
      return;
    }

    const patches = Array.isArray((payload as any).patches) ? (payload as any).patches : [];
    for (const p of patches as any[]) {
      if (!p || typeof p !== 'object' || typeof p.op !== 'string') continue;
      if (p.op === 'insert' && p.block) {
        // Handle prepend when afterOf === null
        if (Object.prototype.hasOwnProperty.call(p, 'afterOf') && p.afterOf === null) {
          const firstId = deps.blocks[0]?.id;
          if (firstId) deps.insertBlockAt(p.block as Block, firstId, undefined);
          else deps.insertBlockAt(p.block as Block, undefined, undefined);
        } else {
          deps.insertBlockAt(p.block as Block, p.beforeOf ?? undefined, p.afterOf ?? undefined);
        }
      } else if (p.op === 'update' && typeof p.blockId === 'string' && p.fields) {
        deps.updateBlockFields(p.blockId, p.fields as Partial<Block>);
      } else if (p.op === 'delete' && typeof p.blockId === 'string') {
        deps.removeBlock(p.blockId);
      }
    }
  };

  return { applyExtrasIfNew };
}

function safeStableStringify(v: any): string | null {
  try { return JSON.stringify(v); } catch { return null; }
}

export function ChatAssistant() {
  const {
    documentId,
    createRemote,
    insertBlockAt,
    updateBlockFields,
    removeBlock,
    setFromJSON,
    blocks,
  } = useEditor();
  const [expanded, setExpanded] = useState<boolean>(() => {
    try { return localStorage.getItem('chat.expanded') === '1'; } catch { return false; }
  });
  // helpers are defined at module scope
  const [input, setInput] = useState<string>('');
  const [messages, setMessages] = useState<ChatMessage[]>(() => [
    { role: 'system', content: 'You are a helpful writing assistant embedded in a document editor. Provide concise, actionable suggestions. When relevant, reference the current document context.' },
  ]);
  const [isStreaming, setIsStreaming] = useState<boolean>(false);
  const [error, setError] = useState<string>('');
  const abortRef = useRef<AbortController | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);
  const inputHostRef = useRef<ChatTaggedInputHandle | null>(null);
  const refPickerRef = useRef<ChatRefPickerHandle | null>(null);
  // Maintain a buffer to detect and parse <EXTRAS_JSON> blocks across chunk boundaries (fallback)
  const tagBufferRef = useRef<string>('');
  const lastAppliedExtrasRef = useRef<string>('');
  const { applyExtrasIfNew } = useApplyExtras({
    blocks,
    insertBlockAt,
    updateBlockFields,
    removeBlock,
    setFromJSON,
    lastAppliedExtrasRef,
  });

  useEffect(() => {
    try { localStorage.setItem('chat.expanded', expanded ? '1' : '0'); } catch {}
  }, [expanded]);

  const visibleMessages = useMemo(() => messages.filter(m => m.role !== 'system'), [messages]);

  useEffect(() => {
    if (listRef.current) {
      listRef.current.scrollTop = listRef.current.scrollHeight;
    }
  }, [visibleMessages, isStreaming]);

  const ensureDocumentId = async (): Promise<string> => {
    if (documentId) return documentId;
    const id = await createRemote();
    return id;
  };

  const onSend = async () => {
    const text = input.trim();
    if (!text || isStreaming) return;
    setError('');
    setInput('');

    const nextMessages: ChatMessage[] = [...messages, { role: 'user', content: text }, { role: 'assistant', content: '' }];
    setMessages(nextMessages);

    try {
      const id = await ensureDocumentId();
      const controller = new AbortController();
      abortRef.current = controller;
      setIsStreaming(true);

      await streamDocumentAiChat(id, nextMessages, {
        signal: controller.signal,
        onChunk: (delta, chunk) => {
          // 1) Prefer server-provided clean content (delta) which should have tags stripped already
          let cleanDelta = delta;
          // 2) Fallback: if server did not strip tags and included them in content, remove them while parsing extras
          const { visibleDelta, parsedExtras } = parseAndStripExtras(cleanDelta, tagBufferRef);
          cleanDelta = visibleDelta;

          // Append visible delta to the last assistant message
          setMessages(prev => {
            const out = prev.slice();
            for (let i = out.length - 1; i >= 0; i--) {
              if (out[i].role === 'assistant') {
                out[i] = { ...out[i], content: (out[i].content || '') + cleanDelta };
                break;
              }
            }
            return out;
          });

          // Apply extras from SSE (authoritative), otherwise from parsed tags
          const extrasFromSse = (chunk && typeof (chunk as any).extras !== 'undefined')
            ? (chunk as any).extras as unknown
            : null;

          if (extrasFromSse != null) {
            if (Array.isArray(extrasFromSse)) {
              for (const ex of extrasFromSse) applyExtrasIfNew(ex);
            } else {
              applyExtrasIfNew(extrasFromSse);
            }
          } else if (parsedExtras.length) {
            // Use the latest parsed block if server didn't provide extras
            applyExtrasIfNew(parsedExtras[parsedExtras.length - 1]);
          }
        },
      });
    } catch (e: any) {
      setError(e?.message || 'Something went wrong');
    } finally {
      setIsStreaming(false);
      abortRef.current = null;
    }
  };

  const onStop = () => {
    if (abortRef.current) {
      abortRef.current.abort();
      abortRef.current = null;
      setIsStreaming(false);
    }
  };

  return (
    <div
      className={[
        'sticky bottom-[45px] z-[1000] mt-[var(--spacing-3)] -mx-[var(--spacing-3)] bg-[var(--color-panel)] shadow-[0_-4px_12px_rgba(0,0,0,0.04)] rounded-b-lg',
        expanded
          ? 'border border-[var(--color-border)]'
          : 'border-t border-[var(--color-border)] px-[var(--spacing-3)] py-[var(--spacing-2)]',
      ].join(' ')}
    >
      <button
        className="absolute -top-[22px] right-[var(--spacing-3)] px-2 py-1 text-[var(--text-sm)] rounded-sm border border-[var(--color-border)] bg-white shadow-sm hover:bg-[var(--color-elev)] active:translate-y-px"
        onClick={() => setExpanded(v => !v)}
        aria-expanded={expanded}
        title={expanded ? 'Hide assistant' : 'Show assistant'}
      >
        {expanded ? 'Hide Assistant' : 'Assistant'}
      </button>

      {expanded ? (
        <div className="flex flex-col h-[360px] max-[980px]:h-[300px]">
          <div className="flex items-center gap-[var(--spacing-3)] px-[var(--spacing-3)] py-[var(--spacing-2)] border-b border-[var(--color-border)]">
            <div className="flex-1">
              <div className="text-[var(--text-base)] font-semibold">Assistant</div>
              <div className="text-[var(--text-xs)] text-[var(--color-muted)]">Helps you edit and refine your document</div>
            </div>
          </div>
          <div className="flex-1 overflow-auto p-[var(--spacing-3)] bg-[var(--color-elev)]" ref={listRef}>
            {visibleMessages.length === 0 && (
              <div className="text-[var(--color-muted)] text-[var(--text-sm)] text-center mt-[var(--spacing-6)]">Ask for suggestions, rewriting, structure, summaries, or references.</div>
            )}
            {visibleMessages.map((m, idx) => (
              <div key={idx} className={["flex mb-[var(--spacing-2)]", m.role === 'user' ? 'justify-end' : 'justify-start'].join(' ')}>
                <div className={[
                  'max-w-[70%] px-[12px] py-[10px] rounded-[12px] border border-[var(--color-border)] bg-white',
                  m.role === 'user' ? 'bg-[var(--color-accent)] text-white border-[var(--color-accent)]' : '',
                ].join(' ')}>
                  {m.role === 'user' ? (<ChatRefTags text={m.content} />) : m.content}
                </div>
              </div>
            ))}
            {error && <div className="text-[var(--color-danger)] text-sm mt-2">{error}</div>}
          </div>
          <div className="border-t border-[var(--color-border)] px-[var(--spacing-3)] py-[var(--spacing-2)] bg-white">
            <div className="flex items-center gap-[var(--spacing-3)]">
              <div className="relative w-full">
                <ChatTaggedInput
                  ref={inputHostRef}
                  value={input}
                  onChange={setInput}
                  placeholder="Ask the assistant…"
                  onTriggerPicker={(anchor) => refPickerRef.current?.openAt(anchor)}
                  onEditRef={(start) => refPickerRef.current?.openAt(start, { editing: true })}
                  onRemoveRef={(start, refText) => {
                    const before = input.slice(0, start);
                    const after = input.slice(start + refText.length);
                    setInput(before + after);
                    requestAnimationFrame(() => inputHostRef.current?.setSelectionRange(start, start));
                  }}
                  onKeyDown={(e) => {
                    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { onSend(); return; }
                  }}
                  maxLength={2000}
                  showStatus={true}
                />
                <ChatRefPicker
                  ref={refPickerRef}
                  hostRef={{ current: inputHostRef.current?.getHost() as any }}
                  input={input}
                  setInput={setInput}
                  setCaretIndex={(idx) => inputHostRef.current?.setSelectionRange(idx, idx)}
                />
              </div>
              {!isStreaming ? (
                <Button onClick={onSend} disabled={!input.trim()}>Send</Button>
              ) : (
                <Button variant="destructive" onClick={onStop}>Stop</Button>
              )}
            </div>

          </div>
        </div>
      ) : (
        <div>
          <Button variant="outline" className="inline-flex items-center gap-2" onClick={() => setExpanded(true)} aria-expanded={expanded}>
            <span className="inline-block w-2 h-2 bg-[var(--color-accent)] rounded-full" /> Assistant
          </Button>
        </div>
      )}
    </div>
  );
}


