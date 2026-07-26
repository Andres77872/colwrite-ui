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
  emitSlashMenuVisibility(true);
}
