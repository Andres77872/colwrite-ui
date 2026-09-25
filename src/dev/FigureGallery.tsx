/**
 * Every structured-figure template drawn by the real renderer, plus a
 * playground to paste a spec into. Development only (`figure-gallery.html`):
 * for checking layout and routing by eye, in both themes and in print.
 */
import { useMemo, useState } from 'react';
import { StructuredFigure } from '@/components/common/StructuredFigure';
import { FIGURE_TEMPLATES } from '@/lib/figure/templates';
import type { CompiledFigure } from '@/lib/figure/types';

function Diagnostics({ compiled }: { compiled: CompiledFigure | null }) {
  if (!compiled || compiled.diagnostics.length === 0) return null;
  return (
    <ul className="mt-3 space-y-0.5 font-mono text-2xs text-muted-foreground" data-testid="diagnostics">
      {compiled.diagnostics.map((diagnostic, index) => (
        <li key={index}>
          [{diagnostic.severity}] {diagnostic.code}
          {diagnostic.line !== undefined ? ` @${diagnostic.line}:${diagnostic.column}` : ''} — {diagnostic.message}
        </li>
      ))}
    </ul>
  );
}

type Look = { theme: 'light' | 'dark'; scale: number };

function Card({ id, title, source, number, look }: { id: string; title: string; source: string; number: number; look: Look }) {
  const [compiled, setCompiled] = useState<CompiledFigure | null>(null);
  const size = compiled?.scene ? `${Math.round(compiled.scene.width)}×${Math.round(compiled.scene.height)}px` : '';
  return (
    <section id={id} className="gallery-card break-inside-avoid rounded-lg border border-border bg-background p-6">
      <h2 className="mb-4 flex items-baseline justify-between text-sm font-semibold">
        {title}
        <span className="font-mono text-2xs font-normal text-muted-foreground">
          {id} {size}
        </span>
      </h2>
      <div style={{ zoom: look.scale }}>
        <StructuredFigure source={source} number={number} actions theme={look.theme} onCompiled={setCompiled} />
      </div>
      <Diagnostics compiled={compiled} />
    </section>
  );
}

function Playground({ look }: { look: Look }) {
  const [source, setSource] = useState(FIGURE_TEMPLATES[0]?.source ?? '');
  const [compiled, setCompiled] = useState<CompiledFigure | null>(null);
  return (
    <section id="playground" className="grid gap-4 rounded-lg border border-border bg-background p-6 lg:grid-cols-2">
      <textarea
        aria-label="Figure spec"
        value={source}
        onChange={(event) => setSource(event.target.value)}
        spellCheck={false}
        className="min-h-[28rem] rounded-md bg-code-bg p-3 font-mono text-xs"
      />
      <div>
        <StructuredFigure source={source} delay={200} actions theme={look.theme} onCompiled={setCompiled} />
        <Diagnostics compiled={compiled} />
      </div>
    </section>
  );
}

export function FigureGallery() {
  const [dark, setDark] = useState(false);
  const params = useMemo(() => new URLSearchParams(window.location.search), []);
  const only = params.get('only');
  // `?scale=2` enlarges every figure, for inspecting routes and labels closely.
  const look: Look = { theme: dark ? 'dark' : 'light', scale: Number(params.get('scale')) || 1 };
  const templates = only ? FIGURE_TEMPLATES.filter((template) => template.id === only) : FIGURE_TEMPLATES;
  return (
    <div data-theme={dark ? 'dark' : undefined} className="min-h-screen bg-muted p-6 text-foreground">
      <header className="mx-auto mb-6 flex max-w-3xl items-center justify-between print:hidden">
        <h1 className="text-lg font-semibold">Structured figure gallery</h1>
        <button type="button" className="rounded-md bg-background px-3 py-1 text-sm ring-1 ring-border" onClick={() => setDark((value) => !value)}>
          {dark ? 'Light' : 'Dark'}
        </button>
      </header>
      <main className="mx-auto max-w-5xl space-y-6">
        {templates.map((template, index) => (
          <Card key={template.id} id={template.id} title={template.label} source={template.source} number={index + 1} look={look} />
        ))}
        {!only && <Playground look={look} />}
      </main>
    </div>
  );
}

