import './ChatAssistant.css';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useEditor } from '../../../editor';
import type { OpenAIChatMessage } from '../../../services';
import { streamDocumentAiChat } from '../../../services';
import { useChatSessions } from '../../chat/ChatSessionsContext';
import { listMessages, listThreads } from '../../../services/chats';
import { ChatRefPicker, type ChatRefPickerHandle } from './ChatRefPicker';
import { ChatRefTags } from './ChatRefTags';
import { ChatTaggedInput, type ChatTaggedInputHandle } from './ChatTaggedInput';

type ChatMessage = OpenAIChatMessage;

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

// normalizeBlock removed – we don't apply extras patches in the UI stream anymore.

// (Removed patch application helpers; extras are not applied during streaming.)

// --- Utilities ---
// Remove any <EXTRAS_JSON>{...}</EXTRAS_JSON> blocks from a text content string.
function stripExtrasTags(text: string | undefined | null): { text: string; hadExtras: boolean } {
  if (typeof text !== 'string' || !text) return { text: '', hadExtras: false };
  const re = /<EXTRAS_JSON>[\s\S]*?<\/EXTRAS_JSON>/g; // non-greedy across lines
  const hadExtras = re.test(text);
  const cleaned = text.replace(re, '');
  return { text: cleaned, hadExtras };
}

export function ChatAssistant() {
  const { documentId, createRemote } = useEditor();
  const { selectedChatId, selectedThreadId, setSelectedChatId, setSelectedThreadId } = useChatSessions();
  const [expanded, setExpanded] = useState<boolean>(() => {
    try { return localStorage.getItem('chat.expanded') === '1'; } catch { return false; }
  });
  const extrasFilterRef = useRef<ExtrasFilterState>({ inExtras: false, carry: '', buf: '' });
  const [extrasActive, setExtrasActive] = useState<boolean>(false);
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
  
  // Helpers to reset chat UI and start a brand new chat
  const resetChatUI = (clearMessages: boolean = true) => {
    // Stop any ongoing stream
    if (abortRef.current) {
      try { abortRef.current.abort(); } catch {}
      abortRef.current = null;
    }
    setIsStreaming(false);
    // Reset extras/feedback state
    extrasFilterRef.current = { inExtras: false, carry: '', buf: '' };
    setExtrasActive(false);
    // Clear input and error
    setError('');
    setInput('');
    // Optionally reset messages to just the system prompt
    if (clearMessages) {
      setMessages([
        { role: 'system', content: 'You are a helpful writing assistant embedded in a document editor. Provide concise, actionable suggestions. When relevant, reference the current document context.' },
      ]);
    }
  };

  const onNewChat = () => {
    // Clear UI and forget the selected chat/thread
    resetChatUI(true);
    setSelectedChatId(null);
    setSelectedThreadId(null);
    // Put caret at start for quick typing
    requestAnimationFrame(() => inputHostRef.current?.setSelectionRange(0, 0));
  };

  useEffect(() => {
    if (listRef.current) {
      listRef.current.scrollTop = listRef.current.scrollHeight;
    }
  }, [visibleMessages, isStreaming]);

  // Improve UX: open the assistant when a chat gets selected
  useEffect(() => {
    if (selectedChatId) setExpanded(true);
  }, [selectedChatId]);

  // Clear the chat UI when the document changes
  useEffect(() => {
    resetChatUI(true);
  }, [documentId]);

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
          ...res.messages.map((m) => {
            const { text } = stripExtrasTags(m.content);
            return { role: m.role as any, content: text } as ChatMessage;
          })
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
          // 2) Subtle feedback only: detect presence of extras but do NOT apply changes
          try {
            const sseExtras: any = (chunk as any)?.extras ?? null;
            const hasInline = inlineExtras && inlineExtras.length > 0;
            const hasAny = Boolean(sseExtras) || hasInline || extrasFilterRef.current.inExtras;
            if (hasAny) setExtrasActive(true);
          } catch {
            // ignore
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
            <div>
              <button className="btn" onClick={onNewChat} title="Start a new chat">New chat</button>
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
              <div className="extras-feedback"><span className="spinner" /> Processing changes…</div>
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


