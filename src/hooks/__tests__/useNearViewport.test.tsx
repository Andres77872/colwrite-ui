import { useRef } from 'react';
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useNearViewport } from '../useNearViewport';

/** The browser's observer, with the notice given by hand. */
class FakeObserver {
  static made: FakeObserver[] = [];
  readonly targets = new Set<Element>();
  readonly options: IntersectionObserverInit;
  private readonly callback: IntersectionObserverCallback;
  disconnected = false;

  constructor(callback: IntersectionObserverCallback, options: IntersectionObserverInit = {}) {
    this.callback = callback;
    this.options = options;
    FakeObserver.made.push(this);
  }

  observe(el: Element) {
    this.targets.add(el);
  }

  unobserve(el: Element) {
    this.targets.delete(el);
  }

  disconnect() {
    this.disconnected = true;
    this.targets.clear();
  }

  report(el: Element, isIntersecting: boolean) {
    const entry = { target: el, isIntersecting } as IntersectionObserverEntry;
    this.callback([entry], this as unknown as IntersectionObserver);
  }
}

function Row({ name, scroller }: { name: string; scroller?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const near = useNearViewport(ref, scroller);
  return (
    <div ref={ref} data-testid={name}>
      {near ? 'mounted' : 'waiting'}
    </div>
  );
}

function observing(): FakeObserver[] {
  return FakeObserver.made.filter((observer) => !observer.disconnected);
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  FakeObserver.made = [];
});

describe('useNearViewport', () => {
  it('answers true at once where intersections cannot be observed', () => {
    render(<Row name="a" />);

    expect(screen.getByTestId('a').textContent).toBe('mounted');
  });

  it('waits for the element to come near, then stays', () => {
    vi.stubGlobal('IntersectionObserver', FakeObserver);
    render(<Row name="a" />);
    const row = screen.getByTestId('a');
    const [observer] = observing();
    expect(row.textContent).toBe('waiting');

    // The first notice of an element far away says so, and changes nothing.
    act(() => observer?.report(row, false));
    expect(row.textContent).toBe('waiting');

    act(() => observer?.report(row, true));
    expect(row.textContent).toBe('mounted');
    // Nothing left to watch for, here or anywhere.
    expect(observing()).toEqual([]);
  });

  it('watches everything inside one scroller with one observer, a scroller height around it', () => {
    vi.stubGlobal('IntersectionObserver', FakeObserver);
    render(
      <div className="scroller" data-testid="scroller">
        <Row name="a" scroller=".scroller" />
        <Row name="b" scroller=".scroller" />
      </div>,
    );
    const [observer, ...others] = observing();

    expect(others).toEqual([]);
    expect(observer?.options.root).toBe(screen.getByTestId('scroller'));
    expect(observer?.options.rootMargin).toBe('100% 0px');
    expect([...(observer?.targets ?? [])]).toEqual([screen.getByTestId('a'), screen.getByTestId('b')]);

    act(() => observer?.report(screen.getByTestId('b'), true));
    expect(screen.getByTestId('a').textContent).toBe('waiting');
    expect(screen.getByTestId('b').textContent).toBe('mounted');
    // Still watching the other one.
    expect([...(observer?.targets ?? [])]).toEqual([screen.getByTestId('a')]);
  });

  it('watches against the window when there is no such scroller', () => {
    vi.stubGlobal('IntersectionObserver', FakeObserver);
    render(<Row name="a" scroller=".scroller" />);

    expect(observing()[0]?.options.root).toBeNull();
  });

  it('stops watching an element that goes away', () => {
    vi.stubGlobal('IntersectionObserver', FakeObserver);
    const view = render(<Row name="a" />);
    expect(observing()).toHaveLength(1);

    view.unmount();

    expect(observing()).toEqual([]);
  });
});
