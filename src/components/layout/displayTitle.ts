import { DEFAULT_DOCUMENT_TITLE } from '@/editor';

/** What chrome calls a page with no name of its own, as Notion does. */
export const UNTITLED_LABEL = 'Untitled';

/**
 * True while a document still carries no name, or the stored default one.
 * The stored name stays "Untitled document" (exports and the API use it);
 * only the chrome shows the shorter, muted "Untitled".
 */
export function isUntitledName(name: string | null | undefined): boolean {
  const trimmed = name?.trim() ?? '';
  return !trimmed || trimmed === DEFAULT_DOCUMENT_TITLE;
}

/** The name to show for a document in the sidebar, breadcrumb, palette and tab title. */
export function displayTitle(name: string | null | undefined): string {
  return isUntitledName(name) ? UNTITLED_LABEL : (name as string).trim();
}
