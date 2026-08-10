import { describe, expect, it } from 'vitest';
import {
  emitSlashMenuVisibility,
  isSlashMenuOpen,
  openSlashMenu,
  SLASH_MENU_EVENT,
  SLASH_MENU_VISIBILITY_EVENT,
} from '../slashMenuEvents';

describe('slashMenuEvents', () => {
  it('reports the menu open only once it actually became visible', () => {
    // `openSlashMenu` is a request: the menu can still decline (caret outside
    // the paragraph, no geometry). The flag used to go up with the request,
    // and a declined open then hid the FloatingToolbar for the whole session.
    openSlashMenu('p1');
    expect(isSlashMenuOpen()).toBe(false);

    emitSlashMenuVisibility(true);
    expect(isSlashMenuOpen()).toBe(true);
    emitSlashMenuVisibility(false);
    expect(isSlashMenuOpen()).toBe(false);
  });

  it('still delivers the open request to the menu', () => {
    const seen: string[] = [];
    const onOpen = (event: Event) => {
      seen.push((event as CustomEvent<{ blockId: string }>).detail.blockId);
    };
    window.addEventListener(SLASH_MENU_EVENT, onOpen);
    openSlashMenu('p2');
    window.removeEventListener(SLASH_MENU_EVENT, onOpen);
    expect(seen).toEqual(['p2']);
  });

  it('broadcasts visibility changes to listeners', () => {
    const seen: boolean[] = [];
    const onVisibility = (event: Event) => {
      seen.push((event as CustomEvent<{ visible: boolean }>).detail.visible);
    };
    window.addEventListener(SLASH_MENU_VISIBILITY_EVENT, onVisibility);
    emitSlashMenuVisibility(true);
    emitSlashMenuVisibility(false);
    window.removeEventListener(SLASH_MENU_VISIBILITY_EVENT, onVisibility);
    expect(seen).toEqual([true, false]);
  });
});
