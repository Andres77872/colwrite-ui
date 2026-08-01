import { useCallback, useEffect, useMemo, useState } from 'react';
import { useEditor } from '@/editor';
import { createChat, deleteChat, listChats, updateChatTitle, type ChatItem } from '@/services/chats';
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
  MessageSquare,
  Pencil,
  Plus,
  RefreshCw,
  Save,
  Trash2,
} from 'lucide-react';

const PAGE_SIZE = 10;

function chatLabel(chat: ChatItem): string {
  return chat.title?.trim() || `Untitled chat · ${chat.chat_id.slice(0, 8)}`;
}

export function ChatsPanel() {
  const { documentId, ensureRemoteDocument } = useEditor();
  const { selectedChatId, setSelectedChatId, setSelectedThreadId } = useChatSessions();
  const confirm = useConfirm();
  const { toast } = useToast();

  const [items, setItems] = useState<ChatItem[]>([]);
  const [loading, setLoading] = useState(false);
  // Background list loads report in place; toasts are reserved for actions the
  // user actually initiated (create, delete, rename).
  const [listError, setListError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(1);
  const [count, setCount] = useState(0);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');

  const totalPages = useMemo(() => Math.max(1, Math.ceil(count / PAGE_SIZE)), [count]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return items;
    return items.filter(
      (c) => (c.title ?? '').toLowerCase().includes(q) || c.chat_id.includes(q),
    );
  }, [items, query]);

  const refresh = useCallback(
    async (targetPage = page, forDocumentId: string | null = documentId) => {
      // The id is a parameter because creating the first chat can save the
      // document on the spot, and this callback still closes over the `null`
      // it was built with — refreshing against that emptied the list it had
      // just filled.
      if (!forDocumentId) {
        setItems([]);
        setCount(0);
        return;
      }
      setLoading(true);
      try {
        const res = await listChats(forDocumentId, PAGE_SIZE, (targetPage - 1) * PAGE_SIZE);
        setItems(res.chats ?? []);
        setCount(res.count ?? 0);
        setListError(null);
      } catch (error) {
        setListError(error instanceof Error ? error.message : 'Request failed');
        setItems([]);
        setCount(0);
      } finally {
        setLoading(false);
      }
    },
    [documentId, page],
  );

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!documentId) {
        setItems([]);
        setCount(0);
        return;
      }
      setLoading(true);
      try {
        const res = await listChats(documentId, PAGE_SIZE, (page - 1) * PAGE_SIZE);
        if (cancelled) return;
        setItems(res.chats ?? []);
        setCount(res.count ?? 0);
        setListError(null);
      } catch (error) {
        if (cancelled) return;
        setListError(error instanceof Error ? error.message : 'Request failed');
        setItems([]);
        setCount(0);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [documentId, page]);

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
      await refresh(page, attachedId);
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
      await refresh(nextPage);
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
      await refresh(page);
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
          onClick={() => refresh(page)}
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
            role="alert"
            className="rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-center"
          >
            <p className="flex items-center justify-center gap-1.5 text-sm font-medium text-destructive">
              <AlertCircle aria-hidden="true" className="h-3.5 w-3.5" />
              Could not load chats
            </p>
            <p className="mt-1 break-words text-xs text-muted-foreground">{listError}</p>
            <Button variant="outline" size="sm" className="mt-2" onClick={() => refresh(page)}>
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
