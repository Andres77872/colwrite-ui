import './ChatAssistant.css';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useEditor, type Doc, type Block } from '../../../editor';
import type { OpenAIChatMessage } from '../../../services';
import { streamDocumentAiChat } from '../../../services';
import { useChatSessions } from '../../chat/ChatSessionsContext';
import { listMessages, listThreads } from '../../../services/chats';
import { ChatRefPicker, type ChatRefPickerHandle } from './ChatRefPicker';
import { ChatRefTags } from './ChatRefTags';
import { ChatTaggedInput, type ChatTaggedInputHandle } from './ChatTaggedInput';

type ChatMessage = OpenAIChatMessage;

// --- Patch application helpers (module scope) ---
type InsertPatch = { op: 'insert'; block: Block; beforeOf?: string | null; afterOf?: string | null };
type UpdatePatch = { op: 'update'; blockId: string; fields: Partial<Block> };
type DeletePatch = { op: 'delete'; blockId: string };
type AnyPatch = InsertPatch | UpdatePatch | DeletePatch;

function cloneDoc(d: Doc): Doc {
  return { ...d, blocks: d.blocks.slice() };
}

// --- Streaming extras tag filter (module scope) ---
type ExtrasFilterState = { inExtras: boolean; carry: string; buf: string };
const OPEN_TAG = '<EXTRAS_JSON>';
const CLOSE_TAG = '</EXTRAS_JSON>';

function filterAndExtractExtras(state: ExtrasFilterState, incoming: string): { text: string; extras: any[] } {
  if (!incoming) return { text: '', extras: [] };
  let buffer = (state.carry || '') + incoming;
  state.carry = '';
  const outParts: string[] = [];
  const extrasOut: any[] = [];

  while (buffer.length) {
    if (state.inExtras) {
      const closeIdx = buffer.indexOf(CLOSE_TAG);
      if (closeIdx === -1) {
        // Accumulate JSON inside extras block; keep a small tail to match split close tag next time
        // Append all but the last few chars to buf
        const keep = Math.min(CLOSE_TAG.length - 1, buffer.length);
        const cutoff = buffer.length - keep;
        if (cutoff > 0) state.buf += buffer.slice(0, cutoff);
        state.carry = buffer.slice(cutoff);
        buffer = '';
        break;
      } else {
        // Capture JSON up to the close tag, then parse
        state.buf += buffer.slice(0, closeIdx);
        buffer = buffer.slice(closeIdx + CLOSE_TAG.length);
        try {
          const parsed = JSON.parse(state.buf);
          extrasOut.push(parsed);
        } catch {
          // ignore parse errors; malformed json
        }
        state.buf = '';
        state.inExtras = false;
        continue;
      }
    } else {
      const openIdx = buffer.indexOf(OPEN_TAG);
      if (openIdx === -1) {
        // No open tag; emit all visible text, but keep a potential partial tag start as carry
        const lastLt = buffer.lastIndexOf('<');
        if (lastLt !== -1) {
          const tail = buffer.slice(lastLt);
          if (OPEN_TAG.startsWith(tail)) {
            outParts.push(buffer.slice(0, lastLt));
            state.carry = tail;
            buffer = '';
            break;
          }
        }
        outParts.push(buffer);
        buffer = '';
        break;
      } else {
        // Emit text before the tag, then enter extras mode
        outParts.push(buffer.slice(0, openIdx));
        buffer = buffer.slice(openIdx + OPEN_TAG.length);
        state.inExtras = true;
        state.buf = '';
        continue;
      }
    }
  }

  return { text: outParts.join(''), extras: extrasOut };
}

function normalizeBlock(b: Block): Block {
  if (b.type === 'paragraph') {
    const pb = b as any;
    return { ...pb, children: Array.isArray(pb.children) ? pb.children : [], columns: typeof pb.columns === 'number' ? pb.columns : 1 } as Block;
  }
  return b;
}

function applyPatchesToDoc(cur: Doc, patches: AnyPatch[]): Doc | null {
  try {
    let next = cloneDoc(cur);
    for (const p of patches) {
      if (p.op === 'insert') {
        const blk = normalizeBlock((p as InsertPatch).block);
        const { beforeOf, afterOf } = p as InsertPatch;
        const byId = (id?: string | null) => next.blocks.findIndex(b => b.id === id);
        if (beforeOf === null) {
          next.blocks = next.blocks.concat([blk]);
          continue;
        }
        if (afterOf === null) {
          next.blocks = [blk, ...next.blocks];
          continue;
        }
        if (typeof beforeOf === 'string') {
          const idx = byId(beforeOf);
          if (idx >= 0) {
            const out = next.blocks.slice();
            out.splice(idx, 0, blk);
            next.blocks = out;
            continue;
          }
        }
        if (typeof afterOf === 'string') {
          const idx = byId(afterOf);
          if (idx >= 0) {
            const out = next.blocks.slice();
            out.splice(idx + 1, 0, blk);
            next.blocks = out;
            continue;
          }
        }
        // Fallback: append
        next.blocks = next.blocks.concat([blk]);
      } else if (p.op === 'update') {
        const { blockId, fields } = p as UpdatePatch;
        const idx = next.blocks.findIndex(b => b.id === blockId);
        if (idx === -1) continue;
        const curBlk = next.blocks[idx] as any;
        const merged = normalizeBlock({ ...curBlk, ...fields } as Block);
        const out = next.blocks.slice();
        out[idx] = merged;
        next.blocks = out;
      } else if (p.op === 'delete') {
        const { blockId } = p as DeletePatch;
        next.blocks = next.blocks.filter(b => b.id !== blockId);
      }
    }
    return next;
  } catch {
    return null;
  }
}

export function ChatAssistant() {
  const { documentId, createRemote, doc, setFromJSON } = useEditor();
  const { selectedChatId, selectedThreadId, setSelectedChatId, setSelectedThreadId } = useChatSessions();
  const [expanded, setExpanded] = useState<boolean>(() => {
    try { return localStorage.getItem('chat.expanded') === '1'; } catch { return false; }
  });
  const docRef = useRef<Doc>(doc);
  useEffect(() => { docRef.current = doc; }, [doc]);
  const extrasFilterRef = useRef<ExtrasFilterState>({ inExtras: false, carry: '', buf: '' });
  const [extrasActive, setExtrasActive] = useState<boolean>(false);
  const lastExtrasKeyRef = useRef<string | null>(null);
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

  useEffect(() => {
    try { localStorage.setItem('chat.expanded', expanded ? '1' : '0'); } catch {}
  }, [expanded]);

  const visibleMessages = useMemo(() => messages.filter(m => m.role !== 'system'), [messages]);

  useEffect(() => {
    if (listRef.current) {
      listRef.current.scrollTop = listRef.current.scrollHeight;
    }
  }, [visibleMessages, isStreaming]);

  // Improve UX: open the assistant when a chat gets selected
  useEffect(() => {
    if (selectedChatId) setExpanded(true);
  }, [selectedChatId]);

  const ensureDocumentId = async (): Promise<string> => {
    if (documentId) return documentId;
    const id = await createRemote();
    return id;
  };

  // Load messages for the selected chat when selection changes
  useEffect(() => {
    (async () => {
      try {
        if (!documentId || !selectedChatId) return;
        // If streaming, stop first
        if (abortRef.current) {
          try { abortRef.current.abort(); } catch {}
          abortRef.current = null;
        }
        setIsStreaming(false);
        // Reset any transient extras state
        extrasFilterRef.current = { inExtras: false, carry: '', buf: '' };
        setExtrasActive(false);
        lastExtrasKeyRef.current = null;

        // Fetch conversation along the current branch
        let pivot: number | undefined = (selectedThreadId ?? undefined) as number | undefined;
        if (typeof pivot !== 'number') {
          // Fallback: fetch threads and pick the latest by id
          const thr = await listThreads(documentId, selectedChatId, 100, 0);
          const ids = (thr.threads || []).map(t => t.id).filter((n: any) => typeof n === 'number');
          if (ids.length) pivot = Math.max(...ids);
        }
        if (typeof pivot !== 'number') return; // nothing to load yet
        const res = await listMessages(documentId, selectedChatId, pivot);
        const base: ChatMessage[] = [
          { role: 'system', content: 'You are a helpful writing assistant embedded in a document editor. Provide concise, actionable suggestions. When relevant, reference the current document context.' },
          ...res.messages.map((m) => ({ role: m.role as any, content: m.content }))
        ];
        setMessages(base);
        if (typeof res.pivotThreadId === 'number') setSelectedThreadId(res.pivotThreadId);
      } catch {
        // ignore load errors here; UI remains usable
      }
    })();
  }, [documentId, selectedChatId, selectedThreadId]);

  const onSend = async () => {
    const text = input.trim();
    if (!text || isStreaming) return;
    setError('');
    setInput('');
    // Reset extras state for a fresh stream
    extrasFilterRef.current = { inExtras: false, carry: '', buf: '' };
    setExtrasActive(false);
    lastExtrasKeyRef.current = null;

    const nextMessages: ChatMessage[] = [...messages, { role: 'user', content: text }, { role: 'assistant', content: '' }];
    setMessages(nextMessages);

    try {
      const id = await ensureDocumentId();
      const controller = new AbortController();
      abortRef.current = controller;
      setIsStreaming(true);

      await streamDocumentAiChat(id, nextMessages, {
        signal: controller.signal,
        chatId: selectedChatId,
        threadId: typeof selectedThreadId === 'number' ? selectedThreadId : undefined,
        onHeaders: (headers) => {
          const newChatId = headers.get('x-chat-id');
          if (newChatId && !selectedChatId) setSelectedChatId(newChatId);
        },
        onChunk: (delta, chunk) => {
          // 1) Update assistant message text (filter out <EXTRAS_JSON> blocks) and extract inline extras
          const { text: clean, extras: inlineExtras } = filterAndExtractExtras(extrasFilterRef.current, delta || '');
          setMessages(prev => {
            const out = prev.slice();
            for (let i = out.length - 1; i >= 0; i--) {
              if (out[i].role === 'assistant') {
                if (clean) out[i] = { ...out[i], content: (out[i].content || '') + clean };
                break;
              }
            }
            return out;
          });
          setExtrasActive(extrasFilterRef.current.inExtras);

          // 2) Apply streaming document patches if provided
          try {
            const sseExtras: any = (chunk as any)?.extras ?? null;
            const lastInline = inlineExtras.length ? inlineExtras[inlineExtras.length - 1] : null;
            const extras: any = sseExtras ?? lastInline;
            if (!extras) return;

            const key = (() => {
              try { return JSON.stringify(extras); } catch { return null; }
            })();
            if (key && key === lastExtrasKeyRef.current) return; // avoid duplicate applications

            if (extras.nextDocument && typeof extras.nextDocument === 'object') {
              docRef.current = extras.nextDocument as Doc;
              setFromJSON(JSON.stringify(docRef.current));
            } else if (Array.isArray(extras.patches) && extras.patches.length > 0) {
              const base = docRef.current;
              const nextDoc = applyPatchesToDoc(base, extras.patches);
              if (nextDoc) {
                docRef.current = nextDoc;
                setFromJSON(JSON.stringify(nextDoc));
              }
            }
            if (key) lastExtrasKeyRef.current = key;
          } catch {
            // Ignore malformed extras; UI continues streaming text
          }
        },
      });
    } catch (e: any) {
      setError(e?.message || 'Something went wrong');
    } finally {
      setIsStreaming(false);
      abortRef.current = null;
      // Ensure feedback is cleared
      extrasFilterRef.current = { inExtras: false, carry: '', buf: '' };
      setExtrasActive(false);
      lastExtrasKeyRef.current = null;
    }
  };

  const onStop = () => {
    if (abortRef.current) {
      abortRef.current.abort();
      abortRef.current = null;
      setIsStreaming(false);
      extrasFilterRef.current = { inExtras: false, carry: '', buf: '' };
      setExtrasActive(false);
    }
  };

  return (
    <div className={["chat-assistant", expanded ? 'expanded' : 'collapsed'].join(' ')}>
      <button
        className={["chat-quick-toggle", 'btn'].join(' ')}
        onClick={() => setExpanded(v => !v)}
        aria-expanded={expanded}
        title={expanded ? 'Hide assistant' : 'Show assistant'}
      >
        {expanded ? 'Hide Assistant' : 'Assistant'}
      </button>

      {expanded ? (
        <div className="chat-panel">
          <div className="chat-header row">
            <div className="grow">
              <div className="title">Assistant</div>
              <div className="subtitle">Helps you edit and refine your document</div>
            </div>
          </div>
          <div className="chat-body" ref={listRef}>
            {visibleMessages.length === 0 && (
              <div className="empty">Ask for suggestions, rewriting, structure, summaries, or references.</div>
            )}
            {visibleMessages.map((m, idx) => (
              <div key={idx} className={["msg", m.role].join(' ')}>
                <div className="bubble">{m.role === 'user' ? (<ChatRefTags text={m.content} />) : m.content}</div>
              </div>
            ))}
            {isStreaming && extrasActive && (
              <div className="extras-feedback"><span className="spinner" /> Generating document changes…</div>
            )}
            {error && <div className="error">{error}</div>}
          </div>
          <div className="chat-input">
            <div className="row">
              <div className="chat-textarea-wrap">
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
                <button className="btn primary" onClick={onSend} disabled={!input.trim()}>Send</button>
              ) : (
                <button className="btn danger" onClick={onStop}>Stop</button>
              )}
            </div>

          </div>
        </div>
      ) : (
        <div className="chat-collapsed-row">
          <button className="chat-toggle btn" onClick={() => setExpanded(true)} aria-expanded={expanded}>
            <span className="dot" /> Assistant
          </button>
        </div>
      )}
    </div>
  );
}


