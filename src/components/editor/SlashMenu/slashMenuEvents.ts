export const SLASH_MENU_EVENT = 'colwrite:open-slash-menu';
export const SLASH_MENU_VISIBILITY_EVENT = 'colwrite:slash-menu-visibility';

let slashMenuOpen = false;

export function isSlashMenuOpen(): boolean {
  return slashMenuOpen;
}

export function emitSlashMenuVisibility(visible: boolean): void {
  slashMenuOpen = visible;
  window.dispatchEvent(
    new CustomEvent<{ visible: boolean }>(SLASH_MENU_VISIBILITY_EVENT, {
      detail: { visible },
    }),
  );
}

export function openSlashMenu(blockId: string): void {
  window.dispatchEvent(
    new CustomEvent<{ blockId: string }>(SLASH_MENU_EVENT, { detail: { blockId } }),
  );
  // The open flag is *not* raised here: the menu can decline (selection left
  // the paragraph, no caret geometry), and a flag raised on request stayed up
  // for the rest of the session, hiding the FloatingToolbar forever. Only the
  // menu's own visibility effect reports `true`.
}
