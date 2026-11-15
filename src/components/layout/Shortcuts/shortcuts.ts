/**
 * The app-level keyboard shortcuts.
 *
 * Every binding carries the platform modifier, because this app is
 * contenteditable from edge to edge: a bare-key shortcut would type into the
 * document instead of firing. Two families are deliberately avoided —
 * `Mod+B`/`Mod+I`/`Mod+U`, which contenteditable already owns for bold, italic
 * and underline, and `Mod+1`…`Mod+9`, which the browser owns for tab switching.
 * Switching tools needs no numeric binding: each right-sidebar tab has its
 * own button in the page topbar.
 *
 * Checked against the browsers' own keys on macOS, Windows and Linux (Chrome,
 * Edge, Firefox, Safari):
 * - `Mod+N`, `Mod+Shift+N`, `Mod+T`, `Mod+W` are reserved: the browser never
 *   hands them to the page, so "New page" is `Mod+Alt+N`, which no browser
 *   binds.
 * - `Mod+Shift+L` is free in Chrome and Firefox. Safari (Show Sidebar), Edge
 *   (Paste and search) and password-manager extensions (autofill) may keep
 *   it; the sidebar's Library row and the palette are the way there.
 */
export type ShortcutId =
  | 'toggle-tools'
  | 'toggle-sidebar'
  | 'toggle-assistant'
  | 'command-palette'
  | 'new-page'
  | 'library'
  | 'save'
  | 'undo'
  | 'redo'
  | 'help';

export type ShortcutGroup = 'General' | 'Navigation' | 'AI' | 'Review' | 'Editing';

export type Shortcut = {
  id: ShortcutId;
  /** `event.key` to match, lower-cased. */
  key: string;
  /**
   * `event.code` to match instead of `key`, for punctuation whose `key`
   * changes with Shift: Shift+\ reports `|` on US and most other layouts.
   */
  code?: string;
  shift?: boolean;
  /** Alt (Option) held as well. Compared strictly, like `shift`. */
  alt?: boolean;
  /** Keycap parts, in order, for the help dialog. */
  keys: string[];
  label: string;
  group: ShortcutGroup;
};

export const SHORTCUTS: readonly Shortcut[] = [
  { id: 'command-palette', key: 'k', keys: ['Mod', 'K'], label: 'Search pages and commands', group: 'General' },
  { id: 'command-palette', key: 'p', keys: ['Mod', 'P'], label: 'Search pages and commands', group: 'General' },
  // Matched on the physical key too: on macOS Option turns N into the tilde
  // dead key, so ⌘⌥N reports `Dead`, not `n`.
  {
    id: 'new-page',
    key: 'n',
    code: 'KeyN',
    alt: true,
    keys: ['Mod', 'Alt', 'N'],
    label: 'New page',
    group: 'General',
  },
  { id: 'save', key: 's', keys: ['Mod', 'S'], label: 'Save now', group: 'General' },
  { id: 'undo', key: 'z', keys: ['Mod', 'Z'], label: 'Undo', group: 'General' },
  { id: 'redo', key: 'z', shift: true, keys: ['Mod', 'Shift', 'Z'], label: 'Redo', group: 'General' },
  { id: 'redo', key: 'y', keys: ['Mod', 'Y'], label: 'Redo', group: 'General' },
  { id: 'help', key: '/', keys: ['Mod', '/'], label: 'Show keyboard shortcuts', group: 'General' },
  // As in Notion: Mod+\ is the sidebar. The right sidebar takes the shifted
  // chord, matched on the physical key because Shift turns `\` into `|`.
  {
    id: 'toggle-sidebar',
    key: '\\',
    code: 'Backslash',
    keys: ['Mod', '\\'],
    label: 'Show or hide the sidebar',
    group: 'Navigation',
  },
  {
    id: 'toggle-tools',
    key: '\\',
    code: 'Backslash',
    shift: true,
    keys: ['Mod', 'Shift', '\\'],
    label: 'Show or hide the right sidebar',
    group: 'Navigation',
  },
  { id: 'library', key: 'l', shift: true, keys: ['Mod', 'Shift', 'L'], label: 'Open the Library', group: 'Navigation' },
  // Inside a block Mod+J is claimed first by Ask AI (the block's own
  // handler); Mod+Shift+J reaches the assistant panel from anywhere, as in
  // Notion.
  {
    id: 'toggle-assistant',
    key: 'j',
    shift: true,
    keys: ['Mod', 'Shift', 'J'],
    label: 'Show or hide the AI sidebar',
    group: 'AI',
  },
  // Outside a block the same chord opens the AI sidebar; inside one it asks
  // AI about that block, which is what the reference calls it.
  { id: 'toggle-assistant', key: 'j', keys: ['Mod', 'J'], label: 'Ask AI on the current block', group: 'AI' },
];

/**
 * Bindings the editor itself handles (blocks, formatting, the slash menu).
 * Listed only for the reference dialog; `matchShortcut` never sees them.
 */
export const EDITOR_SHORTCUTS: ReadonlyArray<{
  label: string;
  bindings: string[][];
  group: ShortcutGroup;
  /** Between the chords: "or" for alternatives, "·" for a set of separate actions. */
  joiner?: string;
}> = [
  { label: 'Ask AI on an empty line', bindings: [['Space']], group: 'AI' },
  { label: 'Insert a block', bindings: [['/']], group: 'Editing' },
  { label: 'Bold, italic, underline', bindings: [['Mod', 'B'], ['Mod', 'I'], ['Mod', 'U']], group: 'Editing', joiner: '·' },
  { label: 'Add a link to the selection', bindings: [['Mod', 'K']], group: 'Editing' },
  // Handled in Editable: the clipboard's text only, no formatting and no blocks.
  { label: 'Paste as plain text', bindings: [['Mod', 'Shift', 'V']], group: 'Editing' },
  // The selection toolbar (FloatingToolbar): strikethrough, inline code, Cite
  // and the AI actions have no chord of their own. Arrow keys move along the
  // toolbar; Esc goes back to the text with the selection kept. Not Mod:
  // Alt+F10 is the WAI-ARIA convention for "go to this field's toolbar".
  { label: 'Move to the formatting toolbar (with text selected)', bindings: [['Alt', 'F10']], group: 'Editing' },
  { label: 'Select the block', bindings: [['Esc']], group: 'Editing' },
  { label: 'Duplicate the block', bindings: [['Mod', 'D']], group: 'Editing' },
  { label: 'Move the block up or down', bindings: [['Mod', 'Shift', '↑'], ['Mod', 'Shift', '↓']], group: 'Editing', joiner: '·' },
  { label: 'Indent or outdent a list item or lines of code', bindings: [['Tab'], ['Shift', 'Tab']], group: 'Editing', joiner: '·' },
  // Tab indents inside a list or code, so it never leaves the text on its own there.
  { label: 'Leave the text for the next control', bindings: [['Esc'], ['Tab']], group: 'Editing', joiner: 'then' },
  { label: 'Turn selected blocks into another type', bindings: [['Mod', 'Alt', '0–9']], group: 'Editing' },

  // Reviewing the assistant's suggestions. Both keys act on the suggestion
  // card that holds focus and are handled there (ChangeCard), so
  // `matchShortcut` never sees them: Mod+Enter stays "apply" in Ask AI and
  // "send" in the composer.
  { label: 'Accept the focused suggestion', bindings: [['Mod', 'Enter']], group: 'Review' },
  { label: 'Reject the focused suggestion', bindings: [['Mod', 'Backspace'], ['Mod', 'Delete']], group: 'Review' },

  // The sidebar's pages tree, on its focused row (PagesTree). Type a name's
  // first letters to move to it.
  { label: 'Rename the focused page or collection in the tree', bindings: [['F2']], group: 'Navigation' },
  { label: 'Open the focused tree row’s menu', bindings: [['Shift', 'F10']], group: 'Navigation' },
  { label: 'Move the focused tree row up or down (custom order)', bindings: [['Alt', 'Shift', '↑'], ['Alt', 'Shift', '↓']], group: 'Navigation', joiner: '·' },
];

export const SHORTCUT_GROUPS: readonly ShortcutGroup[] = ['General', 'Navigation', 'AI', 'Review', 'Editing'];

export type ShortcutRow = { label: string; bindings: string[][]; joiner?: string };

/**
 * The reference dialog's rows, grouped: alternate bindings of one action
 * share a row ("Mod K or Mod P") instead of repeating the label.
 */
export function shortcutReference(): Array<{ group: ShortcutGroup; rows: ShortcutRow[] }> {
  return SHORTCUT_GROUPS.map((group) => {
    const rows: ShortcutRow[] = [];
    for (const shortcut of SHORTCUTS) {
      if (shortcut.group !== group) continue;
      const existing = rows.find((row) => row.label === shortcut.label);
      if (existing) existing.bindings.push(shortcut.keys);
      else rows.push({ label: shortcut.label, bindings: [shortcut.keys] });
    }
    for (const entry of EDITOR_SHORTCUTS) {
      if (entry.group === group) rows.push({ label: entry.label, bindings: entry.bindings, joiner: entry.joiner });
    }
    return { group, rows };
  }).filter((section) => section.rows.length > 0);
}

/** Stable identity for one physical binding, distinct from its shared action. */
export function shortcutBindingKey(shortcut: Shortcut): string {
  return `${shortcut.id}:${shortcut.key}:${shortcut.shift ? 'shift' : 'plain'}${shortcut.alt ? ':alt' : ''}`;
}

/** The keycap parts of an action's first binding (`Mod` unresolved), for a hint beside a control. */
export function bindingKeys(id: ShortcutId): string[] {
  return SHORTCUTS.find((shortcut) => shortcut.id === id)?.keys ?? [];
}

/** `⌘` on Apple platforms, `Ctrl` everywhere else. */
export function modifierLabel(): string {
  if (typeof navigator === 'undefined') return 'Ctrl';
  return /mac|iphone|ipad|ipod/i.test(navigator.platform || navigator.userAgent)
    ? '⌘'
    : 'Ctrl';
}

/**
 * What a keycap reads in the help dialog: `Mod` is the platform modifier,
 * and `Alt` is `⌥` where the platform modifier is `⌘` (the Option key).
 */
export function keycapLabel(part: string, modifier = modifierLabel()): string {
  if (part === 'Mod') return modifier;
  if (part === 'Alt' && modifier === '⌘') return '⌥';
  return part;
}

/**
 * Whether the pressed key is the shortcut's key.
 *
 * An Alt chord falls back to the physical key only with ⌘ held (macOS, where
 * Option makes the letter a dead key or a symbol). Elsewhere Ctrl+Alt is
 * AltGr on Windows and types letters (ń is AltGr+N on a Polish keyboard), so
 * the key must be the letter itself.
 */
function keyMatches(shortcut: Shortcut, event: KeyboardEvent, key: string): boolean {
  if (shortcut.key === key) return true;
  if (shortcut.code === undefined || shortcut.code !== event.code) return false;
  return !shortcut.alt || event.metaKey;
}

/**
 * Which shortcut a keydown matches, if any.
 *
 * `shift` and `alt` are compared strictly so `Mod+\` and `Mod+Shift+\` stay
 * distinct rather than the first swallowing the second, and so an Alt chord
 * the platform owns never reaches a plain binding.
 */
export function matchShortcut(event: KeyboardEvent): Shortcut | null {
  if (!(event.metaKey || event.ctrlKey)) return null;
  // AltGr reports Ctrl+Alt on Windows; it is typing, never a chord.
  if (event.altKey && event.getModifierState?.('AltGraph')) return null;
  const key = event.key.toLowerCase();
  return (
    SHORTCUTS.find(
      (shortcut) =>
        keyMatches(shortcut, event, key) &&
        Boolean(shortcut.shift) === event.shiftKey &&
        Boolean(shortcut.alt) === event.altKey,
    ) ?? null
  );
}
