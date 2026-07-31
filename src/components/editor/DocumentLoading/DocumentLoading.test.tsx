import { createRef } from 'react';
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const editorState = {
  documentId: 'doc-a' as string | null,
  loadingDocumentId: null as string | null,
};

vi.mock('@/editor', () => ({ useEditor: () => editorState }));

const { DocumentLoadingBoundary } = await import('./DocumentLoading');

function renderBoundary() {
  const regionRef = createRef<HTMLDivElement>();
  const view = render(
    <DocumentLoadingBoundary regionRef={regionRef}>
      <div className="canvas" data-testid="committed-canvas">
        <button type="button">Old document control</button>
      </div>
    </DocumentLoadingBoundary>,
  );
  return { ...view, regionRef };
}

beforeEach(() => {
  editorState.documentId = 'doc-a';
  editorState.loadingDocumentId = null;
});

afterEach(() => {
  vi.useRealTimers();
  cleanup();
});

describe('DocumentLoadingBoundary', () => {
  it('shows hydration skeleton immediately and exposes one stable busy region', () => {
    editorState.loadingDocumentId = 'shared-doc';
    const { regionRef } = renderBoundary();

    expect(screen.getByTestId('document-skeleton')).toBeTruthy();
    expect(regionRef.current?.getAttribute('aria-busy')).toBe('true');
    expect(screen.getByRole('status').textContent).toBe('Opening document…');
    const committedLayer = screen.getByTestId('committed-canvas').parentElement;
    expect(committedLayer?.hasAttribute('inert')).toBe(true);
    expect(committedLayer?.getAttribute('aria-hidden')).toBe('true');
  });

  it('freezes immediately but delays the skeleton for an in-app switch', () => {
    vi.useFakeTimers();
    const view = renderBoundary();

    editorState.loadingDocumentId = 'doc-b';
    view.rerender(
      <DocumentLoadingBoundary regionRef={view.regionRef}>
        <div className="canvas" data-testid="committed-canvas">
          <button type="button">Old document control</button>
        </div>
      </DocumentLoadingBoundary>,
    );

    expect(screen.queryByTestId('document-skeleton')).toBeNull();
    expect(screen.getByTestId('committed-canvas').parentElement?.hasAttribute('inert')).toBe(true);
    act(() => vi.advanceTimersByTime(149));
    expect(screen.queryByTestId('document-skeleton')).toBeNull();
    act(() => vi.advanceTimersByTime(1));
    expect(screen.getByTestId('document-skeleton')).toBeTruthy();
  });

  it('restores focus and scroll after failure, but resets them after a commit', () => {
    vi.useFakeTimers();
    const view = renderBoundary();
    const canvas = screen.getByTestId('committed-canvas');
    const button = screen.getByRole('button', { name: 'Old document control' });
    canvas.scrollTop = 240;
    button.focus();

    editorState.loadingDocumentId = 'doc-b';
    view.rerender(
      <DocumentLoadingBoundary regionRef={view.regionRef}>
        <div className="canvas" data-testid="committed-canvas">
          <button type="button">Old document control</button>
        </div>
      </DocumentLoadingBoundary>,
    );
    act(() => vi.advanceTimersByTime(150));
    editorState.loadingDocumentId = null;
    view.rerender(
      <DocumentLoadingBoundary regionRef={view.regionRef}>
        <div className="canvas" data-testid="committed-canvas">
          <button type="button">Old document control</button>
        </div>
      </DocumentLoadingBoundary>,
    );

    expect(canvas.scrollTop).toBe(240);
    expect(document.activeElement).toBe(button);

    editorState.loadingDocumentId = 'doc-c';
    view.rerender(
      <DocumentLoadingBoundary regionRef={view.regionRef}>
        <div className="canvas" data-testid="committed-canvas">
          <button type="button">Old document control</button>
        </div>
      </DocumentLoadingBoundary>,
    );
    canvas.scrollTop = 180;
    editorState.documentId = 'doc-c';
    editorState.loadingDocumentId = null;
    view.rerender(
      <DocumentLoadingBoundary regionRef={view.regionRef}>
        <div className="canvas" data-testid="committed-canvas">
          <button type="button">Old document control</button>
        </div>
      </DocumentLoadingBoundary>,
    );

    expect(canvas.scrollTop).toBe(0);
  });
});
