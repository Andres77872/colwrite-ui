import type { KeyboardEvent } from 'react';
import type { BlockKindId } from '../../../editor';

/**
 * Keys every document editable reads the same way — the prose blocks and the
 * code editables — so a block shortcut does not change meaning with the kind
 * of block the caret is in.
 */

/** Whether Mod (⌘ on macOS, Ctrl elsewhere) is the only command modifier held. */
export function isMod(event: KeyboardEvent): boolean {
  const mac = /Mac|iPhone|iPad/.test(navigator.platform);
  return mac ? event.metaKey && !event.ctrlKey : event.ctrlKey && !event.metaKey;
}

/**
 * ⌘⌥0–9 turns the block into a kind, as in Notion. 7 and 9 are Notion's
 * toggle and page, which ColWrite does not have; they carry quote and
 * callout instead.
 */
export const TURN_INTO_DIGITS: Readonly<Record<string, BlockKindId>> = {
  '0': 'text',
  '1': 'h1',
  '2': 'h2',
  '3': 'h3',
  '4': 'todo',
  '5': 'bullet',
  '6': 'numbered',
  '7': 'quote',
  '8': 'code',
  '9': 'callout',
};

/** The kind a Mod+Alt+digit press asks for, if it is one. */
export function turnIntoKind(event: KeyboardEvent): BlockKindId | undefined {
  return TURN_INTO_DIGITS[event.code?.replace('Digit', '') ?? event.key];
}
