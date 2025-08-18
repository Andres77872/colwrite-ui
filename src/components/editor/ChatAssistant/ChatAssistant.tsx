import './ChatAssistant.css';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useEditor } from '../../../editor';
import type { OpenAIChatMessage } from '../../../services';
import { streamDocumentAiChat } from '../../../services';
import { ChatRefPicker, type ChatRefPickerHandle } from './ChatRefPicker';
import { ChatRefTags } from './ChatRefTags';
import { ChatTaggedInput, type ChatTaggedInputHandle } from './ChatTaggedInput';

type ChatMessage = OpenAIChatMessage;

export function ChatAssistant() {
  const { documentId, createRemote } = useEditor();
  const [expanded, setExpanded] = useState<boolean>(() => {
    try { return localStorage.getItem('chat.expanded') === '1'; } catch { return false; }
  });
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
        onChunk: (delta) => {
          setMessages(prev => {
            const out = prev.slice();
            // Append delta to the last assistant message
            for (let i = out.length - 1; i >= 0; i--) {
              if (out[i].role === 'assistant') {
                out[i] = { ...out[i], content: (out[i].content || '') + delta };
                break;
              }
            }
            return out;
          });
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
            <div className="hints">Press Ctrl/⌘+Enter to send</div>
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


