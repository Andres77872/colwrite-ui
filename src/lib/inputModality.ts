/**
 * Which kind of input the person used last: a pointer (mouse, pen, touch) or
 * the keyboard.
 *
 * `:focus-visible` decides whether a ring shows for focus the user moved
 * themselves, but not for focus a script moves. Chrome rings a trigger that a
 * menu hands focus back to, even when the menu item was clicked. The overlay
 * primitives read this to move focus quietly after pointer use, the way
 * Notion never shows a ring after a click, and keep the ring for keyboard use.
 */
export type InputModality = 'pointer' | 'keyboard';

let modality: InputModality = 'keyboard';
let installed = false;

const MODIFIER_KEYS = new Set(['Shift', 'Control', 'Alt', 'Meta', 'CapsLock', 'Fn']);

function install() {
  if (installed || typeof document === 'undefined') return;
  installed = true;
  document.addEventListener('pointerdown', () => { modality = 'pointer'; }, true);
  document.addEventListener('keydown', (event) => {
    // Holding a modifier for a shortcut-click is still pointer use.
    if (!MODIFIER_KEYS.has(event.key)) modality = 'keyboard';
  }, true);
}

install();

export function lastInputModality(): InputModality {
  return modality;
}

export function lastInputWasPointer(): boolean {
  return modality === 'pointer';
}

/** Test hook: pretend the last input came from `next`. */
export function setInputModalityForTesting(next: InputModality): void {
  modality = next;
}
