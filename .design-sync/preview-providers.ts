// Extra bundle exports for preview composition only.
//
// AppShell, Sidebar and Topbar read app context (`usePanels`, `useView`,
// `useAuth`, `useEditor`) and throw outright without their providers. A preview
// cannot import those providers from `src/` directly: the preview bundler would
// compile a SECOND copy of each context module, whose React context instance is
// a different object from the one the components inside `_ds_bundle.js` read
// from — the provider would render and the consumer would still throw.
//
// Re-exporting them here and listing this file in `cfg.extraEntries` puts them
// on `window.ColwriteUI` alongside the components, so a preview can
// `import { PanelsProvider } from 'colwrite-ui'` and get the same module
// instance the components use.
//
// Both the real providers and the raw contexts are exported. The real providers
// are right where they work offline (`PanelsProvider` derives its state from
// `matchMedia` and needs nothing else). The raw contexts are for the two cases
// where the real provider cannot reach a rendered state in a static capture:
// `AuthProvider` only ever sets a user after confirming a cached identity
// against the server, and `Topbar` returns `null` while `user` is null — so its
// preview supplies a literal context value instead, the same way a Storybook
// decorator would.
//
// These are NOT design-system components: they are absent from the types barrel
// (`ds-pkg/types/index.d.ts`), so the converter never discovers them as
// components and they get no card, no .d.ts and no doc — they are bundle
// exports and nothing more.

import { createElement, type ReactNode } from 'react';
import type { AgentToolsContextValue } from '../src/components/preferences/agentToolsContextState';
import {
  EditorActionsContext,
  EditorActiveBlockContext,
  EditorContext as EditorStateContext,
  type EditorActionsContextValue,
  type EditorStateContextValue,
} from '../src/editor/editorContextState';

export { PanelsProvider } from '../src/components/panels';
export { ViewProvider } from '../src/components/layout/ViewContext';
export { AuthProvider } from '../src/components/auth/AuthContext';
export { EditorProvider } from '../src/editor';

export { ProposalsProvider } from '../src/editor/ProposalsContext';
export { ChatSessionsProvider } from '../src/components/chat/ChatSessionsContext';

export { PanelsContext } from '../src/components/panels/panelsContextState';
export { ViewContext } from '../src/components/layout/viewContextState';
export { AuthContext } from '../src/components/auth/authContextState';
// The editor surface needs these two the way Topbar needed AuthContext: a
// preview must be able to hand a component a document, a pending proposal or a
// chat session outright, since none of that state is reachable offline.
export { EditorContext } from '../src/editor/editorContextState';
// The editor now publishes three contexts — state (`useEditorState`), actions
// (`useEditorActions`) and the active block (`useActiveBlock`) — so an
// editable re-renders on focus moves without re-rendering on every keystroke.
// A preview that supplied only `EditorContext` stopped rendering anything
// under an `Editable`, a `CodeEditable` or a paragraph: the other two hooks
// throw without their provider. `LiteralEditor` hands one literal value to all
// three; every editor preview goes through it.
export { EditorActionsContext, EditorActiveBlockContext } from '../src/editor/editorContextState';

const noop = () => {};

/**
 * One literal editor for a preview — the state, the actions and the active
 * block, from a single object. `value` is the same partial, cast literal the
 * previews always built (see NOTES.md "Editor previews"); `activeId` is which
 * block, if any, reads as focused.
 */
export function LiteralEditor({
  value,
  activeId = null,
  children,
}: {
  value: unknown;
  activeId?: string | null;
  children?: ReactNode;
}) {
  return createElement(
    EditorStateContext.Provider,
    { value: value as EditorStateContextValue },
    createElement(
      EditorActionsContext.Provider,
      { value: value as EditorActionsContextValue },
      createElement(EditorActiveBlockContext.Provider, { value: { activeId, setActive: noop } }, children),
    ),
  );
}
// Citation numbering is a property of the whole document, so `CitationInline`
// reads the bibliography rather than counting for itself. A preview supplying a
// literal `EditorContext` gets no bibliography with it — the real one is built
// by `EditorProvider` — and every pill would render `[?]`. Exporting the
// context and the builder lets a preview derive the real thing from the same
// blocks it already declares, so what a card shows is what the widget prints.
export { BibliographyContext } from '../src/editor/bibliographyContextState';
export { buildBibliography } from '../src/editor/citations';
export { ProposalsContext } from '../src/editor/proposalsContextState';
export { ChatSessionsContext } from '../src/components/chat/chatSessionsState';
export { AgentToolsContext } from '../src/components/preferences/agentToolsContextState';

// ── Agent-tool capability fixture ────────────────────────────────────────
// `AgentToolsProvider` GETs /users/me/agent-tools on mount and FAILS CLOSED
// until the server answers, so under a static capture every gated affordance
// disappears: AIActionMenu drops each `agent_tool` action (the menu empties
// and the whole toolbar renders nothing) and CitationInline hides its arXiv
// and Semantic Scholar lookups. Mounting the real provider would therefore
// both fire a failing request and photograph the degraded state.
//
// This is the same treatment `EditorContext` gets, for the same reason: one
// literal value, no network, deterministic across syncs. Four components read
// it (AIActionMenu, FloatingToolbar via AIActionMenu, CitationInline, and
// ParagraphBlock via CitationInline) and between them touch only
// `isToolEnabled`, `isSourceEnabled` and `loading` — so, exactly as with
// `EditorContextValue`'s ~50 members, the rest is a cast rather than an
// invented copy of an API payload that would silently rot.
//
// It represents an account with every capability switched on, which is the
// state worth showing on a card: the full menu, all reference sources.
export const agentToolsAllEnabled = {
  settings: null,
  loading: false,
  loaded: true,
  error: null,
  isToolEnabled: () => true,
  isSourceEnabled: () => true,
} as unknown as AgentToolsContextValue;

// ── Gaps in the ui barrel ────────────────────────────────────────────────
// These are all real, shipped `src/components/ui` code that
// `src/components/ui/index.ts` simply never re-exports, so they are absent from
// the bundle and unreachable to a design. Two of them are load-bearing:
// `ToastProvider` and `ConfirmProvider` are USELESS without their hooks, since
// the hook is the only way to raise a toast or ask for confirmation.
//
// The right long-term fix is one line each in `src/components/ui/index.ts`
// (see NOTES.md). Re-exported here so the uploaded design system is actually
// usable in the meantime — this ships the repo's own code, nothing new.
export { useToast } from '../src/components/ui/toastContext';
export { useConfirm } from '../src/components/ui/confirmContext';
// Parity with the already-exported `alertVariants`. These are the class recipes
// the app itself uses to render a badge-looking <span> in flow content
// (`ExtractionBadge`, `CollectionAttachmentLabel`) — `Badge` is a <div> and so
// cannot sit inside a <p>.
export { badgeVariants } from '../src/components/ui/badgeVariants';
export { buttonVariants } from '../src/components/ui/buttonVariants';
