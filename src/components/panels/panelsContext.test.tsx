import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { PanelsProvider } from './panelsContext';
import { usePanels } from './panelsContextState';

function installDesktopMatchMedia() {
  const matchMedia = vi.fn((query: string) => ({
    matches: query === '(min-width: 1100px)',
    media: query,
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  }));
  vi.stubGlobal('matchMedia', matchMedia);
  return matchMedia;
}

function Probe() {
  const { activeTool, isDesktop, isOpen } = usePanels();
  return (
    <output>
      {JSON.stringify({ activeTool, isDesktop, isOpen })}
    </output>
  );
}

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('PanelsProvider defaults', () => {
  it('starts a fresh desktop workspace with secondary tools closed', () => {
    const matchMedia = installDesktopMatchMedia();

    render(
      <PanelsProvider>
        <Probe />
      </PanelsProvider>,
    );

    expect(screen.getByText('{"activeTool":null,"isDesktop":true,"isOpen":false}')).toBeTruthy();
    expect(matchMedia).toHaveBeenCalledWith('(min-width: 1100px)');
  });
});
