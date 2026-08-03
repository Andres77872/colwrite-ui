import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useEditor } from '@/editor';
import { createChat, deleteChat, listChats, updateChatTitle, type ChatItem } from '@/services/chats';
import { describeApiError, describeReadiness } from '@/services/contracts';
import { isRetryableProblem, isTerminalReadiness } from '@/services/retry';
import { useChatSessions } from '@/components/chat/chatSessionsState';
import { cn } from '@/lib/utils';
import { formatDateTime } from '@/lib/text';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { EmptyState } from '@/components/ui/empty-state';
import { Skeleton, Spinner } from '@/components/ui/spinner';
import { useConfirm } from '@/components/ui/confirmContext';
import { useToast } from '@/components/ui/toastContext';
import {
  AlertCircle,
  ChevronLeft,
  ChevronRight,
  Clock,
  MessageSquare,
  Pencil,
  Plus,
  RefreshCw,
  Save,
  Trash2,
} from 'lucide-react';

const PAGE_SIZE = 10;

/**
 * Readiness verdicts that say nothing about the projection — a dropped probe,
 * or a backend without the endpoint. Reading anyway is right: the server keeps
 * its own typed rejection as the source of truth, and a probe we could not
 * trust must not wall off a read that would have worked.
 */
const INCONCLUSIVE_READINESS = new Set([
  'unavailable',
  'aborted',
  'no_document',
  'save_failed',
]);

function chatLabel(chat: ChatItem): string {
  return chat.title?.trim() || `Untitled chat · ${chat.chat_id.slice(0, 8)}`;
}

/**
 * A conversation is stored against the document's projected numeric identity,
 * which lands shortly after the save that created it. Until it does the list
 * cannot be read — a wait, not a failure, and worth saying so.
 */
type ListError = { message: string; preparing: boolean };

export function ChatsPanel() {
  const { documentId, ensureRemoteDocument, waitForReady } = useEditor();
  const { selectedChatId, setSelectedChatId, setSelectedThreadId } = useChatSessions();
  const confirm = useConfirm();
  const { toast } = useToast();

  const [items, setItems] = useState<ChatItem[]>([]);
  const [loading, setLoading] = useState(false);
  // Background list loads report in place; toasts are reserved for actions the
  // user actually initiated (create, delete, rename).
  const [listError, setListError] = useState<ListError | null>(null);
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(1);
  const [count, setCount] = useState(0);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  /** Bumped to re-run the load effect — the single way the list is fetched. */
  const [refreshTick, setRefreshTick] = useState(0);
  const reload = useCallback(() => setRefreshTick((tick) => tick + 1), []);
  /**
   * The editor context value is rebuilt unmemoized on every render, so
   * `waitForReady` is a fresh closure each time and putting it in a dep array
   * would re-run the load forever.
   */
  const waitForReadyRef = useRef(waitForReady);
  // Synced in a layout effect, not during render: a render React discards must
  // not be the one that decides which probe the next load uses.
  useLayoutEffect(() => {
    waitForReadyRef.current = waitForReady;
  });

  const totalPages = useMemo(() => Math.max(1, Math.ceil(count / PAGE_SIZE)), [count]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return items;
    return items.filter(
      (c) => (c.title ?? '').toLowerCase().includes(q) || c.chat_id.includes(q),
    );
  }, [items, query]);

  // One loader. There used to be a second, callable copy for the action
  // buttons; it shared no cancellation with this one, so the two could race
  // and the earlier `finally` would clear the later request's loading state.
  // Everything now goes through `reload()`.
  useEffect(() => {
    const controller = new AbortController();

    (async () => {
      if (!documentId) {
        setItems([]);
        setCount(0);
        return;
      }
      setLoading(true);
      try {
        // Ask whether the server can answer before asking it to. The probe is
        // a 200 either way, so waiting here costs nothing in the console,
        // where the chats endpoint would have logged a 503 per attempt.
        //
        // `save: false` is load-bearing, not a default: flushing pending edits
        // would advance the very head this read is waiting for, and the wait
        // could never end. No signal either — the probe is shared between the
        // panels, and aborting it would settle it for everyone awaiting it.
        const readiness = await waitForReadyRef.current({ timeoutMs: 3000, save: false });
        if (controller.signal.aborted) return;

        const inconclusive = INCONCLUSIVE_READINESS.has(readiness.status);
        if (!readiness.ready && !inconclusive) {
          setListError({
            message: describeReadiness(readiness.status),
            preparing: !isTerminalReadiness(readiness.status),
          });
          setItems([]);
          setCount(0);
          return;
        }

        const res = await listChats(documentId, PAGE_SIZE, (page - 1) * PAGE_SIZE, {
          signal: controller.signal,
          // A verdict we could not trust must not wall off a read that may
          // well work — but cap it at one attempt so a stale backend costs one
          // console line rather than three.
          ...(inconclusive ? { retry: { maxAttempts: 1 } } : {}),
        });
        if (controller.signal.aborted) return;
        setItems(res.chats ?? []);
        setCount(res.count ?? 0);
        setListError(null);
      } catch (error) {
        if (controller.signal.aborted) return;
        setListError({
          message: describeApiError(error, 'Request failed'),
          preparing: isRetryableProblem(error),
        });
        setItems([]);
        setCount(0);
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    })();

    return () => {
      // Also aborts the api layer's backoff sleep, which used to run on past
      // a document switch with nothing left to receive it.
      controller.abort();
    };
  }, [documentId, page, refreshTick]);

  const selectChat = (chat: ChatItem) => {
    setSelectedChatId(chat.chat_id);
    setSelectedThreadId(typeof chat.last_thread_id === 'number' ? chat.last_thread_id : null);
  };

  async function onCreate() {
    setLoading(true);
    try {
      // A chat is stored against a document, so an unsaved draft has nothing to
      // attach to. Saving it here is what makes the conversation belong to the
      // document the author is looking at rather than to nothing at all.
      const attachedId = documentId ?? (await ensureRemoteDocument());
      if (!attachedId) {
        toast({
          title: 'Could not save this document',
          description: 'A conversation is kept with a document, so it has to be saved first.',
          variant: 'error',
        });
        return;
      }
      const res = await createChat(attachedId);
      // The effect reads the current `documentId`, which `ensureRemoteDocument`
      // has just set, so the id no longer has to be threaded through by hand.
      reload();
      setSelectedChatId(res.chat_id);
      setSelectedThreadId(null);
    } catch (error) {
      toast({
        title: 'Could not create chat',
        description: error instanceof Error ? error.message : undefined,
        variant: 'error',
      });
    } finally {
      setLoading(false);
    }
  }

  async function onDelete(chat: ChatItem) {
    if (!documentId) return;
    const ok = await confirm({
      title: `Delete “${chatLabel(chat)}”?`,
      description: 'The conversation and its messages are removed permanently.',
      confirmLabel: 'Delete',
      destructive: true,
    });
    if (!ok) return;

    setLoading(true);
    try {
      await deleteChat(documentId, chat.chat_id);
      if (selectedChatId === chat.chat_id) {
        setSelectedChatId(null);
        setSelectedThreadId(null);
      }
      const nextPage = Math.min(page, Math.max(1, Math.ceil(Math.max(0, count - 1) / PAGE_SIZE)));
      setPage(nextPage);
      reload();
    } catch (error) {
      toast({
        title: 'Could not delete chat',
        description: error instanceof Error ? error.message : undefined,
        variant: 'error',
      });
    } finally {
      setLoading(false);
    }
  }

  async function commitRename(chatId: string) {
    if (!documentId || renamingId !== chatId) return;
    const nextTitle = renameValue.trim();
    setRenamingId(null);
    setRenameValue('');
    try {
      await updateChatTitle(documentId, chatId, nextTitle);
      reload();
    } catch (error) {
      toast({
        title: 'Could not rename chat',
        description: error instanceof Error ? error.message : undefined,
        variant: 'error',
      });
    }
  }

  function cancelRename() {
    setRenamingId(null);
    setRenameValue('');
  }

  if (!documentId) {
    return (
      <EmptyState
        icon={MessageSquare}
        title="Not saved yet"
        description="A conversation is kept with a document. Starting one saves this document and attaches the chat to it."
        className="h-full"
        action={
          <Button size="sm" onClick={onCreate} disabled={loading}>
            {loading ? <Spinner /> : <Plus className="h-3.5 w-3.5" />}
            Save and start a chat
          </Button>
        }
      />
    );
  }

  const showSkeleton = loading && items.length === 0;

  return (
    <div className="flex h-full flex-col gap-3" aria-busy={loading}>
      <div className="flex items-center gap-1.5">
        <Input
          type="search"
          className="h-8 flex-1"
          placeholder="Filter chats…"
          aria-label="Filter chats"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={reload}
          disabled={loading}
          aria-label="Refresh chat list"
          title="Refresh"
        >
          <RefreshCw className={cn('h-3.5 w-3.5', loading && 'animate-spin')} />
        </Button>
      </div>

      <Button size="sm" onClick={onCreate} disabled={loading} className="w-full">
        {loading ? <Spinner /> : <Plus className="h-3.5 w-3.5" />}
        New chat
      </Button>

      {/* The scroll region is the wrapper, not the list: the error and empty
          states are not list items, and hanging them off `<ul>` put non-`<li>`
          children in a list — invalid, and it makes the list announce a phantom
          entry. `DocumentsMenu` already keeps them outside. */}
      <div className="min-h-0 flex-1 space-y-1.5 overflow-y-auto">
        <ul className="space-y-1.5">
          {showSkeleton &&
            Array.from({ length: 3 }).map((_, index) => (
              <li key={index} className="rounded-lg border border-border p-3">
                <Skeleton className="mb-2 h-3.5 w-2/3" />
                <Skeleton className="h-3 w-1/3" />
              </li>
            ))}

          {!showSkeleton &&
            filtered.map((chat) => {
              const isSelected = chat.chat_id === selectedChatId;
              const isRenaming = renamingId === chat.chat_id;

              return (
                <li key={chat.chat_id}>
                  <div
                    className={cn(
                      'group flex items-center gap-1 rounded-lg border transition-colors',
                      isSelected ? 'border-primary bg-primary/10' : 'border-border bg-card hover:bg-accent',
                    )}
                  >
                    {isRenaming ? (
                      <div className="flex flex-1 items-center gap-1 p-2">
                        <Input
                          autoFocus
                          className="h-7 flex-1"
                          aria-label="Chat title"
                          value={renameValue}
                          onChange={(event) => setRenameValue(event.target.value)}
                          onKeyDown={(event) => {
                            if (event.key === 'Enter') {
                              event.preventDefault();
                              commitRename(chat.chat_id);
                            }
                            if (event.key === 'Escape') {
                              event.preventDefault();
                              cancelRename();
                            }
                          }}
                          onBlur={() => commitRename(chat.chat_id)}
                        />
                        <Button
                          size="icon-sm"
                          // Without this, blur fires first and commits the rename
                          // before the click ever reaches the button.
                          onMouseDown={(event) => event.preventDefault()}
                          onClick={() => commitRename(chat.chat_id)}
                          aria-label="Save chat title"
                        >
                          <Save className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    ) : (
                      <>
                        <button
                          type="button"
                          onClick={() => selectChat(chat)}
                          aria-current={isSelected ? 'true' : undefined}
                          className="flex min-w-0 flex-1 items-center gap-2.5 rounded-lg p-2.5 text-left"
                        >
                          <MessageSquare
                            aria-hidden="true"
                            className={cn(
                              'h-4 w-4 shrink-0',
                              isSelected ? 'text-primary' : 'text-muted-foreground',
                            )}
                          />
                          <span className="min-w-0 flex-1">
                            <span
                              className={cn(
                                'block truncate text-sm font-medium',
                                !chat.title?.trim() && 'text-muted-foreground',
                              )}
                            >
                              {chatLabel(chat)}
                            </span>
                            <span className="block truncate text-xs text-muted-foreground">
                              {formatDateTime(chat.updated_at) || 'No activity yet'}
                            </span>
                          </span>
                        </button>
                        <div className="mr-1.5 flex flex-shrink-0 items-center gap-0.5 opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100">
                          <Button
                            variant="ghost"
                            size="icon-xs"
                            onClick={() => {
                              setRenamingId(chat.chat_id);
                              setRenameValue(chat.title ?? '');
                            }}
                            aria-label={`Rename ${chatLabel(chat)}`}
                          >
                            <Pencil className="h-3.5 w-3.5" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon-xs"
                            className="text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                            onClick={() => onDelete(chat)}
                            aria-label={`Delete ${chatLabel(chat)}`}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      </>
                    )}
                  </div>
                </li>
              );
            })}
        </ul>

        {!loading && listError && (
          <div
            role={listError.preparing ? 'status' : 'alert'}
            className={cn(
              'rounded-lg border p-3 text-center',
              listError.preparing
                ? 'border-border bg-muted/40'
                : 'border-destructive/40 bg-destructive/10',
            )}
          >
            <p
              className={cn(
                'flex items-center justify-center gap-1.5 text-sm font-medium',
                listError.preparing ? 'text-foreground' : 'text-destructive',
              )}
            >
              {/* A spinner here used to advertise a background poll. Nothing
                  is running now — this state waits for the author. */}
              {listError.preparing ? (
                <Clock aria-hidden="true" className="h-3.5 w-3.5" />
              ) : (
                <AlertCircle aria-hidden="true" className="h-3.5 w-3.5" />
              )}
              {listError.preparing ? 'Getting your chats ready' : 'Could not load chats'}
            </p>
            <p className="mt-1 break-words text-xs text-muted-foreground">{listError.message}</p>
            <Button variant="outline" size="sm" className="mt-2" onClick={reload}>
              Retry
            </Button>
          </div>
        )}

        {!loading && !listError && items.length === 0 && (
          <EmptyState
            icon={MessageSquare}
            title="No chats yet"
            description="Start a conversation to keep a history of your assistant sessions."
          />
        )}

        {!loading && items.length > 0 && filtered.length === 0 && (
          <EmptyState icon={MessageSquare} title="No matches" description="Try a different filter." />
        )}
      </div>

      {totalPages > 1 && (
        <div className="flex flex-shrink-0 items-center justify-between border-t border-border pt-2">
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={page <= 1 || loading}
            aria-label="Previous page"
          >
            <ChevronLeft className="h-3.5 w-3.5" />
          </Button>
          <span className="text-2xs tabular-nums text-muted-foreground">
            {Math.min(count, (page - 1) * PAGE_SIZE + 1)}–{Math.min(page * PAGE_SIZE, count)} of {count}
          </span>
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            disabled={page >= totalPages || loading}
            aria-label="Next page"
          >
            <ChevronRight className="h-3.5 w-3.5" />
          </Button>
        </div>
      )}
    </div>
  );
}
