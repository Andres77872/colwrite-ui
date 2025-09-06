import { useEffect, useMemo, useState } from 'react';
import './ChatsPanel.css';
import { useEditor } from '../../../editor';
import { createChat, deleteChat, listChats, updateChatTitle, type ChatItem } from '../../../services/chats';
import { useChatSessions } from '../../chat/ChatSessionsContext';

function Title({ chat }: { chat: ChatItem }) {
  const title = (chat.title || '').trim();
  if (title) return <span>{title}</span>;
  const idTail = chat.chat_id.slice(0, 8);
  return <span className="muted">Untitled chat · {idTail}</span>;
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
    <div className="chats-panel" aria-busy={loading}>
      <div className="row" style={{ justifyContent: 'space-between', gap: 8, alignItems: 'center' }}>
        <strong>Chats</strong>
        <div className="row" style={{ gap: 8, alignItems: 'center' }}>
          <span className="muted">{documentId ? (loading ? 'Loading…' : `${count} total`) : 'Save your document to create chats'}</span>
          <button className="btn" onClick={() => refresh()} disabled={loading || !documentId}>Refresh</button>
          <button className="btn primary" onClick={onCreate} disabled={loading || !documentId}>New</button>
        </div>
      </div>

      <form className="search" onSubmit={(e) => e.preventDefault()}>
        <input
          className="input grow"
          placeholder="Search chats by title or id"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          disabled={loading}
        />
        {query && (
          <button className="btn" onClick={() => setQuery('')} type="button">Clear</button>
        )}
      </form>

      {error && <div className="error" role="alert" aria-live="polite">{error}</div>}

      <div className="list" role="list">
        {filtered.map((c) => {
          const isSelected = c.chat_id === selectedChatId;
          const isRenaming = renamingId === c.chat_id;
          return (
            <div
              key={c.chat_id}
              role="listitem"
              className={`item card${isSelected ? ' selected' : ''}`}
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
              <div className="item-icon">💬</div>
              <div className="item-main">
                {!isRenaming ? (
                  <div className="item-title"><Title chat={c} /></div>
                ) : (
                  <input
                    className="input"
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
                <div className="item-meta muted">
                  {c.updated_at ? new Date(c.updated_at).toLocaleString() : '—'}
                  {typeof c.last_thread_id === 'number' ? ` · thread #${c.last_thread_id}` : ''}
                </div>
              </div>
              <div className="item-actions">
                {!isRenaming ? (
                  <>
                    <button className="btn ghost" title="Rename chat" onClick={(e) => { e.stopPropagation(); startRename(c); }}>Rename</button>
                    <button className="btn danger" title="Delete chat" onClick={(e) => { e.stopPropagation(); onDelete(c.chat_id); }}>Delete</button>
                  </>
                ) : (
                  <>
                    <button className="btn primary" title="Save title" onClick={(e) => { e.stopPropagation(); commitRename(c.chat_id); }}>Save</button>
                    <button className="btn" title="Cancel" onClick={(e) => { e.stopPropagation(); setRenamingId(null); setRenameValue(''); }}>Cancel</button>
                  </>
                )}
              </div>
            </div>
          );
        })}

        {documentId && !loading && !items.length && (
          <div className="empty-state">
            <div className="empty-icon">💬</div>
            <div className="empty-title">No chats yet</div>
            <div className="empty-text muted">Start a new session to keep a history of your assistant conversations.</div>
          </div>
        )}

        {!documentId && (
          <div className="empty-state">
            <div className="empty-icon">💾</div>
            <div className="empty-title">No document ID</div>
            <div className="empty-text muted">Create or save your document to enable chats.</div>
          </div>
        )}
      </div>

      <div className="pager row" style={{ justifyContent: 'space-between' }}>
        <div className="muted">Page {count ? `${Math.min(count, (page-1)*limit+1)}–${Math.min(page*limit, count)} of ${count}` : '—'}</div>
        <div className="row" style={{ gap: 8 }}>
          <button className="btn" onClick={() => setPage(p => Math.max(1, p-1))} disabled={!canPaginate.prev}>Prev</button>
          <button className="btn" onClick={() => setPage(p => p+1)} disabled={!canPaginate.next}>Next</button>
        </div>
      </div>
    </div>
  );
}
