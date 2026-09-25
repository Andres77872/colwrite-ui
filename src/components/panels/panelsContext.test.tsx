import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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
  const { activeTool, researchSource, isDesktop, isOpen, assistantOpen } = context;
  return <output>{JSON.stringify({ activeTool, researchSource, isDesktop, isOpen, assistantOpen })}</output>;
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
      activeTool: 'assistant',
      researchSource: 'arxiv',
      isDesktop: true,
      isOpen: false,
      assistantOpen: false,
    });
    expect(matchMedia).toHaveBeenCalledWith('(min-width: 1024px)');
  });

  it.each([
    ['arxiv', 'research', 'arxiv'],
    ['semantic-scholar', 'research', 'semantic-scholar'],
    ['colpali', 'research', 'colpali'],
    ['library', 'research', 'library'],
    ['chats', 'assistant', 'arxiv'],
    ['json', 'assistant', 'arxiv'],
    ['history', 'history', 'arxiv'],
  ])('reopens a tool the old rail saved (%s) on the matching tab', (saved, tab, source) => {
    installDesktopMatchMedia();
    localStorage.setItem('panels.activeTool', JSON.stringify(saved));
    const state = renderProvider();

    expect(state()).toMatchObject({ activeTool: tab, researchSource: source });
  });

  it('falls back to the assistant when nothing valid was saved', () => {
    installDesktopMatchMedia();
    localStorage.setItem('panels.activeTool', 'null');
    const state = renderProvider();

    expect(state().activeTool).toBe('assistant');
  });

  it('opens a research source on the Research tab with that source selected', () => {
    installDesktopMatchMedia();
    const state = renderProvider();

    act(() => handle.current!.setTool('semantic-scholar'));
    expect(state()).toMatchObject({ activeTool: 'research', researchSource: 'semantic-scholar', isOpen: true });

    act(() => handle.current!.setTool(null));
    expect(state()).toMatchObject({ activeTool: 'research', isOpen: false });
  });

  it('treats the assistant as the sidebar on its tab', () => {
    installDesktopMatchMedia();
    const state = renderProvider();

    act(() => handle.current!.toggleAssistant());
    expect(state()).toMatchObject({ activeTool: 'assistant', isOpen: true, assistantOpen: true });

    // Closing "the assistant" while another tab shows leaves the sidebar alone.
    act(() => handle.current!.setTool('sources'));
    act(() => handle.current!.setAssistantOpen(false));
    expect(state()).toMatchObject({ activeTool: 'sources', isOpen: true, assistantOpen: false });

    act(() => handle.current!.setTool('assistant'));
    act(() => handle.current!.toggleAssistant());
    expect(state()).toMatchObject({ isOpen: false, assistantOpen: false });
  });

  it('shows JSON as a transient tab that is never restored', async () => {
    installDesktopMatchMedia();
    const state = renderProvider();

    act(() => handle.current!.setTool('history'));
    act(() => handle.current!.setTool('json'));
    expect(state()).toMatchObject({ activeTool: 'json', isOpen: true });

    // Persisted writes are coalesced to the next frame.
    await act(() => new Promise((resolve) => requestAnimationFrame(resolve)));
    cleanup();
    const reloaded = renderProvider();
    expect(reloaded().activeTool).toBe('history');
  });

  it('hands an intent to the tab it opens, once per call', () => {
    installDesktopMatchMedia();
    renderProvider();

    act(() => handle.current!.openSidebar('research', { tab: 'research', query: 'sparse routing' }));
    const first = handle.current!.intent;
    expect(first).toMatchObject({ tab: 'research', query: 'sparse routing' });
    expect(handle.current!.activeTool).toBe('research');

    act(() => handle.current!.openSidebar('research', { tab: 'research', query: 'sparse routing' }));
    expect(handle.current!.intent?.id).not.toBe(first?.id);
  });
});
