// Straight from the module, not the `@/editor` barrel that tests replace.
import { isDefaultTitle } from '@/editor/useDocumentTitle';

/** What chrome calls a page with no name of its own, as Notion does. */
export const UNTITLED_LABEL = 'Untitled';

/**
 * True while a page still carries no name, or the stored default one.
 * The stored name stays "Untitled page" (exports use it); only the chrome
 * shows the shorter, muted "Untitled".
 */
export function isUntitledName(name: string | null | undefined): boolean {
  return isDefaultTitle(name);
}

/** The name to show for a document in the sidebar, breadcrumb, palette and tab title. */
export function displayTitle(name: string | null | undefined): string {
  return isUntitledName(name) ? UNTITLED_LABEL : (name as string).trim();
}
