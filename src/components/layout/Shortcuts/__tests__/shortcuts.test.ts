import { itemAt } from '@/lib/itemAt';
import { describe, expect, it } from 'vitest';
import { SHORTCUTS, keycapLabel, matchShortcut, shortcutBindingKey, shortcutReference } from '../shortcuts';

/** A KeyboardEvent without needing a DOM target. */
function key(init: KeyboardEventInit): KeyboardEvent {
  return new KeyboardEvent('keydown', init);
}

describe('matchShortcut', () => {
  it('requires the platform modifier', () => {
    // Every binding is modified because the app is contenteditable throughout;
    // a bare key would type into the document instead of firing.
    expect(matchShortcut(key({ key: '\\' }))).toBeNull();
    expect(matchShortcut(key({ key: 'j' }))).toBeNull();
    expect(matchShortcut(key({ key: 's' }))).toBeNull();
  });

  it('accepts either Ctrl or Meta', () => {
    expect(matchShortcut(key({ key: 'j', ctrlKey: true }))?.id).toBe('toggle-assistant');
    expect(matchShortcut(key({ key: 'j', metaKey: true }))?.id).toBe('toggle-assistant');
  });

  it('keeps the shifted and unshifted backslash bindings distinct', () => {
    // Compared strictly, or the sidebar binding swallows the right sidebar's.
    // Mod+\ is the sidebar, as in Notion.
    expect(matchShortcut(key({ key: '\\', ctrlKey: true }))?.id).toBe('toggle-sidebar');
    expect(matchShortcut(key({ key: '\\', ctrlKey: true, shiftKey: true }))?.id).toBe(
      'toggle-tools',
    );
  });

  it('matches Mod+Shift+\\ on the physical key, since Shift turns the key into |', () => {
    expect(
      matchShortcut(key({ key: '|', code: 'Backslash', shiftKey: true, ctrlKey: true }))?.id,
    ).toBe('toggle-tools');
    expect(matchShortcut(key({ key: '|', code: 'Backslash', shiftKey: true, metaKey: true }))?.id).toBe(
      'toggle-tools',
    );
  });

  it('ignores a shifted variant of an unshifted binding', () => {
    expect(matchShortcut(key({ key: 's', ctrlKey: true, shiftKey: true }))).toBeNull();
  });

  it('reaches the assistant with Mod+Shift+J as well, since Mod+J is Ask AI inside a block', () => {
    expect(matchShortcut(key({ key: 'j', ctrlKey: true, shiftKey: true }))?.id).toBe('toggle-assistant');
  });

  it('opens the command palette with Mod+K and Mod+P', () => {
    expect(matchShortcut(key({ key: 'k', metaKey: true }))?.id).toBe('command-palette');
    expect(matchShortcut(key({ key: 'p', ctrlKey: true }))?.id).toBe('command-palette');
  });

  it('ignores Alt combinations, which belong to the platform', () => {
    expect(matchShortcut(key({ key: 'j', ctrlKey: true, altKey: true }))).toBeNull();
  });

  it('creates a page with Mod+Alt+N, since the browser keeps Mod+N and Mod+Shift+N', () => {
    expect(matchShortcut(key({ key: 'n', code: 'KeyN', ctrlKey: true, altKey: true }))?.id).toBe('new-page');
    // macOS: Option makes N the tilde dead key, so ⌘⌥N is read off the key itself.
    expect(matchShortcut(key({ key: 'Dead', code: 'KeyN', metaKey: true, altKey: true }))?.id).toBe('new-page');
    expect(matchShortcut(key({ key: '˜', code: 'KeyN', metaKey: true, altKey: true }))?.id).toBe('new-page');
    // New window and the private window stay the browser's.
    expect(matchShortcut(key({ key: 'n', code: 'KeyN', ctrlKey: true }))).toBeNull();
    expect(matchShortcut(key({ key: 'N', code: 'KeyN', ctrlKey: true, shiftKey: true }))).toBeNull();
  });

  it('leaves AltGr typing alone', () => {
    // Windows reports AltGr as Ctrl+Alt: AltGr+N types ń on a Polish keyboard.
    const altGr = key({ key: 'ń', code: 'KeyN', ctrlKey: true, altKey: true });
    Object.defineProperty(altGr, 'getModifierState', { value: (name: string) => name === 'AltGraph' });
    expect(matchShortcut(altGr)).toBeNull();
    // Left Ctrl+Alt types the same letter there without reporting AltGraph:
    // off macOS the key must be the letter itself.
    expect(matchShortcut(key({ key: 'ń', code: 'KeyN', ctrlKey: true, altKey: true }))).toBeNull();
  });

  it('opens the Library with Mod+Shift+L, leaving Mod+L to the address bar', () => {
    expect(matchShortcut(key({ key: 'L', ctrlKey: true, shiftKey: true }))?.id).toBe('library');
    expect(matchShortcut(key({ key: 'l', metaKey: true, shiftKey: true }))?.id).toBe('library');
    expect(matchShortcut(key({ key: 'l', ctrlKey: true }))).toBeNull();
  });

  it('is case-insensitive, so Caps Lock does not disable the app', () => {
    expect(matchShortcut(key({ key: 'J', metaKey: true }))?.id).toBe('toggle-assistant');
  });

  it('claims no binding the editor or the browser already owns', () => {
    // Mod+B/I/U are contenteditable's bold/italic/underline; Mod+1…9 are the
    // browser's tab switching.
    const claimed = SHORTCUTS.map((shortcut) => shortcut.key);
    for (const reserved of ['b', 'i', 'u', '1', '2', '3', '4', '5', '6', '7', '8', '9']) {
      expect(claimed).not.toContain(reserved);
    }
    // New window, new tab, close tab and their shifted forms are reserved: no
    // browser hands them to the page, so a binding there would never fire.
    for (const reserved of ['n', 't', 'w']) {
      for (const shiftKey of [false, true]) {
        expect(matchShortcut(key({ key: reserved, ctrlKey: true, shiftKey }))).toBeNull();
        expect(matchShortcut(key({ key: reserved, metaKey: true, shiftKey }))).toBeNull();
      }
    }
  });

  it('gives every binding keycaps for the help dialog', () => {
    for (const shortcut of SHORTCUTS) {
      expect(shortcut.keys.length).toBeGreaterThan(1);
      expect(shortcut.keys[0]).toBe('Mod');
      expect(shortcut.label.length).toBeGreaterThan(0);
    }
  });

  it('keeps displayed bindings distinct while preserving both redo variants', () => {
    const rowKeys = SHORTCUTS.map(shortcutBindingKey);
    expect(new Set(rowKeys).size).toBe(SHORTCUTS.length);

    expect(
      SHORTCUTS.filter((shortcut) => shortcut.id === 'redo').map((shortcut) => ({
        key: shortcut.key,
        shift: Boolean(shortcut.shift),
      })),
    ).toEqual([
      { key: 'z', shift: true },
      { key: 'y', shift: false },
    ]);
  });
});

describe('shortcutReference', () => {
  it('groups rows and merges alternate bindings of one action into a single row', () => {
    const sections = shortcutReference();
    expect(sections.map((section) => section.group)).toEqual(['General', 'Navigation', 'AI', 'Review', 'Editing']);
    const labels = sections.flatMap((section) => section.rows.map((row) => row.label));
    expect(new Set(labels).size).toBe(labels.length);
    const search = itemAt(sections, 0).rows.find((row) => row.label === 'Search pages and commands');
    expect(search?.bindings).toEqual([
      ['Mod', 'K'],
      ['Mod', 'P'],
    ]);
    const redo = itemAt(sections, 0).rows.find((row) => row.label === 'Redo');
    expect(redo?.bindings).toHaveLength(2);
    expect(labels).toContain('Ask AI on the current block');
    expect(labels).toContain('Duplicate the block');
  });

  it('lists New page and the Library in the Mod+/ reference', () => {
    const sections = shortcutReference();
    const row = (group: string, label: string) =>
      sections.find((section) => section.group === group)?.rows.find((entry) => entry.label === label);
    expect(row('General', 'New page')?.bindings).toEqual([['Mod', 'Alt', 'N']]);
    expect(row('Navigation', 'Open the Library')?.bindings).toEqual([['Mod', 'Shift', 'L']]);
    expect(keycapLabel('Alt', '⌘')).toBe('⌥');
  });

  it('lists the way from selected text to the formatting toolbar', () => {
    const editing = shortcutReference().find((section) => section.group === 'Editing');
    const toolbar = editing?.rows.find((row) => row.label.startsWith('Move to the formatting toolbar'));
    expect(toolbar?.bindings).toEqual([['Alt', 'F10']]);
    // The editor handles it, not the app-level matcher (it carries no Mod).
    expect(matchShortcut(new KeyboardEvent('keydown', { key: 'F10', altKey: true }))).toBeNull();
  });
});

describe('keycapLabel', () => {
  it('names the platform modifier and the Option key on Apple platforms', () => {
    expect(keycapLabel('Mod', '⌘')).toBe('⌘');
    expect(keycapLabel('Alt', '⌘')).toBe('⌥');
    expect(keycapLabel('F10', '⌘')).toBe('F10');
  });

  it('keeps Ctrl and Alt elsewhere', () => {
    expect(keycapLabel('Mod', 'Ctrl')).toBe('Ctrl');
    expect(keycapLabel('Alt', 'Ctrl')).toBe('Alt');
  });
});
