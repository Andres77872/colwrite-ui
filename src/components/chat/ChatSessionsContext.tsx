import {
  useCallback,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useEditor } from '../../editor';
import { ChatSessionsContext, type ChatSessionsValue } from './chatSessionsState';
export type { ChatSessionsValue } from './chatSessionsState';

type DocumentChatState = {
  documentId: string | null;
  selectedChatId: string | null;
  selectedThreadId: number | null;
};

function keyForDoc(docId: string | null): string | null {
  if (!docId) return null;
  return `colwrite:chat:selected:${docId}`;
}

function readSelectedChat(documentId: string | null): string | null {
  try {
    const key = keyForDoc(documentId);
    return key ? localStorage.getItem(key) || null : null;
  } catch {
    return null;
  }
}

function stateForDocument(documentId: string | null): DocumentChatState {
  return {
    documentId,
    selectedChatId: readSelectedChat(documentId),
    selectedThreadId: null,
  };
}

export function ChatSessionsProvider({ children }: { children: React.ReactNode }) {
  const { documentId } = useEditor();
  const ownerDocumentId = documentId;
  const activeDocumentIdRef = useRef(ownerDocumentId);

  const resetState = useMemo(() => stateForDocument(ownerDocumentId), [ownerDocumentId]);
  const [storedState, setStoredState] = useState<DocumentChatState>(() => resetState);
  const needsReset = storedState.documentId !== ownerDocumentId;
  if (needsReset) setStoredState(resetState);
  const state = needsReset ? resetState : storedState;

  // React resolves the conditional render-phase state replacement before
  // committing descendants, so the new document's persisted selection is
  // available immediately without remounting them.
  useLayoutEffect(() => {
    activeDocumentIdRef.current = ownerDocumentId;
  }, [ownerDocumentId]);

  const setSelectedChatId = useCallback((id: string | null) => {
    if (activeDocumentIdRef.current !== ownerDocumentId) return;
    setStoredState((current) => {
      if (activeDocumentIdRef.current !== ownerDocumentId) return current;
      const owned = current.documentId === ownerDocumentId
        ? current
        : stateForDocument(ownerDocumentId);
      return { ...owned, selectedChatId: id };
    });

    try {
      const key = keyForDoc(ownerDocumentId);
      if (!key) return;
      if (id) localStorage.setItem(key, id);
      else localStorage.removeItem(key);
    } catch {
      // Persisted selection is optional.
    }
  }, [ownerDocumentId]);

  const setSelectedThreadId = useCallback((id: number | null) => {
    if (activeDocumentIdRef.current !== ownerDocumentId) return;
    setStoredState((current) => {
      if (activeDocumentIdRef.current !== ownerDocumentId) return current;
      const owned = current.documentId === ownerDocumentId
        ? current
        : stateForDocument(ownerDocumentId);
      return { ...owned, selectedThreadId: id };
    });
  }, [ownerDocumentId]);

  const value = useMemo<ChatSessionsValue>(() => ({
    selectedChatId: state.selectedChatId,
    selectedThreadId: state.selectedThreadId,
    setSelectedChatId,
    setSelectedThreadId,
  }), [state, setSelectedChatId, setSelectedThreadId]);

  return <ChatSessionsContext.Provider value={value}>{children}</ChatSessionsContext.Provider>;
}
