import { ErrorBoundary, PanelHeader } from 'colwrite-ui';
import { FileText, Library } from 'lucide-react';

// The boundary is invisible until a child throws, so two of these cells contain
// a child that throws during render — that is what puts the real fallback on
// screen. React logs the caught error to the console; that noise is expected.
// The `label` values are the app's own ("the editor", "this panel").

function Boom({ message }: { message: string }): never {
  throw new Error(message);
}

export function CaughtInTheEditor() {
  return (
    <div className="flex h-64 w-full max-w-xl flex-col overflow-hidden rounded-xl border border-border/60 bg-card">
      <ErrorBoundary label="the editor">
        <Boom message="Cannot read properties of null (reading 'blocks')" />
      </ErrorBoundary>
    </div>
  );
}

export function CaughtInAPanel() {
  return (
    <div className="flex h-64 w-80 flex-col overflow-hidden rounded-xl border border-border/60 bg-card">
      <PanelHeader title="Library" icon={<Library aria-hidden="true" className="h-4 w-4" />} />
      <ErrorBoundary label="this panel">
        <Boom message="Unexpected end of JSON input" />
      </ErrorBoundary>
    </div>
  );
}

export function PassThrough() {
  return (
    <div className="flex h-64 w-80 flex-col overflow-hidden rounded-xl border border-border/60 bg-card">
      <PanelHeader title="Documents" icon={<FileText aria-hidden="true" className="h-4 w-4" />} />
      <ErrorBoundary label="the sidebar">
        <ul className="min-h-0 flex-1 space-y-1 overflow-y-auto p-2">
          {[
            'Attention Is All You Need, Revisited',
            'Scaling notes',
            'Related work',
            'Reviewer replies — NeurIPS',
          ].map((name, index) => (
            <li
              key={name}
              className={`flex items-center gap-2 rounded-md px-2 py-1.5 text-sm ${
                index === 0 ? 'bg-accent text-foreground' : 'text-muted-foreground'
              }`}
            >
              <FileText aria-hidden="true" className="h-4 w-4 shrink-0" />
              <span className="truncate">{name}</span>
            </li>
          ))}
        </ul>
      </ErrorBoundary>
    </div>
  );
}
