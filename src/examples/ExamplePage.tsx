import { lazy, Suspense, useLayoutEffect, useRef, useState, type ComponentType } from 'react';
import { RotateCcw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ErrorBoundary } from '@/components/common/ErrorBoundary';
import { examples, type ExampleId } from './catalog';
import { OverviewExample, FigureExample, EditorExample } from './ManuscriptExamples';

const components: Record<ExampleId | 'paper', ComponentType> = {
  overview: OverviewExample,
  figures: FigureExample,
  editor: EditorExample,
  research: lazy(() => import('./ResearchExamples').then((m) => ({ default: m.ResearchExample }))),
  library: lazy(() => import('./ResearchExamples').then((m) => ({ default: m.LibraryExample }))),
  'ai-actions': lazy(() => import('./WorkspaceExamples').then((m) => ({ default: m.AssistantExample }))),
  workspaces: lazy(() => import('./WorkspaceExamples').then((m) => ({ default: m.WorkspaceExample }))),
  review: lazy(() => import('./RevisionExamples').then((m) => ({ default: m.ReviewExample }))),
  history: lazy(() => import('./RevisionExamples').then((m) => ({ default: m.HistoryExample }))),
  export: lazy(() => import('./ExportExample').then((m) => ({ default: m.ExportExample }))),
  paper: lazy(() => import('./ExportExample').then((m) => ({ default: m.SamplePaper }))),
};

export function ExamplePage({ id }: { id: ExampleId | 'paper' }) {
  const [version, reset] = useState(0);
  const Component = components[id];
  const container = useRef<HTMLElement>(null);
  useLayoutEffect(() => {
    const host = container.current;
    const frame = window.frameElement;
    if (!host || !frame?.hasAttribute('data-colwrite-example') || id === 'paper') return;
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
    <main ref={container} className={id === 'paper' ? 'paper-host' : 'example-host'}>
      {id !== 'paper' && (
        <header className="example-header">
          <h1>{examples[id].title}</h1>
          {id !== 'overview' && (
            <Button size="sm" variant="ghost" onClick={() => reset((n) => n + 1)}>
              <RotateCcw aria-hidden="true" />
              Reset
            </Button>
          )}
        </header>
      )}
      <div className={id === 'paper' ? undefined : 'example-body'}>
        <ErrorBoundary label="this example">
          <Suspense fallback={<p role="status">Opening example…</p>}>
            <Component key={version} />
          </Suspense>
        </ErrorBoundary>
      </div>
    </main>
  );
}
