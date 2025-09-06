import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { useEditor } from '../../editor';

export type ChatSessionsValue = {
  selectedChatId: string | null;
  selectedThreadId: number | null;
  setSelectedChatId: (id: string | null) => void;
  setSelectedThreadId: (id: number | null) => void;
};

const ChatSessionsContext = createContext<ChatSessionsValue | null>(null);

function keyForDoc(docId: string | null): string | null {
  if (!docId) return null;
  return `colwrite:chat:selected:${docId}`;
}

export function ChatSessionsProvider({ children }: { children: React.ReactNode }) {
  const { documentId } = useEditor();
  const [selectedChatId, _setSelectedChatId] = useState<string | null>(null);
  const [selectedThreadId, _setSelectedThreadId] = useState<number | null>(null);

  // Load persisted selection for current document
  useEffect(() => {
    try {
      const key = keyForDoc(documentId);
      if (!key) { _setSelectedChatId(null); _setSelectedThreadId(null); return; }
      const raw = localStorage.getItem(key);
      _setSelectedChatId(raw || null);
      _setSelectedThreadId(null);
    } catch {
      _setSelectedChatId(null);
      _setSelectedThreadId(null);
    }
  }, [documentId]);

  const setSelectedChatId = useCallback((id: string | null) => {
    _setSelectedChatId(id);
    try {
      const key = keyForDoc(documentId);
      if (!key) return;
      if (id) localStorage.setItem(key, id); else localStorage.removeItem(key);
    } catch {}
  }, [documentId]);

  const setSelectedThreadId = useCallback((id: number | null) => {
    _setSelectedThreadId(id);
  }, []);

  const value = useMemo<ChatSessionsValue>(() => ({
    selectedChatId,
    selectedThreadId,
    setSelectedChatId,
    setSelectedThreadId,
  }), [selectedChatId, selectedThreadId, setSelectedChatId, setSelectedThreadId]);

  return <ChatSessionsContext.Provider value={value}>{children}</ChatSessionsContext.Provider>;
}

export function useChatSessions(): ChatSessionsValue {
  const ctx = useContext(ChatSessionsContext);
  if (!ctx) throw new Error('useChatSessions must be used within ChatSessionsProvider');
  return ctx;
}
