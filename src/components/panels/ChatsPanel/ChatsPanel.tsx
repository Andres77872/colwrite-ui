import { useEffect, useMemo, useState } from 'react';
import { useEditor } from '../../../editor';
import { createChat, deleteChat, listChats, updateChatTitle, type ChatItem } from '../../../services/chats';
import { useChatSessions } from '../../chat/ChatSessionsContext';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

function Title({ chat }: { chat: ChatItem }) {
  const title = (chat.title || '').trim();
  if (title) return <span>{title}</span>;
  const idTail = chat.chat_id.slice(0, 8);
  return <span className="text-muted-foreground">Untitled chat · {idTail}</span>;
}

export function ChatsPanel() {
  const { documentId } = useEditor();
  const { selectedChatId, setSelectedChatId, setSelectedThreadId } = useChatSessions();
  const [items, setItems] = useState<ChatItem[]>([]);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState<string>('');
  const [page, setPage] = useState<number>(1);
  const limit = 10;
  const [count, setCount] = useState<number>(0);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState<string>('');

  const canPaginate = useMemo(() => ({
    prev: page > 1,
    next: page * limit < count,
  }), [page, limit, count]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return items;
    return items.filter(c => (c.title || '').toLowerCase().includes(q) || c.chat_id.includes(q));
  }, [items, query]);

  useEffect(() => {
    if (!documentId) { setItems([]); setCount(0); return; }
    let cancelled = false;
    async function run() {
      try {
        setLoading(true);
        setError(null);
        const offset = (page - 1) * limit;
        const res = await listChats(documentId!, limit, offset);
        if (cancelled) return;
        setItems(res.chats || []);
        setCount(res.count || 0);
      } catch (e: any) {
        if (cancelled) return;
        setError(e?.message || 'Failed to load chats');
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    run();
    return () => { cancelled = true; };
  }, [documentId, page, limit]);

  async function onCreate() {
    if (!documentId) return;
    try {
      setLoading(true);
      const res = await createChat(documentId);
      await refresh();
      setSelectedChatId(res.chat_id);
    } catch (e: any) {
      setError(e?.message || 'Failed to create chat');
    } finally {
      setLoading(false);
    }
  }

  async function onDelete(id: string) {
    if (!documentId) return;
    const ok = window.confirm('Delete this chat? This cannot be undone.');
    if (!ok) return;
    try {
      setLoading(true);
      await deleteChat(documentId, id);
      if (selectedChatId === id) setSelectedChatId(null);
      await refresh();
    } catch (e: any) {
      setError(e?.message || 'Failed to delete chat');
    } finally {
      setLoading(false);
    }
  }

  function startRename(chat: ChatItem) {
    setRenamingId(chat.chat_id);
    setRenameValue(chat.title || '');
  }

  async function commitRename(chatId: string) {
    if (!documentId) return;
    try {
      setLoading(true);
      await updateChatTitle(documentId, chatId, renameValue.trim() || '');
      setRenamingId(null);
      setRenameValue('');
      await refresh();
    } catch (e: any) {
      setError(e?.message || 'Failed to rename chat');
    } finally {
      setLoading(false);
    }
  }

  async function refresh() {
    if (!documentId) return;
    try {
      const res = await listChats(documentId, limit, (page - 1) * limit);
      setItems(res.chats || []);
      setCount(res.count || 0);
    } catch {}
  }

  return (
    <div className="flex flex-col gap-3 h-full" aria-busy={loading}>
      {/* Actions */}
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs text-muted-foreground">
          {documentId ? (loading ? 'Loading…' : `${count} total`) : 'Save document first'}
        </span>
        <div className="flex items-center gap-1.5">
          <Button variant="ghost" size="sm" onClick={() => refresh()} disabled={loading || !documentId}>
            Refresh
          </Button>
          <Button size="sm" onClick={onCreate} disabled={loading || !documentId}>
            New Chat
          </Button>
        </div>
      </div>

      <form className="flex items-center gap-2" onSubmit={(e) => e.preventDefault()}>
        <Input
          className="flex-1"
          placeholder="Search chats..."
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          disabled={loading}
        />
        {query && (
          <Button variant="outline" size="sm" onClick={() => setQuery('')} type="button">Clear</Button>
        )}
      </form>

      {error && <div className="text-sm text-destructive" role="alert" aria-live="polite">{error}</div>}

      <div className="space-y-2 overflow-auto" role="list">
        {filtered.map((c) => {
          const isSelected = c.chat_id === selectedChatId;
          const isRenaming = renamingId === c.chat_id;
          return (
            <div
              key={c.chat_id}
              role="listitem"
              className={cn(
                "flex items-center gap-3 p-3 rounded-lg border cursor-pointer transition-colors",
                isSelected ? "bg-primary/10 border-primary" : "bg-card border-border hover:bg-accent"
              )}
              aria-selected={isSelected}
              tabIndex={0}
              onClick={() => { setSelectedChatId(c.chat_id); setSelectedThreadId(typeof c.last_thread_id === 'number' ? c.last_thread_id : null); }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  setSelectedChatId(c.chat_id);
                  setSelectedThreadId(typeof c.last_thread_id === 'number' ? c.last_thread_id : null);
                }
              }}
            >
              <div className="text-lg">💬</div>
              <div className="flex-1 min-w-0">
                {!isRenaming ? (
                  <div className="text-sm font-medium truncate"><Title chat={c} /></div>
                ) : (
                  <Input
                    className="h-7 text-sm"
                    value={renameValue}
                    onChange={(e) => setRenameValue(e.target.value)}
                    onClick={(e) => e.stopPropagation()}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') { e.preventDefault(); commitRename(c.chat_id); }
                      if (e.key === 'Escape') { e.preventDefault(); setRenamingId(null); setRenameValue(''); }
                    }}
                    onBlur={() => { if (renamingId === c.chat_id) commitRename(c.chat_id); }}
                  />
                )}
                <div className="text-xs text-muted-foreground">
                  {c.updated_at ? new Date(c.updated_at).toLocaleString() : '—'}
                  {typeof c.last_thread_id === 'number' ? ` · thread #${c.last_thread_id}` : ''}
                </div>
              </div>
              <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
                {!isRenaming ? (
                  <>
                    <Button variant="ghost" size="sm" onClick={() => startRename(c)}>Rename</Button>
                    <Button variant="destructive" size="sm" onClick={() => onDelete(c.chat_id)}>Delete</Button>
                  </>
                ) : (
                  <>
                    <Button size="sm" onClick={() => commitRename(c.chat_id)}>Save</Button>
                    <Button variant="outline" size="sm" onClick={() => { setRenamingId(null); setRenameValue(''); }}>Cancel</Button>
                  </>
                )}
              </div>
            </div>
          );
        })}

        {documentId && !loading && !items.length && (
          <div className="text-center py-8">
            <div className="text-3xl mb-2">💬</div>
            <div className="font-medium">No chats yet</div>
            <div className="text-sm text-muted-foreground">Start a new session to keep a history of your assistant conversations.</div>
          </div>
        )}

        {!documentId && (
          <div className="text-center py-8">
            <div className="text-3xl mb-2">💾</div>
            <div className="font-medium">No document ID</div>
            <div className="text-sm text-muted-foreground">Create or save your document to enable chats.</div>
          </div>
        )}
      </div>

      <div className="flex items-center justify-between pt-2 border-t border-border">
        <div className="text-xs text-muted-foreground">
          {count ? `${Math.min(count, (page-1)*limit+1)}–${Math.min(page*limit, count)} of ${count}` : '—'}
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => setPage(p => Math.max(1, p-1))} disabled={!canPaginate.prev}>Prev</Button>
          <Button variant="outline" size="sm" onClick={() => setPage(p => p+1)} disabled={!canPaginate.next}>Next</Button>
        </div>
      </div>
    </div>
  );
}
