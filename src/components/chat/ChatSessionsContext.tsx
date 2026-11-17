import {
  useCallback,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { chatSelectionKey, readItem, removeItem, writeItem } from '@/lib/storageKeys';
import { useDocumentId } from '../../editor';
import { useWorkspaceId } from '@/components/workspace/workspaceContextState';
import { ChatSessionsContext, type ChatSessionsValue } from './chatSessionsState';
export type { ChatSessionsValue } from './chatSessionsState';

type DocumentChatState = {
  documentId: string | null;
  selectedChatId: string | null;
  selectedLeafId: number | null;
};

function readSelectedChat(workspaceId: string, documentId: string | null): string | null {
  return documentId ? readItem(chatSelectionKey(workspaceId, documentId)) || null : null;
}

function stateForDocument(workspaceId: string, documentId: string | null): DocumentChatState {
  return {
    documentId,
    selectedChatId: readSelectedChat(workspaceId, documentId),
    selectedLeafId: null,
  };
}

export function ChatSessionsProvider({ children }: { children: React.ReactNode }) {
  const documentId = useDocumentId();
  const workspaceId = useWorkspaceId();
  const ownerDocumentId = documentId;
  const activeDocumentIdRef = useRef(ownerDocumentId);

  const resetState = useMemo(() => stateForDocument(workspaceId, ownerDocumentId), [ownerDocumentId, workspaceId]);
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
        : stateForDocument(workspaceId, ownerDocumentId);
      return { ...owned, selectedChatId: id };
    });

    if (!ownerDocumentId) return;
    // The persisted selection is optional; a refused write changes nothing.
    if (id) writeItem(chatSelectionKey(workspaceId, ownerDocumentId), id);
    else removeItem(chatSelectionKey(workspaceId, ownerDocumentId));
  }, [ownerDocumentId, workspaceId]);

  const setSelectedLeafId = useCallback((id: number | null) => {
    if (activeDocumentIdRef.current !== ownerDocumentId) return;
    setStoredState((current) => {
      if (activeDocumentIdRef.current !== ownerDocumentId) return current;
      const owned = current.documentId === ownerDocumentId
        ? current
        : stateForDocument(workspaceId, ownerDocumentId);
      return { ...owned, selectedLeafId: id };
    });
  }, [ownerDocumentId, workspaceId]);

  const value = useMemo<ChatSessionsValue>(() => ({
    selectedChatId: state.selectedChatId,
    selectedLeafId: state.selectedLeafId,
    setSelectedChatId,
    setSelectedLeafId,
  }), [state, setSelectedChatId, setSelectedLeafId]);

  return <ChatSessionsContext.Provider value={value}>{children}</ChatSessionsContext.Provider>;
}
