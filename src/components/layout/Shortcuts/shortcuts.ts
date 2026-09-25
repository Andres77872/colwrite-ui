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
 */
export type ShortcutId =
  | 'toggle-tools'
  | 'toggle-sidebar'
  | 'toggle-assistant'
  | 'command-palette'
  | 'save'
  | 'undo'
  | 'redo'
  | 'help';

export type ShortcutGroup = 'General' | 'Navigation' | 'AI' | 'Editing';

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
  /** Keycap parts, in order, for the help dialog. */
  keys: string[];
  label: string;
  group: ShortcutGroup;
};

export const SHORTCUTS: readonly Shortcut[] = [
  { id: 'command-palette', key: 'k', keys: ['Mod', 'K'], label: 'Search documents and commands', group: 'General' },
  { id: 'command-palette', key: 'p', keys: ['Mod', 'P'], label: 'Search documents and commands', group: 'General' },
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
  { label: 'Select the block', bindings: [['Esc']], group: 'Editing' },
  { label: 'Duplicate the block', bindings: [['Mod', 'D']], group: 'Editing' },
  { label: 'Move the block up or down', bindings: [['Mod', 'Shift', '↑'], ['Mod', 'Shift', '↓']], group: 'Editing', joiner: '·' },
  { label: 'Indent or outdent a list item or lines of code', bindings: [['Tab'], ['Shift', 'Tab']], group: 'Editing', joiner: '·' },
  // Tab indents inside a list or code, so it never leaves the text on its own there.
  { label: 'Leave the text for the next control', bindings: [['Esc'], ['Tab']], group: 'Editing', joiner: 'then' },
  { label: 'Turn selected blocks into another type', bindings: [['Mod', 'Alt', '0–9']], group: 'Editing' },
];

export const SHORTCUT_GROUPS: readonly ShortcutGroup[] = ['General', 'Navigation', 'AI', 'Editing'];

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
  return `${shortcut.id}:${shortcut.key}:${shortcut.shift ? 'shift' : 'plain'}`;
}

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
      (shortcut) =>
        (shortcut.key === key || (shortcut.code !== undefined && shortcut.code === event.code)) &&
        Boolean(shortcut.shift) === event.shiftKey,
    ) ?? null
  );
}
