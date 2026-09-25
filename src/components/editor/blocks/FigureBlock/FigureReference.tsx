import { useTheme } from '@/lib/theme';
import { figurePalette } from '@/lib/figure/palette';
import { ROLES, SHAPES, TONES } from '@/lib/figure/vocabulary';

const EDGE_SYNTAX: ReadonlyArray<[string, string]> = [
  ['"a -> b"', 'arrow'],
  ['"a, b -> c"', 'several sources'],
  ['"a -> b -> c"', 'chain'],
  ['"a -> b: label"', 'labelled'],
  ['"a --> b"  "a ..> b"', 'dashed, dotted'],
  ['"a => b"  "a <-> b"  "a -- b"', 'thick, both ends, no arrow'],
  ['"a.right -> b.left"', 'pinned sides'],
  ['{"from": "x", "to": "add", "kind": "residual"}', 'skip connection'],
];

const GROUP_KEYS: ReadonlyArray<[string, string]> = [
  ['"children": [...]', 'nodes inside a titled box'],
  ['"layout": "flow" | "row" | "column" | "grid"', 'how children are arranged'],
  ['"direction": "up" | "down" | "right" | "left"', 'flow direction'],
  ['"uniform": true', 'equal-width stack'],
  ['"repeat": "N×"', 'repetition marker'],
  ['"panel": true', 'sub-figure (a), (b)…'],
];

const NODE_KEYS: ReadonlyArray<[string, string]> = [
  ['"label": "$\\\\mathbf{h}_t$"', 'maths: double every backslash'],
  ['"sublabel": "$B\\\\times d$"', 'small second line'],
  ['"border": "dashed"', 'optional step'],
  ['"pattern": "hatch"', 'cached or frozen'],
  ['"stack": 3, "repeat": "h"', 'several heads or experts'],
  ['"beside": "add1"', 'side input on the same layer'],
  ['"shape": "tensor", "cells": [4, 4], "mask": "causal"', 'grid of cells'],
];

function Rows({ rows }: { rows: ReadonlyArray<[string, string]> }) {
  return (
    <dl className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-1">
      {rows.map(([code, meaning]) => (
        <div key={code} className="contents">
          <dt className="min-w-0 break-words font-mono text-2xs text-foreground">{code}</dt>
          <dd className="text-2xs text-muted-foreground">{meaning}</dd>
        </div>
      ))}
    </dl>
  );
}

/**
 * The spec at a glance, inside the figure editor: roles with the swatch each
 * one draws, the edge shorthand, and the keys people reach for most. The
 * full language is in `docs/figures.md`.
 */
export function FigureReference() {
  const { resolved } = useTheme();
  const palette = figurePalette(resolved, 'color');
  return (
    <div className="max-h-[60vh] space-y-3 overflow-y-auto pr-1 text-xs">
      <section>
        <h3 className="mb-1.5 text-xs font-semibold">Roles — the preferred way to style a node</h3>
        <ul className="grid grid-cols-2 gap-x-3 gap-y-1">
          {ROLES.map((role) => {
            const tone = palette.tones[role.tone];
            return (
              <li key={role.id} className="flex items-center gap-1.5" title={role.description}>
                <span
                  aria-hidden="true"
                  className="h-3 w-4 shrink-0 rounded-[3px] border"
                  style={{
                    background: role.shape === 'text' ? 'transparent' : tone.fill,
                    borderColor: role.shape === 'text' ? 'transparent' : tone.stroke,
                    borderRadius: role.shape === 'op' || role.shape === 'circle' ? 999 : undefined,
                  }}
                />
                <span className="font-mono text-2xs">{role.id}</span>
              </li>
            );
          })}
        </ul>
      </section>
      <section>
        <h3 className="mb-1.5 text-xs font-semibold">Edges</h3>
        <Rows rows={EDGE_SYNTAX} />
      </section>
      <section>
        <h3 className="mb-1.5 text-xs font-semibold">Nodes</h3>
        <Rows rows={NODE_KEYS} />
      </section>
      <section>
        <h3 className="mb-1.5 text-xs font-semibold">Groups</h3>
        <Rows rows={GROUP_KEYS} />
      </section>
      <section className="text-2xs text-muted-foreground">
        <p>
          <span className="font-medium text-foreground">Shapes:</span> {SHAPES.join(', ')}
        </p>
        <p className="mt-1">
          <span className="font-medium text-foreground">Tones:</span> {TONES.join(', ')}
        </p>
        <p className="mt-1">
          Top level: <code>caption</code>, <code>label</code>, <code>direction</code>, <code>size</code> (small · medium ·
          large · full), <code>palette</code> (color · mono), <code>font</code> (sans · serif), <code>legend</code>.
        </p>
      </section>
    </div>
  );
}
