import { useState } from 'react';
import { PanelHeader, ResizeHandle } from 'colwrite-ui';
import { FileText, Library, MessageSquare } from 'lucide-react';

// The handle is a 12px gutter holding a 4px pill, so it only reads as an
// affordance between two real panel surfaces. Each cell is the gutter as
// AppShell uses it, with live state so `value`/`min`/`max` are the true numbers
// the separator reports. Bounds come from PANEL_CONFIG: left 200–400,
// right 280–640.

const PANEL_SURFACE = 'overflow-hidden rounded-xl border border-border/60 bg-card';

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function DocumentList() {
  return (
    <ul className="space-y-1 p-2">
      {['Attention Is All You Need, Revisited', 'Scaling notes', 'Related work'].map(
        (name, index) => (
          <li
            key={name}
            className={`flex items-center gap-2 rounded-md px-2 py-1.5 text-sm ${
              index === 0 ? 'bg-accent text-foreground' : 'text-muted-foreground'
            }`}
          >
            <FileText aria-hidden="true" className="h-4 w-4 shrink-0" />
            <span className="truncate">{name}</span>
          </li>
        ),
      )}
    </ul>
  );
}

function Canvas() {
  return (
    <div className="p-4">
      <h1 className="text-lg font-semibold">Attention Is All You Need, Revisited</h1>
      <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
        We revisit the original transformer formulation under modern training budgets and show
        that the reported scaling behaviour holds only once the learning-rate schedule is
        decoupled from the batch size.
      </p>
    </div>
  );
}

export function SidebarGutter() {
  const [width, setWidth] = useState(260);
  return (
    <div className="flex h-56 w-full max-w-3xl items-stretch">
      <nav style={{ width }} className={`shrink-0 ${PANEL_SURFACE}`}>
        <PanelHeader title="Documents" icon={<FileText aria-hidden="true" className="h-4 w-4" />} />
        <DocumentList />
      </nav>
      <ResizeHandle
        direction="horizontal"
        onResize={(delta) => setWidth((prev) => clamp(prev + delta, 200, 400))}
        label="Resize sidebar"
        value={width}
        min={200}
        max={400}
      />
      <main className={`min-w-0 flex-1 ${PANEL_SURFACE}`}>
        <Canvas />
      </main>
    </div>
  );
}

export function ToolsPanelGutter() {
  const [width, setWidth] = useState(300);
  return (
    <div className="flex h-56 w-full max-w-3xl items-stretch">
      <main className={`min-w-0 flex-1 ${PANEL_SURFACE}`}>
        <Canvas />
      </main>
      <ResizeHandle
        direction="horizontal"
        // The right panel grows as the handle moves left, hence the inverted delta.
        onResize={(delta) => setWidth((prev) => clamp(prev - delta, 280, 640))}
        label="Resize tools panel"
        value={width}
        min={280}
        max={640}
      />
      <aside style={{ width }} className={`shrink-0 ${PANEL_SURFACE}`}>
        <PanelHeader title="Library" icon={<Library aria-hidden="true" className="h-4 w-4" />} />
        <ul className="space-y-1 p-2">
          {['attention-2017.pdf', 'scaling-laws-2020.pdf', 'chinchilla-2022.pdf'].map((file) => (
            <li key={file} className="truncate rounded-md px-2 py-1.5 text-sm text-muted-foreground">
              {file}
            </li>
          ))}
        </ul>
      </aside>
    </div>
  );
}

export function VerticalGutter() {
  const [height, setHeight] = useState(120);
  return (
    <div className="flex h-64 w-full max-w-xl flex-col">
      <div className={`min-h-0 flex-1 ${PANEL_SURFACE}`}>
        <Canvas />
      </div>
      <ResizeHandle
        direction="vertical"
        onResize={(delta) => setHeight((prev) => clamp(prev - delta, 96, 240))}
        label="Resize assistant transcript"
        value={height}
        min={96}
        max={240}
      />
      <section style={{ height }} className={`shrink-0 ${PANEL_SURFACE}`}>
        <PanelHeader
          title="Assistant"
          icon={<MessageSquare aria-hidden="true" className="h-4 w-4" />}
        />
        <p className="p-3 text-sm text-muted-foreground">
          Ask for a tighter abstract, or a citation for the scaling claim.
        </p>
      </section>
    </div>
  );
}
