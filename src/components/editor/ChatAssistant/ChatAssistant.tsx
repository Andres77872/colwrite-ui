import { useEffect, useMemo, useRef, useState } from 'react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { useEditor } from '../../../editor';
import { streamAgentChat } from '../../../services/agentChat';
import type { SSEEventHandlers } from '../../../services/streamParser';
import { useChatSessions } from '../../chat/ChatSessionsContext';
import { listMessages, listThreads } from '../../../services/chats';
import { ChatRefPicker, type ChatRefPickerHandle } from './ChatRefPicker';
import { ChatRefTags } from './ChatRefTags';
import { ChatTaggedInput, type ChatTaggedInputHandle } from './ChatTaggedInput';

type ChatMessage = { role: string; content: string };

export function ChatAssistant() {
  const editor = useEditor();
  const { documentId } = editor;
  const { selectedChatId, selectedThreadId, setSelectedChatId, setSelectedThreadId } = useChatSessions();
  const [expanded, setExpanded] = useState<boolean>(() => {
    try { return localStorage.getItem('chat.expanded') === '1'; } catch { return false; }
  });
  const [input, setInput] = useState<string>('');
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isStreaming, setIsStreaming] = useState<boolean>(false);
  const [error, setError] = useState<string>('');
  const [agentStatus, setAgentStatus] = useState<{ status: string; detail: string } | null>(null);
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
    if (abortRef.current) {
      try { abortRef.current.abort(); } catch {}
      abortRef.current = null;
    }
    setIsStreaming(false);
    setAgentStatus(null);
    setError('');
    setInput('');
    if (clearMessages) {
      setMessages([]);
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

  // Load messages for the selected chat when selection changes
  useEffect(() => {
    (async () => {
      try {
        if (!documentId || !selectedChatId) return;
        if (abortRef.current) {
          try { abortRef.current.abort(); } catch {}
          abortRef.current = null;
        }
        setIsStreaming(false);
        setAgentStatus(null);

        let pivot: number | undefined = (selectedThreadId ?? undefined) as number | undefined;
        if (typeof pivot !== 'number') {
          const thr = await listThreads(documentId, selectedChatId, 100, 0);
          const ids = (thr.threads || []).map(t => t.id).filter((n: any) => typeof n === 'number');
          if (ids.length) pivot = Math.max(...ids);
        }
        if (typeof pivot !== 'number') return;
        const res = await listMessages(documentId, selectedChatId, pivot);
        const base: ChatMessage[] = res.messages.map((m) => {
          // Legacy safety net: strip any remaining EXTRAS_JSON tags from old DB data
          const text = m.content?.replace(/<EXTRAS_JSON>[\s\S]*?<\/EXTRAS_JSON>/g, '') || '';
          return { role: m.role as string, content: text } as ChatMessage;
        });
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
    setAgentStatus(null);

    // Optimistically add user message + empty assistant message for immediate UI
    setMessages(prev => [...prev, { role: 'user', content: text }, { role: 'assistant', content: '' }]);

    try {
      const controller = new AbortController();
      abortRef.current = controller;
      setIsStreaming(true);

      await streamAgentChat(
        { message: text, document_id: documentId, chat_id: selectedChatId, thread_id: selectedThreadId },
        {
          onToken: (content) => {
            setAgentStatus(null);
            setMessages(prev => {
              const out = prev.slice();
              for (let i = out.length - 1; i >= 0; i--) {
                if (out[i].role === 'assistant') {
                  out[i] = { ...out[i], content: (out[i].content || '') + content };
                  break;
                }
              }
              return out;
            });
          },
          onStatus: (status, detail) => setAgentStatus({ status, detail }),
          onToolCallStart: (tool, toolCallId, args) => setAgentStatus({ status: 'executing_tool', detail: `Running ${tool}...` }),
          onToolCallEnd: () => { /* tool indicator auto-clears on next onStatus/onToken */ },
          onError: (errorCode, message) => setError(message),
          onDone: (chatId, threadId, usage) => {
            if (chatId && !selectedChatId) setSelectedChatId(chatId);
            if (typeof threadId === 'number') setSelectedThreadId(threadId);
          },
        },
        { signal: controller.signal },
      );
    } catch (e: any) {
      setError(e?.message || 'Something went wrong');
    } finally {
      setIsStreaming(false);
      abortRef.current = null;
      setAgentStatus(null);
    }
  };

  const onStop = () => {
    if (abortRef.current) {
      abortRef.current.abort();
      abortRef.current = null;
      setIsStreaming(false);
      setAgentStatus(null);
    }
  };

  return (
    <div className={cn(
      "chat-assistant fixed bottom-4 right-4 z-50",
      expanded ? "w-[380px]" : "w-auto"
    )}>
      <Button
        variant="outline"
        size="sm"
        className={cn(
          "shadow-md",
          expanded && "hidden"
        )}
        onClick={() => setExpanded(v => !v)}
        aria-expanded={expanded}
        title={expanded ? 'Hide assistant' : 'Show assistant'}
      >
        {expanded ? 'Hide Assistant' : '✨ Assistant'}
      </Button>

      {expanded && (
        <div className="bg-card border border-border rounded-lg shadow-lg flex flex-col max-h-[500px]">
          <div className="flex items-center justify-between p-3 border-b border-border">
            <div className="flex-1">
              <div className="font-semibold text-sm">Assistant</div>
              <div className="text-xs text-muted-foreground">Helps you edit and refine your document</div>
            </div>
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" onClick={onNewChat} title="Start a new chat">New</Button>
              <Button variant="ghost" size="sm" onClick={() => setExpanded(false)} title="Hide assistant">×</Button>
            </div>
          </div>
          <div className="flex-1 overflow-auto p-3 space-y-3 min-h-[200px]" ref={listRef}>
            {visibleMessages.length === 0 && (
              <div className="text-center text-muted-foreground text-sm py-8">
                Ask for suggestions, rewriting, structure, summaries, or references.
              </div>
            )}
            {visibleMessages.map((m, idx) => (
              <div 
                key={idx} 
                className={cn(
                  "flex",
                  m.role === 'user' ? "justify-end" : "justify-start"
                )}
              >
                <div className={cn(
                  "max-w-[85%] px-3 py-2 rounded-lg text-sm whitespace-pre-wrap",
                  m.role === 'user' 
                    ? "bg-primary text-primary-foreground" 
                    : "bg-muted text-foreground"
                )}>
                  {m.role === 'user' ? (<ChatRefTags text={m.content} />) : m.content}
                </div>
              </div>
            ))}
            {isStreaming && agentStatus && (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                {agentStatus.status === 'executing_tool' ? (
                  <span className="animate-spin">🛠️</span>
                ) : (
                  <span className="animate-pulse">💭</span>
                )}
                {agentStatus.detail}
              </div>
            )}
            {error && <div className="text-sm text-destructive">{error}</div>}
          </div>
          <div className="p-3 border-t border-border">
            <div className="flex items-end gap-2">
              <div className="chat-textarea-wrap flex-1 relative">
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
      )}
    </div>
  );
}


