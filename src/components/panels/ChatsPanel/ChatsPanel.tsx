import { useMemo, useState } from 'react';
import type { ChatItem } from '@/services/chats';
import { useChatSessions } from '@/components/chat/chatSessionsState';
import { cn } from '@/lib/utils';
import { formatDateTime } from '@/lib/text';
import { Button } from '@/components/ui/button';
import { Skeleton, Spinner } from '@/components/ui/spinner';
import { menuItem, menuLabel } from '@/components/ui/menuStyles';
import {
  AlertCircle,
  Check,
  ChevronLeft,
  ChevronRight,
  Clock,
  MessageSquare,
  Pencil,
  Plus,
  Search,
  Trash2,
} from 'lucide-react';
import { CHATS_PAGE_SIZE, chatLabel, type ChatHistory } from './useChatHistory';

/** "now", "5m", "3h", "Yesterday", "Sep 20" — the list has room for one word. */
function relativeTime(value: string | null): string {
  if (!value) return '';
  const then = new Date(value);
  const ms = Date.now() - then.getTime();
  if (Number.isNaN(ms)) return '';
  const minutes = Math.round(ms / 60_000);
  if (minutes < 1) return 'now';
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h`;
  if (hours < 48) return 'Yesterday';
  return then.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

/** A thumb-sized rename/delete where there is no hover to reveal them. */
const TOUCH_ACTION = '[@media(hover:none)]:h-9 [@media(hover:none)]:w-9 [@media(hover:none)]:[&_svg]:size-4';

type ChatsPanelProps = {
  /** The list, loaded by whoever shows the conversation (`useChatHistory`). */
  history: ChatHistory;
  onNewChat: () => void;
  onSelect: (chat: ChatItem) => void;
  /** Told after a conversation is deleted. */
  onDeleted?: (chat: ChatItem) => void;
  className?: string;
};

/**
 * The document's conversations: search, pick, rename, delete, start another.
 *
 * The list inside the assistant's chat switcher. Rows are quiet menu rows —
 * title, a one-word time, and rename/delete on hover or focus. Touch screens
 * have no hover, so there rename/delete are always shown instead of the time.
 */
export function ChatsPanel({ history: chats, onNewChat, onSelect, onDeleted, className }: ChatsPanelProps) {
  const { selectedChatId } = useChatSessions();

  const [query, setQuery] = useState('');
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');

  const { items, loading, listError, page, totalPages, count } = chats;

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return items;
    return items.filter(
      (c) => (c.title ?? '').toLowerCase().includes(q) || c.chat_id.includes(q),
    );
  }, [items, query]);

  function commitRename(chatId: string) {
    if (renamingId !== chatId) return;
    const next = renameValue;
    setRenamingId(null);
    setRenameValue('');
    void chats.rename(chatId, next);
  }

  const showSkeleton = loading && items.length === 0;

  return (
    <div className={cn('flex min-h-0 flex-col', className)} aria-busy={loading}>
      <div className="flex items-center gap-2 border-b border-border px-3">
        <Search aria-hidden="true" className="h-4 w-4 shrink-0 text-muted-foreground" />
        <input
          type="search"
          className="h-10 min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-placeholder"
          placeholder="Search chats…"
          aria-label="Search chats"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
        {loading && <Spinner className="h-3.5 w-3.5 text-muted-foreground" />}
      </div>

      {/* The scroll region is the wrapper, not the list: the error and empty
          states are not list items, and hanging them off `<ul>` would put
          non-`<li>` children in a list. */}
      <div className="min-h-0 flex-1 overflow-y-auto p-1.5">
        <button type="button" className={cn(menuItem, 'w-full text-left')} onClick={onNewChat}>
          <Plus aria-hidden="true" />
          New chat
        </button>

        {chats.documentId && (items.length > 0 || showSkeleton) && (
          <p className={menuLabel}>Recent</p>
        )}

        <ul>
          {showSkeleton &&
            Array.from({ length: 3 }).map((_, index) => (
              <li key={index} className="flex h-8 items-center gap-2 px-2">
                <Skeleton className="h-3.5 w-3.5 rounded-sm" />
                <Skeleton className="h-3 flex-1" />
              </li>
            ))}

          {!showSkeleton &&
            filtered.map((chat) => {
              const isSelected = chat.chat_id === selectedChatId;
              const isRenaming = renamingId === chat.chat_id;
              const label = chatLabel(chat);

              if (isRenaming) {
                return (
                  <li key={chat.chat_id} className="flex items-center gap-1 px-1 py-0.5">
                    <input
                      autoFocus
                      className="h-7 min-w-0 flex-1 rounded-md bg-subtle px-2 text-sm outline-none ring-1 ring-inset ring-border-strong focus:ring-2 focus:ring-primary"
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
                          setRenamingId(null);
                          setRenameValue('');
                        }
                      }}
                      onBlur={() => commitRename(chat.chat_id)}
                    />
                    <Button
                      variant="icon"
                      size="icon-xs"
                      // Without this, blur fires first and commits the rename
                      // before the click ever reaches the button.
                      onMouseDown={(event) => event.preventDefault()}
                      onClick={() => commitRename(chat.chat_id)}
                      aria-label="Save chat title"
                    >
                      <Check />
                    </Button>
                  </li>
                );
              }

              return (
                <li
                  key={chat.chat_id}
                  className={cn(
                    'group relative flex items-center rounded-md transition-colors duration-120',
                    isSelected ? 'bg-active' : 'hover:bg-hover',
                  )}
                >
                  <button
                    type="button"
                    onClick={() => onSelect(chat)}
                    aria-current={isSelected ? 'true' : undefined}
                    title={formatDateTime(chat.updated_at) || undefined}
                    className={cn(
                      'flex min-h-8 min-w-0 flex-1 items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring',
                      // Touch has no hover: the actions stay shown in place of
                      // the date, so the title stops short of them.
                      '[@media(hover:none)]:min-h-11 [@media(hover:none)]:pr-20',
                    )}
                  >
                    <MessageSquare aria-hidden="true" className="h-4 w-4 shrink-0 text-muted-foreground" />
                    <span className={cn('min-w-0 flex-1 truncate', !chat.title?.trim() && 'text-muted-foreground')}>
                      {label}
                    </span>
                    <span className="shrink-0 text-xs text-muted-foreground tabular-nums group-focus-within:invisible group-hover:invisible [@media(hover:none)]:hidden">
                      {relativeTime(chat.updated_at)}
                    </span>
                  </button>
                  <div className="absolute right-1 flex items-center gap-0.5 opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100 [@media(hover:none)]:opacity-100">
                    <Button
                      variant="icon"
                      size="icon-xs"
                      className={TOUCH_ACTION}
                      onClick={() => {
                        setRenamingId(chat.chat_id);
                        setRenameValue(chat.title ?? '');
                      }}
                      aria-label={`Rename ${label}`}
                    >
                      <Pencil />
                    </Button>
                    <Button
                      variant="icon"
                      size="icon-xs"
                      className={cn(TOUCH_ACTION, 'hover:bg-destructive/10 hover:text-destructive')}
                      onClick={async () => {
                        if (await chats.remove(chat)) onDeleted?.(chat);
                      }}
                      aria-label={`Delete ${label}`}
                    >
                      <Trash2 />
                    </Button>
                  </div>
                </li>
              );
            })}
        </ul>

        {!loading && listError && (
          <div role={listError.preparing ? 'status' : 'alert'} className="px-2 py-3 text-center">
            <p
              className={cn(
                'flex items-center justify-center gap-1.5 text-sm font-medium',
                listError.preparing ? 'text-foreground' : 'text-destructive',
              )}
            >
              {/* Nothing is polling behind the author's back — this state
                  waits for them. */}
              {listError.preparing ? (
                <Clock aria-hidden="true" className="h-3.5 w-3.5" />
              ) : (
                <AlertCircle aria-hidden="true" className="h-3.5 w-3.5" />
              )}
              {listError.preparing ? 'Getting your chats ready' : 'Could not load chats'}
            </p>
            <p className="mt-1 break-words text-xs text-muted-foreground">{listError.message}</p>
            <Button variant="outline" size="xs" className="mt-2" onClick={chats.reload}>
              Retry
            </Button>
          </div>
        )}

        {chats.documentId && !loading && !listError && items.length === 0 && (
          <p className="px-2 py-3 text-center text-xs text-muted-foreground">
            No chats yet. Conversations about this document are kept here.
          </p>
        )}

        {!chats.documentId && (
          <p className="px-2 py-3 text-center text-xs text-muted-foreground">
            A conversation is kept with a document. Asking saves this document first.
          </p>
        )}

        {!loading && items.length > 0 && filtered.length === 0 && (
          <p className="px-2 py-3 text-center text-xs text-muted-foreground">No chats match.</p>
        )}
      </div>

      {totalPages > 1 && (
        <div className="flex flex-shrink-0 items-center justify-between border-t border-border px-1.5 py-1">
          <Button
            variant="icon"
            size="icon-xs"
            onClick={() => chats.setPage(Math.max(1, page - 1))}
            disabled={page <= 1 || loading}
            aria-label="Previous page"
          >
            <ChevronLeft />
          </Button>
          <span className="text-xs tabular-nums text-muted-foreground">
            {Math.min(count, (page - 1) * CHATS_PAGE_SIZE + 1)}–{Math.min(page * CHATS_PAGE_SIZE, count)} of {count}
          </span>
          <Button
            variant="icon"
            size="icon-xs"
            onClick={() => chats.setPage(Math.min(totalPages, page + 1))}
            disabled={page >= totalPages || loading}
            aria-label="Next page"
          >
            <ChevronRight />
          </Button>
        </div>
      )}
    </div>
  );
}
