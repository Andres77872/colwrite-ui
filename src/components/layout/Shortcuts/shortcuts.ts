/**
 * The app-level keyboard shortcuts.
 *
 * Every binding carries the platform modifier, because this app is
 * contenteditable from edge to edge: a bare-key shortcut would type into the
 * document instead of firing. Two families are deliberately avoided —
 * `Mod+B`/`Mod+I`/`Mod+U`, which contenteditable already owns for bold, italic
 * and underline, and `Mod+1`…`Mod+9`, which the browser owns for tab switching.
 * Switching tools needs no numeric binding: the tools rail is a real toolbar
 * with arrow-key navigation.
 */
export type ShortcutId =
  | 'toggle-tools'
  | 'toggle-sidebar'
  | 'toggle-assistant'
  | 'save'
  | 'undo'
  | 'redo'
  | 'help';

export type Shortcut = {
  id: ShortcutId;
  /** `event.key` to match, lower-cased. */
  key: string;
  shift?: boolean;
  /** Keycap parts, in order, for the help dialog. */
  keys: string[];
  label: string;
};

export const SHORTCUTS: readonly Shortcut[] = [
  { id: 'toggle-tools', key: '\\', keys: ['Mod', '\\'], label: 'Show or hide the tools panel' },
  {
    id: 'toggle-sidebar',
    key: '\\',
    shift: true,
    keys: ['Mod', 'Shift', '\\'],
    label: 'Collapse or expand the sidebar',
  },
  { id: 'toggle-assistant', key: 'j', keys: ['Mod', 'J'], label: 'Show or hide the assistant' },
  { id: 'save', key: 's', keys: ['Mod', 'S'], label: 'Save now' },
  { id: 'undo', key: 'z', keys: ['Mod', 'Z'], label: 'Undo' },
  { id: 'redo', key: 'z', shift: true, keys: ['Mod', 'Shift', 'Z'], label: 'Redo' },
  { id: 'redo', key: 'y', keys: ['Mod', 'Y'], label: 'Redo' },
  { id: 'help', key: '/', keys: ['Mod', '/'], label: 'Show keyboard shortcuts' },
];

/** `⌘` on Apple platforms, `Ctrl` everywhere else. */
export function modifierLabel(): string {
  if (typeof navigator === 'undefined') return 'Ctrl';
  return /mac|iphone|ipad|ipod/i.test(navigator.platform || navigator.userAgent)
    ? '⌘'
    : 'Ctrl';
}

/**
 * Which shortcut a keydown matches, if any.
 *
 * `shift` is compared strictly so `Mod+\` and `Mod+Shift+\` stay distinct
 * rather than the first swallowing the second.
 */
export function matchShortcut(event: KeyboardEvent): Shortcut | null {
  if (!(event.metaKey || event.ctrlKey) || event.altKey) return null;
  const key = event.key.toLowerCase();
  return (
    SHORTCUTS.find(
      (shortcut) => shortcut.key === key && Boolean(shortcut.shift) === event.shiftKey,
    ) ?? null
  );
}
