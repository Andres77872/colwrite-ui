import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { usePersistentState, isBoolean } from '@/hooks/usePersistentState';
import { useEditor } from '@/editor';
import { useProposals } from '@/editor/proposalsContextState';
import { streamAgentChat } from '@/services/agentChat';
import type { ToolAction } from '@/editor/types';
import { useChatSessions } from '../../chat/chatSessionsState';
import { listMessages, listThreads } from '@/services/chats';
import { uid } from '@/lib/uid';
import { ChatRefPicker, type ChatRefPickerHandle } from './ChatRefPicker';
import { ChatRefTags } from './ChatRefTags';
import { ChatTaggedInput, type ChatTaggedInputHandle } from './ChatTaggedInput';
import { ChatMarkdown } from './ChatMarkdown';
import { AgentActivity, type ToolRun } from './AgentActivity';
import {
  AlertCircle,
  ArrowDown,
  Maximize2,
  MessageSquarePlus,
  Minimize2,
  RotateCcw,
  Send,
  Sparkles,
  Square,
  X,
} from 'lucide-react';

type ChatMessage = {
  id: string;
  role: string;
  content: string;
  /** Tools the agent ran while producing this reply, in order. */
  runs: ToolRun[];
  /** How many changes this reply put up for review in the document. */
  proposed: number;
};

/** How close to the bottom counts as "following along" for auto-scroll. */
const AUTOSCROLL_THRESHOLD_PX = 64;

const SUGGESTIONS = [
  'Summarise this document in three sentences',
  'Tighten the introduction',
  'Suggest a structure for the results section',
];

function emptyMessage(role: string, content = ''): ChatMessage {
  return { id: uid(), role, content, runs: [], proposed: 0 };
}

function boundedArgument(value: unknown, limit = 120): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim().replace(/\s+/g, ' ');
  if (!normalized) return null;
  return normalized.length <= limit ? normalized : `${normalized.slice(0, limit - 1)}…`;
}

function toolRunDetail(tool: string, args: Record<string, unknown>): string | undefined {
  if (tool === 'semantic_scholar_search') {
    const query = boundedArgument(args.query);
    return query ? `Query: “${query}”` : undefined;
  }
  if (tool === 'semantic_scholar_paper') {
    const paperId = boundedArgument(args.paper_id);
    return paperId ? `Paper: ${paperId}` : undefined;
  }
  if (tool === 'semantic_scholar_graph') {
    const paperId = boundedArgument(args.paper_id, 80);
    const direction = boundedArgument(args.direction, 20);
    return [direction && `Direction: ${direction}`, paperId && `paper ${paperId}`]
      .filter(Boolean)
      .join(' · ') || undefined;
  }
  if (tool === 'semantic_scholar_recommendations') {
    const paperId = boundedArgument(args.paper_id);
    return paperId ? `Seed paper: ${paperId}` : undefined;
  }
  if (tool === 'semantic_scholar_snippets') {
    const query = boundedArgument(args.query);
    return query ? `Evidence query: “${query}”` : undefined;
  }
  if (tool === 'validate_claim') {
    const claim = boundedArgument(args.claim);
    return claim ? `Claim: “${claim}”` : undefined;
  }
  if (tool === 'search_citations') {
    const text = typeof args.text === 'string' ? args.text.trim() : '';
    return text ? `Checked a ${text.length.toLocaleString()}-character passage` : undefined;
  }
  return undefined;
}

export function ChatAssistant() {
  const { documentId } = useEditor();
  return <DocumentChatAssistant key={documentId ?? 'local'} />;
}

function DocumentChatAssistant() {
  const editor = useEditor();
  const { documentId } = editor;
  const proposals = useProposals();
  const { selectedChatId, selectedThreadId, setSelectedChatId, setSelectedThreadId } =
    useChatSessions();

  const [expanded, setExpanded] = usePersistentState<boolean>('chat.expanded', false, isBoolean);
  const [enlarged, setEnlarged] = usePersistentState<boolean>('chat.enlarged', false, isBoolean);
  const [input, setInput] = useState('');
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const [error, setError] = useState('');
  const [agentStatus, setAgentStatus] = useState<{ status: string; detail: string } | null>(null);
  const [atBottom, setAtBottom] = useState(true);

  const abortRef = useRef<AbortController | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);
  const inputHostRef = useRef<ChatTaggedInputHandle | null>(null);
  const refPickerRef = useRef<ChatRefPickerHandle | null>(null);
  const pinnedToBottom = useRef(true);
  // tool_call_ids already handled, so a redelivered event cannot double-queue.
  const processedToolCallIds = useRef<Set<string>>(new Set());
  // The message currently being written into, so stream callbacks can find it
  // without scanning for "the last assistant message" on every token.
  const activeMessageIdRef = useRef<string | null>(null);
  const [activeMessageId, setActiveMessageId] = useState<string | null>(null);
  // What was sent last, so a failed turn can be retried without retyping.
  const [lastSent, setLastSent] = useState<string | null>(null);
  const unsavedNoticeId = useId();

  const visibleMessages = useMemo(
    () => messages.filter((m) => m.role !== 'system'),
    [messages],
  );

  // The finished reply, announced once. Empty while streaming so the live
  // region stays silent until there is something whole to read out.
  const completedReply = useMemo(() => {
    if (isStreaming) return '';
    for (let i = visibleMessages.length - 1; i >= 0; i -= 1) {
      if (visibleMessages[i].role === 'assistant') return visibleMessages[i].content;
    }
    return '';
  }, [isStreaming, visibleMessages]);

  const patchActive = useCallback((update: (message: ChatMessage) => ChatMessage) => {
    const id = activeMessageIdRef.current;
    if (!id) return;
    setMessages((prev) => prev.map((m) => (m.id === id ? update(m) : m)));
  }, []);

  const resetChatUI = useCallback((clearMessages = true) => {
    abortRef.current?.abort();
    abortRef.current = null;
    setIsStreaming(false);
    setAgentStatus(null);
    setError('');
    setInput('');
    activeMessageIdRef.current = null;
    setActiveMessageId(null);
    if (clearMessages) setMessages([]);
  }, []);

  /**
   * Hand a streamed document mutation to the review layer.
   *
   * Nothing is applied here. The agent's operations are staged server-side and
   * the author accepts or rejects each one on the block it affects — a rewrite
   * cannot be judged from a chat bubble, only against the paragraph it
   * replaces.
   */
  const onToolAction = useCallback(
    (action: ToolAction) => {
      // Only a genuine redelivery is a duplicate. The id alone is not enough:
      // providers that number tool calls per request reuse `call_0`, and some
      // send none at all. The previous fallback keyed on the document version,
      // which a proposal deliberately leaves unchanged — so two staged batches
      // in one run collapsed into one and the second edit vanished.
      const dedupKey = `${action.toolCallId}:${action.status}:${JSON.stringify(action.actions)}`;
      if (processedToolCallIds.current.has(dedupKey)) return;
      processedToolCallIds.current.add(dedupKey);

      const { changes } = proposals.receive(action);

      if (action.status === 'error') {
        setError(action.message || 'The assistant could not complete that edit.');
      }

      if (changes > 0) {
        patchActive((message) => ({ ...message, proposed: message.proposed + changes }));
      }
    },
    [patchActive, proposals],
  );

  // Follow new output only while the reader is already at the bottom, so
  // scrolling back through history is not yanked away mid-stream.
  useEffect(() => {
    const list = listRef.current;
    if (!list || !pinnedToBottom.current) return;
    list.scrollTop = list.scrollHeight;
  }, [visibleMessages, isStreaming, agentStatus]);

  useEffect(() => {
    if (selectedChatId) setExpanded(true);
  }, [selectedChatId, setExpanded]);

  // Load the selected conversation's history.
  useEffect(() => {
    if (!documentId || !selectedChatId) return;
    let cancelled = false;

    (async () => {
      abortRef.current?.abort();
      abortRef.current = null;
      setIsStreaming(false);
      setAgentStatus(null);

      try {
        let pivot = typeof selectedThreadId === 'number' ? selectedThreadId : undefined;
        if (pivot === undefined) {
          const threads = await listThreads(documentId, selectedChatId, 100, 0);
          const ids = (threads.threads ?? [])
            .map((t) => t.id)
            .filter((n): n is number => typeof n === 'number');
          if (ids.length) pivot = Math.max(...ids);
        }
        if (pivot === undefined || cancelled) return;

        const res = await listMessages(documentId, selectedChatId, pivot);
        if (cancelled) return;

        setMessages(
          res.messages.map((m) =>
            emptyMessage(
              m.role,
              // Legacy rows can still carry EXTRAS_JSON envelopes.
              m.content?.replace(/<EXTRAS_JSON>[\s\S]*?<\/EXTRAS_JSON>/g, '') ?? '',
            ),
          ),
        );
        if (typeof res.pivotThreadId === 'number') setSelectedThreadId(res.pivotThreadId);
      } catch {
        if (!cancelled) setError('Could not load this conversation.');
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [documentId, selectedChatId, selectedThreadId, setSelectedThreadId]);

  const onNewChat = () => {
    resetChatUI(true);
    setSelectedChatId(null);
    setSelectedThreadId(null);
    requestAnimationFrame(() => inputHostRef.current?.setSelectionRange(0, 0));
  };

  const send = async (text: string) => {
    if (!text || isStreaming) return;
    if (!documentId) {
      setError('Save this document before chatting about it.');
      return;
    }

    setError('');
    setInput('');
    setAgentStatus(null);
    pinnedToBottom.current = true;
    setLastSent(text);
    // Tool-call ids are only unique within a run for some providers.
    processedToolCallIds.current = new Set();

    const assistantMessage = emptyMessage('assistant');
    activeMessageIdRef.current = assistantMessage.id;
    setActiveMessageId(assistantMessage.id);
    setMessages((prev) => [...prev, emptyMessage('user', text), assistantMessage]);

    const controller = new AbortController();
    abortRef.current = controller;
    setIsStreaming(true);

    try {
      await streamAgentChat(
        {
          message: text,
          document_id: documentId,
          chat_id: selectedChatId,
          thread_id: selectedThreadId,
        },
        {
          onToken: (content) => {
            setAgentStatus(null);
            patchActive((message) => ({ ...message, content: message.content + content }));
          },
          onStatus: (status, detail) => setAgentStatus({ status, detail }),
          onToolCallStart: (tool, toolCallId, args) => {
            setAgentStatus({ status: 'executing_tool', detail: `Running ${tool}…` });
            patchActive((message) => ({
              ...message,
              runs: [
                ...message.runs,
                {
                  id: toolCallId || `${tool}:${message.runs.length}`,
                  tool,
                  state: 'running',
                  detail: toolRunDetail(tool, args),
                },
              ],
            }));
          },
          onToolCallEnd: (tool, toolCallId, durationMs, isError) => {
            patchActive((message) => {
              const index = message.runs.findIndex(
                (run) =>
                  run.state === 'running' && (toolCallId ? run.id === toolCallId : run.tool === tool),
              );
              if (index === -1) return message;
              const runs = message.runs.slice();
              runs[index] = {
                ...runs[index],
                state: isError ? 'error' : 'done',
                durationMs,
              };
              return { ...message, runs };
            });
          },
          onToolAction,
          onError: (_code, message) => {
            patchActive((active) => ({
              ...active,
              runs: active.runs.map((run) =>
                run.state === 'running' ? { ...run, state: 'error' as const } : run,
              ),
            }));
            setError(message);
          },
          onDone: (chatId, threadId) => {
            if (chatId && !selectedChatId) setSelectedChatId(chatId);
            if (typeof threadId === 'number') setSelectedThreadId(threadId);
          },
        },
        { signal: controller.signal },
      );
    } catch (e) {
      // An aborted stream is a deliberate stop, not a failure to report.
      if (!controller.signal.aborted) {
        setError(e instanceof Error ? e.message : 'Something went wrong');
      }
    } finally {
      setIsStreaming(false);
      abortRef.current = null;
      setAgentStatus(null);
      // A tool that never reported completion would otherwise spin forever.
      patchActive((message) => ({
        ...message,
        runs: message.runs.map((run) =>
          run.state === 'running' ? { ...run, state: 'done' as const } : run,
        ),
      }));
      activeMessageIdRef.current = null;
      setActiveMessageId(null);
    }
  };

  const onSend = () => send(input.trim());

  const onRetry = () => {
    const text = lastSent;
    if (!text) return;
    // Drop the failed exchange so the transcript does not accumulate dead ends.
    setMessages((prev) => prev.slice(0, -2));
    setError('');
    send(text);
  };

  const onStop = () => {
    abortRef.current?.abort();
    abortRef.current = null;
    setIsStreaming(false);
    setAgentStatus(null);
  };

  // Anchored inside the canvas (`main` is the positioned ancestor) rather than
  // to the viewport, so it no longer floats on top of the tools panel.
  if (!expanded) {
    return (
      <Button
        variant="outline"
        className="absolute bottom-4 right-4 shadow-lg z-[var(--z-floating)]"
        onClick={() => setExpanded(true)}
        aria-expanded={false}
      >
        <Sparkles aria-hidden="true" className="h-4 w-4 text-primary" />
        Assistant
        {proposals.pendingCount > 0 && (
          <span className="ml-1 rounded-full bg-primary px-1.5 text-xs font-medium text-primary-foreground">
            {proposals.pendingCount}
          </span>
        )}
      </Button>
    );
  }

  return (
    <div
      role="complementary"
      aria-label="Writing assistant"
      className={cn(
        'absolute bottom-4 right-4 flex flex-col rounded-xl border border-border bg-card shadow-xl z-[var(--z-floating)]',
        'animate-in fade-in-0 slide-in-from-bottom-2',
        enlarged
          ? 'max-h-[calc(100%-2rem)] w-[min(34rem,calc(100%-2rem))]'
          : 'max-h-[min(32rem,calc(100%-2rem))] w-[min(24rem,calc(100%-2rem))]',
      )}
    >
      <div className="flex flex-shrink-0 items-center justify-between gap-2 border-b border-border px-3 py-2">
        <div className="min-w-0">
          <p className="text-sm font-semibold">Assistant</p>
          <p className="truncate text-xs text-muted-foreground">
            Suggests edits — you approve them in the document
          </p>
        </div>
        <div className="flex flex-shrink-0 items-center gap-0.5">
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={onNewChat}
            aria-label="Start a new chat"
            title="New chat"
          >
            <MessageSquarePlus className="h-4 w-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={() => setEnlarged((value) => !value)}
            aria-label={enlarged ? 'Shrink assistant' : 'Enlarge assistant'}
            title={enlarged ? 'Shrink' : 'Enlarge'}
          >
            {enlarged ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={() => setExpanded(false)}
            aria-label="Hide assistant"
            title="Hide assistant"
          >
            <X className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {proposals.pendingCount > 0 && (
        <button
          type="button"
          onClick={() => {
            const first = proposals.pending[0];
            if (first) proposals.focusChange(first.id);
          }}
          className="flex flex-shrink-0 items-center gap-2 border-b border-border bg-primary/10 px-3 py-2 text-left text-xs transition-colors hover:bg-primary/15"
        >
          <Sparkles aria-hidden="true" className="h-3.5 w-3.5 shrink-0 text-primary" />
          <span className="min-w-0 flex-1">
            {proposals.pendingCount} {proposals.pendingCount === 1 ? 'change is' : 'changes are'}{' '}
            waiting in the document
          </span>
          <ArrowDown aria-hidden="true" className="h-3.5 w-3.5 shrink-0 text-primary" />
        </button>
      )}

      <div
        ref={listRef}
        className="min-h-[12rem] flex-1 space-y-3 overflow-y-auto p-3"
        onScroll={(event) => {
          const el = event.currentTarget;
          const bottom = el.scrollHeight - el.scrollTop - el.clientHeight <= AUTOSCROLL_THRESHOLD_PX;
          pinnedToBottom.current = bottom;
          setAtBottom(bottom);
        }}
        // Deliberately not a live region. Markdown arrives token by token, so
        // `aria-live` here made a screen reader restart the whole growing reply
        // on every chunk. The typing indicator and `agentStatus` below already
        // announce progress, and `role="status"` announces the finished reply.
        aria-busy={isStreaming}
      >
        {visibleMessages.length === 0 && (
          <div className="space-y-3 py-6">
            <p className="text-center text-sm text-muted-foreground text-balance">
              Ask for suggestions, rewrites, structure, summaries or references. Edits arrive as
              changes you accept in the document.
            </p>
            <div className="flex flex-col gap-1.5">
              {SUGGESTIONS.map((suggestion) => (
                <button
                  key={suggestion}
                  type="button"
                  onClick={() => send(suggestion)}
                  disabled={!documentId}
                  // `aria-disabled` alongside `disabled` so the reason below is
                  // reachable: these are the only three affordances in the
                  // empty state, and on an unsaved document all three used to
                  // sit greyed out with nothing saying why.
                  aria-disabled={!documentId}
                  aria-describedby={documentId ? undefined : unsavedNoticeId}
                  className="rounded-md border border-border px-2.5 py-1.5 text-left text-xs text-muted-foreground transition-colors hover:border-primary/50 hover:text-foreground disabled:opacity-50"
                >
                  {suggestion}
                </button>
              ))}
            </div>

            {!documentId && (
              <p id={unsavedNoticeId} className="text-center text-xs text-muted-foreground">
                Save the document to use these.
              </p>
            )}
          </div>
        )}

        {visibleMessages.map((message) => {
          const isUser = message.role === 'user';
          const isStreamingTail =
            isStreaming &&
            !isUser &&
            message.id === activeMessageId &&
            !message.content &&
            message.runs.length === 0;

          return (
            <div key={message.id} className={cn('flex', isUser ? 'justify-end' : 'justify-start')}>
              <div
                className={cn(
                  'min-w-0 max-w-[85%] rounded-lg px-3 py-2 text-sm',
                  isUser
                    ? 'whitespace-pre-wrap bg-primary text-primary-foreground'
                    : 'w-full bg-muted text-foreground',
                )}
              >
                {isUser ? (
                  <ChatRefTags text={message.content} />
                ) : (
                  <div className="space-y-2">
                    {message.runs.length > 0 && (
                      <AgentActivity
                        runs={message.runs}
                        live={isStreaming && message.id === activeMessageId}
                      />
                    )}

                    {isStreamingTail ? (
                      <span className="inline-flex gap-1" aria-label="Assistant is typing">
                        {[0, 1, 2].map((dot) => (
                          <span
                            key={dot}
                            className="h-1.5 w-1.5 animate-shimmer rounded-full bg-muted-foreground"
                            style={{ animationDelay: `${dot * 160}ms` }}
                          />
                        ))}
                      </span>
                    ) : (
                      message.content && <ChatMarkdown text={message.content} />
                    )}

                    {message.proposed > 0 && (
                      <button
                        type="button"
                        onClick={() => {
                          const first = proposals.pending[0];
                          if (first) proposals.focusChange(first.id);
                        }}
                        className="flex w-full items-center gap-1.5 rounded-md border border-primary/40 bg-primary/10 px-2 py-1.5 text-left text-xs transition-colors hover:bg-primary/15"
                      >
                        <Sparkles aria-hidden="true" className="h-3 w-3 shrink-0 text-primary" />
                        <span className="min-w-0 flex-1">
                          Suggested {message.proposed}{' '}
                          {message.proposed === 1 ? 'change' : 'changes'} — review in the document
                        </span>
                      </button>
                    )}
                  </div>
                )}
              </div>
            </div>
          );
        })}

        <p role="status" aria-live="polite" className="sr-only">
          {completedReply}
        </p>

        {isStreaming && agentStatus && (
          <p className="flex items-center gap-2 text-xs text-muted-foreground">
            <span
              className="h-1.5 w-1.5 animate-shimmer rounded-full bg-primary"
              aria-hidden="true"
            />
            {agentStatus.detail}
          </p>
        )}

        {error && (
          <div role="alert" className="space-y-1.5 rounded-md bg-destructive/10 px-2 py-1.5">
            <p className="flex items-start gap-1.5 text-xs text-destructive">
              <AlertCircle aria-hidden="true" className="mt-px h-3.5 w-3.5 shrink-0" />
              <span className="min-w-0 break-words">{error}</span>
            </p>
            {lastSent && !isStreaming && (
              <Button
                size="sm"
                variant="ghost"
                className="h-6 gap-1 px-1.5 text-xs"
                onClick={onRetry}
              >
                <RotateCcw className="h-3 w-3" />
                Try again
              </Button>
            )}
          </div>
        )}
      </div>

      {!atBottom && (
        <button
          type="button"
          className="absolute bottom-20 left-1/2 -translate-x-1/2 rounded-full border border-border bg-card p-1.5 shadow-md"
          onClick={() => {
            const list = listRef.current;
            if (!list) return;
            list.scrollTop = list.scrollHeight;
            pinnedToBottom.current = true;
            setAtBottom(true);
          }}
          aria-label="Scroll to latest"
        >
          <ArrowDown className="h-3.5 w-3.5" />
        </button>
      )}

      <div className="flex-shrink-0 border-t border-border p-3">
        <div className="flex items-end gap-2">
          <div className="relative flex-1">
            <ChatTaggedInput
              ref={inputHostRef}
              value={input}
              onChange={setInput}
              placeholder="Ask the assistant…"
              onTriggerPicker={(anchor) => refPickerRef.current?.openAt(anchor)}
              onEditRef={(start) => refPickerRef.current?.openAt(start, { editing: true })}
              onRemoveRef={(start, refText) => {
                setInput(input.slice(0, start) + input.slice(start + refText.length));
                requestAnimationFrame(() => inputHostRef.current?.setSelectionRange(start, start));
              }}
              onKeyDown={(event) => {
                if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') onSend();
              }}
              maxLength={2000}
              showStatus
            />
            <ChatRefPicker
              ref={refPickerRef}
              getHost={() => inputHostRef.current?.getHost() ?? null}
              input={input}
              setInput={setInput}
              setCaretIndex={(index) => inputHostRef.current?.setSelectionRange(index, index)}
            />
          </div>

          {isStreaming ? (
            <Button variant="destructive" size="icon" onClick={onStop} aria-label="Stop generating">
              <Square className="h-4 w-4" />
            </Button>
          ) : (
            <Button
              size="icon"
              onClick={onSend}
              disabled={!input.trim()}
              aria-label="Send message"
              title="Send · Ctrl+Enter"
            >
              <Send className="h-4 w-4" />
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
