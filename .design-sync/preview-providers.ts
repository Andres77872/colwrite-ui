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

export { PanelsProvider } from '../src/components/panels';
export { ViewProvider } from '../src/components/layout/ViewContext';
export { AuthProvider } from '../src/components/auth/AuthContext';
export { EditorProvider } from '../src/editor';

export { PanelsContext } from '../src/components/panels/panelsContextState';
export { ViewContext } from '../src/components/layout/viewContextState';
export { AuthContext } from '../src/components/auth/authContextState';

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
