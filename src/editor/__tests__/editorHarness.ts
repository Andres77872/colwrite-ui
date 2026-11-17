import { createElement, useMemo, type Context, type ReactNode } from 'react';
import { TestWorkspace } from '@/__tests__/workspace';
import {
  DocumentActionsContext,
  DocumentSessionContext,
  DocumentStatusContext,
  EditorDocContext,
  useDocumentActions,
  useDocumentSession,
  useDocumentStatus,
  useEditorDoc,
  type DocumentActionsValue,
  type DocumentSessionValue,
  type DocumentStatusValue,
  type EditorDocValue,
} from '../documentSessionState';
import {
  EditorActionsContext,
  EditorActiveBlockContext,
  EditorViewContext,
  useActiveBlock,
  useEditorActions,
  useEditorView,
  type EditorActionsContextValue,
  type EditorActiveBlockContextValue,
  type EditorViewValue,
} from '../editorContextState';

/** Every slice the editor exposes, side by side. Test-only. */
export type EditorProbe = EditorDocValue
  & DocumentSessionValue
  & DocumentStatusValue
  & DocumentActionsValue
  & EditorActionsContextValue
  & EditorViewValue
  & EditorActiveBlockContextValue;

/**
 * One handle on the whole editor, for tests that drive the real
 * `EditorProvider` and assert on what any slice shows. App code subscribes
 * through the selector hooks, each to its own slice.
 */
export function useEditorProbe(): EditorProbe {
  const doc = useEditorDoc();
  const session = useDocumentSession();
  const status = useDocumentStatus();
  const documentActions = useDocumentActions();
  const editorActions = useEditorActions();
  const view = useEditorView();
  const active = useActiveBlock();
  return useMemo(
    () => ({ ...doc, ...session, ...status, ...documentActions, ...editorActions, ...view, ...active }),
    [doc, session, status, documentActions, editorActions, view, active],
  );
}

const EDITOR_CONTEXTS = [
  DocumentActionsContext,
  DocumentSessionContext,
  DocumentStatusContext,
  EditorDocContext,
  EditorActionsContext,
  EditorViewContext,
  EditorActiveBlockContext,
] as unknown as ReadonlyArray<Context<unknown>>;

/**
 * Feed one fake into every editor context, in the test workspace, for tests
 * that render a consumer without the real provider. Only the fields the
 * consumer reads need to be there.
 */
export function FakeEditorProviders({
  value,
  children,
}: {
  value: Partial<EditorProbe>;
  children: ReactNode;
}): ReactNode {
  return createElement(TestWorkspace, {
    children: EDITOR_CONTEXTS.reduceRight<ReactNode>(
      (inner, context) => createElement(context.Provider, { value }, inner),
      children,
    ),
  });
}
