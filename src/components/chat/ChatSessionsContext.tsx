import { useCallback, useMemo, useState } from 'react';
import { useEditor } from '../../editor';
import { ChatSessionsContext, type ChatSessionsValue } from './chatSessionsState';
export type { ChatSessionsValue } from './chatSessionsState';

function keyForDoc(docId: string | null): string | null {
  if (!docId) return null;
  return `colwrite:chat:selected:${docId}`;
}

export function ChatSessionsProvider({ children }: { children: React.ReactNode }) {
  const { documentId } = useEditor();
  return (
    <ChatSessionsState key={documentId ?? 'local'} documentId={documentId}>
      {children}
    </ChatSessionsState>
  );
}

function readSelectedChat(documentId: string | null): string | null {
  try {
    const key = keyForDoc(documentId);
    return key ? localStorage.getItem(key) || null : null;
  } catch {
    return null;
  }
}

function ChatSessionsState({
  children,
  documentId,
}: {
  children: React.ReactNode;
  documentId: string | null;
}) {
  const [selectedChatId, _setSelectedChatId] = useState<string | null>(
    () => readSelectedChat(documentId),
  );
  const [selectedThreadId, _setSelectedThreadId] = useState<number | null>(null);

  const setSelectedChatId = useCallback((id: string | null) => {
    _setSelectedChatId(id);
    try {
      const key = keyForDoc(documentId);
      if (!key) return;
      if (id) localStorage.setItem(key, id); else localStorage.removeItem(key);
    } catch { /* persisted selection is optional */ }
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
