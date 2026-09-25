import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, renderHook } from '@testing-library/react';
import { setInputModalityForTesting } from '@/lib/inputModality';
import { useReturnFocus } from '../useReturnFocus';

afterEach(() => {
  cleanup();
  document.body.innerHTML = '';
});

function closeEvent() {
  return new Event('focusScope.autoFocusOnUnmount', { cancelable: true });
}

describe('useReturnFocus', () => {
  it('hands a closing dialog’s return target to the dialog it opens', () => {
    setInputModalityForTesting('keyboard');
    const paragraph = document.createElement('button');
    paragraph.textContent = 'Paragraph';
    const field = document.createElement('input');
    document.body.append(paragraph, field);

    const palette = renderHook(() => useReturnFocus()).result.current;
    const shortcuts = renderHook(() => useReturnFocus()).result.current;

    // The palette opens from the paragraph and moves focus to its field.
    paragraph.focus();
    palette.onOpenAutoFocus();
    field.focus();

    // It closes itself to open Keyboard shortcuts, passing its target on.
    palette.handOff();
    shortcuts.onOpenAutoFocus();
    field.remove();

    const event = closeEvent();
    shortcuts.onCloseAutoFocus(event);
    expect(event.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(paragraph);
  });

  it('remembers the focused element when nothing was handed off', () => {
    setInputModalityForTesting('keyboard');
    const opener = document.createElement('button');
    document.body.append(opener);
    const dialog = renderHook(() => useReturnFocus()).result.current;

    opener.focus();
    dialog.onOpenAutoFocus();
    opener.blur();

    dialog.onCloseAutoFocus(closeEvent());
    expect(document.activeElement).toBe(opener);
  });
});
