import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { panelKey } from '@/lib/storageKeys';
import { useEffect } from 'react';
import { act, cleanup, render, screen } from '@testing-library/react';
import { PanelsProvider } from './panelsContext';
import { usePanels, type PanelsContextValue } from './panelsContextState';

function installDesktopMatchMedia() {
  const matchMedia = vi.fn((query: string) => ({
    matches: query === '(min-width: 1024px)',
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

/** The live context, for driving its actions from the test. */
const handle: { current: PanelsContextValue | null } = { current: null };

function Probe() {
  const context = usePanels();
  useEffect(() => {
    handle.current = context;
  });
  const { activePanel, researchSource, isDesktop, isOpen, assistantOpen } = context;
  return <output>{JSON.stringify({ activePanel, researchSource, isDesktop, isOpen, assistantOpen })}</output>;
}

function renderProvider() {
  render(
    <PanelsProvider>
      <Probe />
    </PanelsProvider>,
  );
  return () => JSON.parse(screen.getByRole('status').textContent ?? '{}') as Record<string, unknown>;
}

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('PanelsProvider', () => {
  it('starts a fresh desktop workspace closed, on the assistant', () => {
    const matchMedia = installDesktopMatchMedia();
    const state = renderProvider();

    expect(state()).toEqual({
      activePanel: 'assistant',
      researchSource: 'papers',
      isDesktop: true,
      isOpen: false,
      assistantOpen: false,
    });
    expect(matchMedia).toHaveBeenCalledWith('(min-width: 1024px)');
  });

  it.each([
    ['research', 'research'],
    ['library', 'library'],
    ['history', 'history'],
  ])('reopens on the tab it was last on (%s)', (saved, tab) => {
    installDesktopMatchMedia();
    localStorage.setItem(panelKey('tab'), JSON.stringify(saved));
    const state = renderProvider();

    expect(state()).toMatchObject({ activePanel: tab, researchSource: 'papers' });
  });

  it('never reopens on the developer JSON view', () => {
    installDesktopMatchMedia();
    localStorage.setItem(panelKey('tab'), JSON.stringify('json'));
    const state = renderProvider();

    expect(state().activePanel).toBe('assistant');
  });

  it('falls back to the assistant when nothing valid was saved', () => {
    installDesktopMatchMedia();
    localStorage.setItem(panelKey('tab'), 'null');
    const state = renderProvider();

    expect(state().activePanel).toBe('assistant');
  });

  it('opens a research source on the Research tab with that source selected', () => {
    installDesktopMatchMedia();
    const state = renderProvider();

    act(() => handle.current!.setPanel('papers'));
    expect(state()).toMatchObject({ activePanel: 'research', researchSource: 'papers', isOpen: true });

    act(() => handle.current!.setPanel(null));
    expect(state()).toMatchObject({ activePanel: 'research', isOpen: false });
  });

  it('treats the assistant as the sidebar on its tab', () => {
    installDesktopMatchMedia();
    const state = renderProvider();

    act(() => handle.current!.toggleAssistant());
    expect(state()).toMatchObject({ activePanel: 'assistant', isOpen: true, assistantOpen: true });

    // Closing "the assistant" while another tab shows leaves the sidebar alone.
    act(() => handle.current!.setPanel('sources'));
    act(() => handle.current!.setAssistantOpen(false));
    expect(state()).toMatchObject({ activePanel: 'sources', isOpen: true, assistantOpen: false });

    act(() => handle.current!.setPanel('assistant'));
    act(() => handle.current!.toggleAssistant());
    expect(state()).toMatchObject({ isOpen: false, assistantOpen: false });
  });

  it('shows JSON as a transient tab that is never restored', async () => {
    installDesktopMatchMedia();
    const state = renderProvider();

    act(() => handle.current!.setPanel('history'));
    act(() => handle.current!.setPanel('json'));
    expect(state()).toMatchObject({ activePanel: 'json', isOpen: true });

    // Persisted writes are coalesced to the next frame.
    await act(() => new Promise((resolve) => requestAnimationFrame(resolve)));
    cleanup();
    const reloaded = renderProvider();
    expect(reloaded().activePanel).toBe('history');
  });

  it('opens the Library as a tab of its own', () => {
    installDesktopMatchMedia();
    const state = renderProvider();

    act(() => handle.current!.setPanel('library'));
    expect(state()).toMatchObject({ activePanel: 'library', researchSource: 'papers', isOpen: true });

    act(() => handle.current!.openSidebar('library', { tab: 'library', query: 'router' }));
    expect(handle.current!.intent).toMatchObject({ tab: 'library', query: 'router' });
  });

  it('hands an intent to the tab it opens, once per call', () => {
    installDesktopMatchMedia();
    renderProvider();

    act(() => handle.current!.openSidebar('research', { tab: 'research', query: 'sparse routing' }));
    const first = handle.current!.intent;
    expect(first).toMatchObject({ tab: 'research', query: 'sparse routing' });
    expect(handle.current!.activePanel).toBe('research');

    act(() => handle.current!.openSidebar('research', { tab: 'research', query: 'sparse routing' }));
    expect(handle.current!.intent?.id).not.toBe(first?.id);
  });
});
