export const DOCUMENT_TRANSITION_START_EVENT = 'colwrite:document-transition-start';

/** Sent synchronously, before React makes the committed workspace inert. */
export function emitDocumentTransitionStart(): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new Event(DOCUMENT_TRANSITION_START_EVENT));
}
