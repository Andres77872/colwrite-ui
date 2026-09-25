/// <reference types="node" />
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Dialog, DialogContent, DialogTitle } from '../dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '../dropdown-menu';
import { Sheet, SheetContent } from '../sheet';
import { setInputModalityForTesting } from '@/lib/inputModality';

/** The z-index tokens from globals.css, so the test follows the real scale. */
function zTokens(): Record<string, number> {
  // Read from disk: Vitest stubs CSS imports, `?raw` included.
  const css = readFileSync(resolve(__dirname, '../../../styles/globals.css'), 'utf8');
  const out: Record<string, number> = {};
  for (const match of css.matchAll(/--(z-[a-z-]+):\s*(\d+);/g)) out[match[1]] = Number(match[2]);
  return out;
}

/** The layer an element sits on, read from its `z-[var(--z-*)]` class. */
function layerOf(el: Element | null): number {
  const token = el?.className.toString().match(/z-\[var\(--(z-[a-z-]+)\)\]/)?.[1];
  const value = token ? zTokens()[token] : undefined;
  if (value === undefined) throw new Error(`no z layer on ${el?.outerHTML.slice(0, 80)}`);
  return value;
}

/** Radix menus open on pointerdown, not click. */
function openMenu(name: string) {
  fireEvent.pointerDown(screen.getByRole('button', { name }), { button: 0, ctrlKey: false });
}

function MenuInSheet() {
  return (
    <Sheet open>
      <SheetContent title="Navigation">
        <DropdownMenu>
          <DropdownMenuTrigger>Workspace</DropdownMenuTrigger>
          <DropdownMenuContent>
            <DropdownMenuItem>Sign out</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </SheetContent>
    </Sheet>
  );
}

afterEach(() => {
  cleanup();
  setInputModalityForTesting('keyboard');
});

describe('overlay layering', () => {
  it('draws a menu opened inside a Sheet above the sheet and its scrim', async () => {
    render(<MenuInSheet />);
    openMenu('Workspace');
    const menu = await screen.findByRole('menu');
    // The open menu is modal, so it hides the sheet from the a11y tree.
    const sheet = screen.getByRole('dialog', { hidden: true });
    const scrim = document.querySelector('[data-radix-dialog-overlay], .bg-scrim');

    expect(layerOf(menu)).toBeGreaterThan(layerOf(sheet));
    expect(layerOf(menu)).toBeGreaterThan(layerOf(scrim));
    // Both portal to <body>, so nothing else re-parents the menu's layer.
    expect(sheet.contains(menu)).toBe(false);
  });
});

describe('focus after pointer use', () => {
  function Menu({ onSelect = () => {} }: { onSelect?: () => void }) {
    return (
      <DropdownMenu>
        <DropdownMenuTrigger>Options</DropdownMenuTrigger>
        <DropdownMenuContent>
          <DropdownMenuItem onSelect={onSelect}>Copy link</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    );
  }

  it('returns focus to the trigger without asking for a ring after a click', async () => {
    const focus = vi.spyOn(HTMLElement.prototype, 'focus');
    render(<Menu />);
    openMenu('Options');
    const item = await screen.findByRole('menuitem', { name: 'Copy link' });
    setInputModalityForTesting('pointer');
    focus.mockClear();
    act(() => { fireEvent.click(item); });
    await waitFor(() => expect(screen.queryByRole('menu')).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Options' })));
    const call = focus.mock.calls.find(([options]) => options && 'focusVisible' in options);
    expect(call?.[0]).toMatchObject({ focusVisible: false });
    focus.mockRestore();
  });

  it('keeps the plain restore (and its ring) after keyboard use', async () => {
    const focus = vi.spyOn(HTMLElement.prototype, 'focus');
    render(<Menu />);
    openMenu('Options');
    await screen.findByRole('menu');
    setInputModalityForTesting('keyboard');
    focus.mockClear();
    fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' });
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Options' })));
    expect(focus.mock.calls.some(([options]) => options && 'focusVisible' in options)).toBe(false);
    focus.mockRestore();
  });

  it('focuses a pointer-opened dialog itself instead of its first button', async () => {
    setInputModalityForTesting('pointer');
    render(
      <Dialog open>
        <DialogContent>
          <DialogTitle>Delete?</DialogTitle>
          <button type="button">Cancel</button>
        </DialogContent>
      </Dialog>,
    );
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('dialog')));
  });

  it('still focuses a leading text field in a pointer-opened dialog', async () => {
    setInputModalityForTesting('pointer');
    render(
      <Dialog open>
        <DialogContent>
          <DialogTitle>Rename</DialogTitle>
          <input aria-label="Name" />
        </DialogContent>
      </Dialog>,
    );
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('textbox', { name: 'Name' })));
  });

  it('focuses the first control of a keyboard-opened dialog as before', async () => {
    setInputModalityForTesting('keyboard');
    render(
      <Dialog open>
        <DialogContent showCloseButton={false}>
          <DialogTitle>Delete?</DialogTitle>
          <button type="button">Cancel</button>
        </DialogContent>
      </Dialog>,
    );
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Cancel' })));
  });
});
