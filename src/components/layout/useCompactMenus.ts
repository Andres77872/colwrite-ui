import { useMediaQuery } from '@/hooks/useMediaQuery';

/**
 * Whether menus should lay submenus out inline rather than as side flyouts.
 *
 * A 260px menu on a 390px phone leaves no room on either side for a second
 * column, so the flyout opened off-screen. Below `sm`, or on a touch screen,
 * the choices (Citation style, Appearance) are listed in the parent menu.
 */
export function useCompactMenus(): boolean {
  return useMediaQuery('(max-width: 639px), (pointer: coarse)');
}
