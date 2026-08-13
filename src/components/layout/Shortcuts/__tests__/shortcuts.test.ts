import { describe, expect, it } from 'vitest';
import { SHORTCUTS, matchShortcut, shortcutBindingKey } from '../shortcuts';

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
    // Compared strictly, or the tools-panel binding swallows the sidebar one.
    expect(matchShortcut(key({ key: '\\', ctrlKey: true }))?.id).toBe('toggle-tools');
    expect(matchShortcut(key({ key: '\\', ctrlKey: true, shiftKey: true }))?.id).toBe(
      'toggle-sidebar',
    );
  });

  it('ignores a shifted variant of an unshifted binding', () => {
    expect(matchShortcut(key({ key: 'j', ctrlKey: true, shiftKey: true }))).toBeNull();
  });

  it('ignores Alt combinations, which belong to the platform', () => {
    expect(matchShortcut(key({ key: 'j', ctrlKey: true, altKey: true }))).toBeNull();
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
