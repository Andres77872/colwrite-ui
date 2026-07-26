import { createContext, useContext } from 'react';

export type ChatSessionsValue = {
  selectedChatId: string | null;
  selectedThreadId: number | null;
  setSelectedChatId: (id: string | null) => void;
  setSelectedThreadId: (id: number | null) => void;
};

export const ChatSessionsContext = createContext<ChatSessionsValue | null>(null);

export function useChatSessions(): ChatSessionsValue {
  const context = useContext(ChatSessionsContext);
  if (!context) throw new Error('useChatSessions must be used within ChatSessionsProvider');
  return context;
}
