import { Suspense, useLayoutEffect, useRef, useState, type ComponentType } from 'react';
import { RotateCcw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ErrorBoundary } from '@/components/common/ErrorBoundary';
import { useForcedTheme, type ResolvedTheme } from '@/lib/theme';
import { examples, type ExampleId } from './catalog';
import {
  ChartExample,
  CitationsExample,
  DiagramExample,
  EquationExample,
  FigureExample,
  TableExample,
} from './BlockExamples';

const components: Record<ExampleId, ComponentType> = {
  equation: EquationExample,
  table: TableExample,
  chart: ChartExample,
  diagram: DiagramExample,
  figure: FigureExample,
  citations: CitationsExample,
};

/** Pins the embedding page's appearance while the example is open. */
function PinTheme({ theme }: { theme: ResolvedTheme }) {
  useForcedTheme(theme);
  return null;
}

export function ExamplePage({ id, theme }: { id: ExampleId; theme?: ResolvedTheme }) {
  const [version, reset] = useState(0);
  const Component = components[id];
  const container = useRef<HTMLElement>(null);
  useLayoutEffect(() => {
    const host = container.current;
    const frame = window.frameElement;
    if (!host || !frame?.hasAttribute('data-colwrite-example')) return;
    const element = frame as HTMLIFrameElement;
    const fit = () => {
      element.style.height =
        Math.min(640, Math.max(examples[id].height, Math.ceil(host.getBoundingClientRect().height) + 2)) +
        'px';
    };
    const observer = new ResizeObserver(fit);
    observer.observe(host);
    fit();
    return () => observer.disconnect();
  }, [id]);
  return (
    <main ref={container} className="example-host">
      {theme && <PinTheme theme={theme} />}
      <header className="example-header">
        <h1>{examples[id].title}</h1>
        <Button size="sm" variant="ghost" onClick={() => reset((n) => n + 1)}>
          <RotateCcw aria-hidden="true" />
          Reset
        </Button>
      </header>
      <div className="example-body">
        <ErrorBoundary label="this example">
          <Suspense fallback={<p role="status">Opening example…</p>}>
            <Component key={version} />
          </Suspense>
        </ErrorBoundary>
      </div>
    </main>
  );
}
