import type React from 'react';
import { useEffect, useMemo, useRef, useState, type MutableRefObject } from 'react';
import type { ParagraphChild } from '../../../../../../editor';
import { serializeEditableHtml } from '../../../../../../components/common/Editable/Editable';

// Resolve a CSS variable to its computed value (with optional fallback)
const cssVar = (name: string, fallback?: string): string => {
  try {
    const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    return v || (fallback || '');
  } catch {
    return fallback || '';
  }
};

// Convert hex color (#rrggbb) to rgba string with given alpha
const hexToRgba = (hex: string, alpha = 1): string => {
  const m = hex?.trim().match(/^#?([\da-f]{2})([\da-f]{2})([\da-f]{2})$/i);
  if (!m) return hex || '';
  const r = parseInt(m[1], 16);
  const g = parseInt(m[2], 16);
  const b = parseInt(m[3], 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
};

export function GraphInline({
  blockId,
  child,
  updateParagraphChild,
  removeParagraphChild,
  updateHtml,
  refs,
}: {
  blockId: string;
  child: ParagraphChild;
  updateParagraphChild: (blockId: string, childId: string, next: Partial<ParagraphChild>) => void;
  removeParagraphChild: (blockId: string, childId: string) => void;
  updateHtml: (id: string, html: string) => void;
  refs: MutableRefObject<Record<string, HTMLDivElement | null>>;
}) {
  if (child.type !== 'graph') return null;

  const [kind, setKind] = useState(child.kind || 'bar');
  const [valuesStr, setValuesStr] = useState((child.data?.values || []).join(', '));
  const [labelsStr, setLabelsStr] = useState((child.data?.labels || []).join(', '));
  const [colorsStr, setColorsStr] = useState((child.data?.colors || []).join(', '));
  const [title, setTitle] = useState(child.title || '');
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const rootRef = useRef<HTMLSpanElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const chartRef = useRef<any>(null);
  const pillCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const pillChartRef = useRef<any>(null);
  const initialRef = useRef({
    kind: child.kind,
    valuesStr: (child.data?.values || []).join(', '),
    labelsStr: (child.data?.labels || []).join(', '),
    colorsStr: (child.data?.colors || []).join(', '),
    title: child.title || '',
  });

  // Sync identity changes
  useEffect(() => {
    setKind(child.kind || 'bar');
    setValuesStr((child.data?.values || []).join(', '));
    setLabelsStr((child.data?.labels || []).join(', '));
    setColorsStr((child.data?.colors || []).join(', '));
    setTitle(child.title || '');
    initialRef.current = {
      kind: child.kind,
      valuesStr: (child.data?.values || []).join(', '),
      labelsStr: (child.data?.labels || []).join(', '),
      colorsStr: (child.data?.colors || []).join(', '),
      title: child.title || '',
    };
  }, [child.id]);

  // Outside click closes the popover
  useEffect(() => {
    if (!open) return;
    const onDocMouseDown = (e: MouseEvent) => {
      const t = e.target as HTMLElement | null;
      const inside = !!t && !!rootRef.current && rootRef.current.contains(t);
      if (!inside) setOpen(false);
    };
    document.addEventListener('mousedown', onDocMouseDown, true);
    return () => document.removeEventListener('mousedown', onDocMouseDown, true);
  }, [open]);

  // Parse helpers
  const parseNumbers = (s: string): number[] =>
    s
      .split(/[,;\n\s]+/)
      .map(x => x.trim())
      .filter(Boolean)
      .map(Number)
      .filter(n => Number.isFinite(n));
  const parseStrings = (s: string): string[] =>
    s
      .split(/[,;\n]+/)
      .map(x => x.trim())
      .filter(Boolean);

  const values = useMemo(() => parseNumbers(valuesStr), [valuesStr]);
  const labels = useMemo(() => parseStrings(labelsStr), [labelsStr]);
  const colors = useMemo(() => parseStrings(colorsStr), [colorsStr]);

  // Validation
  useEffect(() => {
    let err: string | null = null;
    if (values.length === 0) err = 'Enter at least 1 value';
    if (values.length > 12) err = 'Limit values to 12';
    if (!err && labels.length && labels.length !== values.length) err = 'Labels must match values length';
    if (!err && colors.length && colors.length !== values.length) err = 'Colors must match values length';
    if (!err && kind === 'pie') {
      if (values.some(v => v < 0)) err = 'Pie values must be non-negative';
      if (!err && values.every(v => v === 0)) err = 'Pie values cannot be all zero';
    }
    setError(err);
  }, [values, labels, colors, kind]);

  // Debounced persistence
  useEffect(() => {
    const id = window.setTimeout(() => {
      if (error) return;
      const next: any = {
        ...(child as any),
        kind,
        data: { values, labels: labels.length ? labels : undefined, colors: colors.length ? colors : undefined },
        title: title || undefined,
      };
      if (JSON.stringify(child) !== JSON.stringify(next)) {
        updateParagraphChild(blockId, child.id, {
          kind: kind as any,
          data: { values, labels: labels.length ? labels : undefined, colors: colors.length ? colors : undefined } as any,
          title: title || undefined,
        } as any);
      }
    }, 80);
    return () => window.clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind, valuesStr, labelsStr, colorsStr, title, error]);

  // Chart.js optional preview
  const [chartReady, setChartReady] = useState(() => !!(typeof window !== 'undefined' && (window as any)?.Chart));
  useEffect(() => {
    if (chartReady) return;
    let timer: number | null = null;
    let tries = 0;
    const check = () => {
      if ((window as any)?.Chart) { setChartReady(true); return; }
      if (tries++ < 40) { timer = window.setTimeout(check, 150); }
    };
    check();
    return () => { if (timer) window.clearTimeout(timer); };
  }, [chartReady]);
  useEffect(() => {
    if (!open) return;
    if (!chartReady) return;
    const Canvas = canvasRef.current;
    if (!Canvas) return;
    const Chart = (window as any).Chart;
    try {
      const data = {
        labels: labels.length ? labels : values.map((_, i) => String(i + 1)),
        datasets: [
          {
            label: title || 'Graph',
            data: values,
            backgroundColor: kind === 'pie' ? (colors.length ? colors : undefined) : (colors[0] || hexToRgba(cssVar('--color-chart-1'), 0.6)),
            borderColor: kind === 'line' ? (colors[0] || cssVar('--color-chart-1')) : undefined,
          },
        ],
      };
      const type = kind === 'bar' ? 'bar' : (kind === 'line' ? 'line' : 'pie');
      chartRef.current?.destroy?.();
      chartRef.current = new Chart(Canvas, { type, data, options: { responsive: false, plugins: { legend: { display: false } }, scales: kind === 'pie' ? undefined : { x: { display: false }, y: { display: false } } } });
    } catch {}
    return () => {
      try { chartRef.current?.destroy?.(); } catch {}
      chartRef.current = null;
    };
    // values, labels, colors, title, kind change should re-render
  }, [open, chartReady, values, labels, colors, title, kind]);

  // Inline figure chart (always rendered when available)
  useEffect(() => {
    if (!chartReady) return;
    const Canvas = pillCanvasRef.current;
    if (!Canvas) return;
    const Chart = (window as any).Chart;
    try {
      const data = {
        labels: labels.length ? labels : values.map((_, i) => String(i + 1)),
        datasets: [
          {
            label: '',
            data: values,
            backgroundColor: kind === 'pie' ? (colors.length ? colors : undefined) : (colors[0] || hexToRgba(cssVar('--color-chart-1', '#2563eb'), 0.6)),
            borderColor: kind === 'line' ? (colors[0] || cssVar('--color-chart-1', '#2563eb')) : undefined,
          },
        ],
      };
      const type = kind === 'bar' ? 'bar' : (kind === 'line' ? 'line' : 'pie');
      pillChartRef.current?.destroy?.();
      pillChartRef.current = new Chart(Canvas, {
        type,
        data,
        options: {
          responsive: false,
          maintainAspectRatio: false,
          plugins: {
            legend: { display: kind === 'pie' },
            tooltip: { enabled: false },
            title: { display: false },
          },
          scales: kind === 'pie' ? undefined : {
            x: { display: true, grid: { display: false } },
            y: { display: true, grid: { color: cssVar('--color-border') } },
          },
          elements: { point: { radius: 2 } },
        },
      });
    } catch {}
    return () => {
      try { pillChartRef.current?.destroy?.(); } catch {}
      pillChartRef.current = null;
    };
  }, [chartReady, values, labels, colors, kind]);

  const capKind = useMemo(() => (kind === 'bar' ? 'Bar' : (kind === 'line' ? 'Line' : 'Pie')), [kind]);

  const onRemove = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const host = refs.current[blockId];
    const el = host?.querySelector(`[data-child-id="${child.id}"]`);
    el?.parentNode?.removeChild(el as any);
    removeParagraphChild(blockId, child.id);
    const editable = refs.current[blockId];
    if (editable) updateHtml(blockId, serializeEditableHtml(editable));
  };

  // Fallback preview in editor popover: simple inline bars
  const fallbackBars = useMemo(() => {
    if (!values.length) return null;
    const max = Math.max(...values.map(v => Math.abs(v))) || 1;
    const width = 140;
    const height = 40;
    const barW = Math.max(4, Math.floor(width / Math.max(values.length * 1.5, 1)));
    const gap = 2;
    return (
      <svg className="block" width={width} height={height} aria-hidden>
        {values.map((v, i) => {
          const h = Math.round((Math.abs(v) / max) * (height - 6));
          const x = i * (barW + gap);
          const y = height - h - 2;
          const fill = colors[i] || 'var(--color-chart-1)';
          return <rect key={i} x={x} y={y} width={barW} height={h} fill={fill} rx={2} ry={2} />;
        })}
      </svg>
    );
  }, [values, colors]);

  // Figure-grade SVG fallbacks when Chart.js is not available
  const figureFallbackBarLine = useMemo(() => {
    if (!values.length) return null;
    const width = 420, height = 240;
    const ml = 36, mr = 10, mt = 8, mb = 28;
    const plotW = width - ml - mr;
    const plotH = height - mt - mb;
    let minV = Math.min(0, ...values);
    let maxV = Math.max(0, ...values);
    if (minV === maxV) { minV = 0; maxV = minV + 1; }
    const y = (v: number) => mt + plotH - ((v - minV) / (maxV - minV)) * plotH;
    const ticks = Array.from({ length: 5 }, (_, i) => minV + (i * (maxV - minV)) / 4);
    const tickY = (t: number) => y(t);
    const n = values.length;
    const step = plotW / n;
    const barW = Math.max(6, Math.floor(step * 0.6));
    const zeroY = y(0);
    const barRects = kind === 'bar' ? values.map((v, i) => {
      const x = ml + i * step + (step - barW) / 2;
      const yv = y(Math.max(v, 0));
      const yb = y(Math.min(v, 0));
      const h = Math.max(2, Math.abs(yb - yv));
      const fill = colors[i] || 'var(--color-chart-1)';
      return <rect key={i} x={Math.round(x)} y={Math.round(Math.min(yv, yb))} width={barW} height={Math.round(h)} fill={fill} rx={2} ry={2} />;
    }) : null;
    let linePts = '';
    if (kind === 'line') {
      const pts = values.map((v, i) => {
        const x = ml + i * step + step / 2;
        return `${Math.round(x)},${Math.round(y(v))}`;
      });
      linePts = pts.join(' ');
    }
    const stroke = colors[0] || 'var(--color-chart-1)';
    return (
      <svg className="block w-full h-auto" width={width} height={height} aria-label="Graph">
        <rect x="0" y="0" width={width} height={height} fill="var(--color-card)" />
        {/* grid */}
        {ticks.map((t, i) => (
          <line key={`g${i}`} x1={ml} y1={Math.round(tickY(t))} x2={width - mr} y2={Math.round(tickY(t))} stroke="var(--color-border)" strokeWidth="1" />
        ))}
        {/* axes */}
        <line x1={ml} y1={mt} x2={ml} y2={height - mb} stroke="var(--color-foreground)" strokeWidth="1" />
        <line x1={ml} y1={height - mb} x2={width - mr} y2={height - mb} stroke="var(--color-foreground)" strokeWidth="1" />
        {/* zero line */}
        {minV < 0 && maxV > 0 ? <line x1={ml} y1={Math.round(zeroY)} x2={width - mr} y2={Math.round(zeroY)} stroke="var(--color-border)" strokeDasharray="4 3" /> : null}
        {/* series */}
        {kind === 'bar' ? barRects : (
          <polyline fill="none" stroke={stroke} strokeWidth="2" points={linePts} strokeLinejoin="round" strokeLinecap="round" />
        )}
        {/* x tick labels if labels present */}
        {labels.length ? labels.map((lab, i) => {
          const x = ml + i * step + step / 2;
          return <text key={`xl${i}`} x={Math.round(x)} y={height - 10} textAnchor="middle" fontSize="11" fill="var(--color-muted-foreground)">{lab}</text>;
        }) : null}
        {/* y axis labels */}
        {ticks.map((t, i) => (
          <text key={`yl${i}`} x={ml - 6} y={Math.round(tickY(t))} textAnchor="end" dy="0.35em" fontSize="11" fill="var(--color-muted-foreground)">{Number(t.toFixed(2)).toString()}</text>
        ))}
      </svg>
    );
  }, [values, labels, colors, kind]);

  const figureFallbackPie = useMemo(() => {
    if (!values.length) return null;
    const width = 420, height = 240;
    const cx = 150, cy = 120, r = 90;
    const sum = values.reduce((a, b) => a + Math.max(0, b), 0);
    if (sum <= 0) return null;
    let start = -Math.PI / 2;
    const segments: React.ReactElement[] = [];
    for (let i = 0; i < values.length; i++) {
      const val = Math.max(0, values[i]);
      const angle = (val / sum) * Math.PI * 2;
      const end = start + angle;
      const x1 = cx + r * Math.cos(start);
      const y1 = cy + r * Math.sin(start);
      const x2 = cx + r * Math.cos(end);
      const y2 = cy + r * Math.sin(end);
      const largeArc = angle > Math.PI ? 1 : 0;
      const fill = colors[i] || 'var(--color-chart-1)';
      const d = `M ${cx},${cy} L ${x1},${y1} A ${r},${r} 0 ${largeArc} 1 ${x2},${y2} Z`;
      segments.push(<path key={i} d={d} fill={fill} />);
      start = end;
    }
    // legend
    const legendX = 310, legendY = 40, rowH = 18;
    const legend = values.map((_, i) => (
      <g key={`lg${i}`} transform={`translate(${legendX}, ${legendY + i * rowH})`}>
        <rect x={0} y={-10} width={12} height={12} fill={colors[i] || 'var(--color-chart-1)'} rx={2} ry={2} />
        <text x={18} y={0} fontSize="12" fill="var(--color-muted-foreground)" alignmentBaseline="middle">{labels[i] || `Slice ${i + 1}`}</text>
      </g>
    ));
    return (
      <svg className="block w-full h-auto" width={width} height={height} aria-label="Graph">
        <rect x="0" y="0" width={width} height={height} fill="var(--color-card)" />
        {segments}
        {legend}
      </svg>
    );
  }, [values, labels, colors]);

  return (
    <span
      ref={rootRef}
      className="graph-inline relative block my-2"
      role="group"
      aria-label="Graph"
      contentEditable={false as any}
      onMouseDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
    >
      <figure
        className="block border border-[var(--color-border)] rounded-[8px] bg-[var(--color-card)] shadow-[var(--shadow-xs,0_1px_0_rgba(0,0,0,0.02))] p-2 cursor-pointer focus:outline-none focus-visible:shadow-[var(--shadow-focus)] focus-visible:border-[var(--color-accent)]"
        role="button"
        tabIndex={0}
        title="Edit graph"
        onMouseDown={(e) => { e.preventDefault(); setOpen(v => !v); }}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setOpen(v => !v); } }}
      >
        <div className="block w-full max-w-[520px] mx-auto" aria-hidden>
          {chartReady ? (
            <canvas className="block w-full h-auto" ref={pillCanvasRef} width={420} height={240} />
          ) : (kind === 'pie' ? figureFallbackPie : figureFallbackBarLine) || null}
        </div>
        {(title || labels.length) && (
          <figcaption className="mt-1.5 text-xs text-[var(--color-muted-foreground)] text-center">{title || `${capKind} (${values.length})`}</figcaption>
        )}
      </figure>
      {open && (
        <div className="absolute left-0 top-[calc(100%+6px)] min-w-[460px] bg-[var(--color-popover)] border border-[var(--color-border)] rounded-[var(--radius-sm)] shadow-[var(--shadow-md)] p-2.5 z-10" onMouseDown={(e) => e.stopPropagation()}>
          <div className="grid grid-cols-[92px_1fr] items-center gap-2 mb-2 last:mb-0">
            <label className="text-xs text-[var(--color-muted-foreground)]">Type</label>
            <select className="w-full border border-[var(--color-border)] bg-[var(--color-popover)] px-2 py-1.5 rounded-[6px] outline-none focus:ring-2 focus:ring-inset focus:ring-[var(--color-accent)] focus:border-transparent" value={kind} onChange={(e) => setKind(e.target.value as any)}>
              <option value="bar">Bar</option>
              <option value="line">Line</option>
              <option value="pie">Pie</option>
            </select>
          </div>
          <div className="grid grid-cols-[92px_1fr] items-center gap-2 mb-2 last:mb-0">
            <label className="text-xs text-[var(--color-muted-foreground)]">Values</label>
            <input
              className="w-full border border-[var(--color-border)] bg-[var(--color-popover)] px-2 py-1.5 rounded-[6px] outline-none focus:ring-2 focus:ring-inset focus:ring-[var(--color-accent)] focus:border-transparent"
              type="text"
              placeholder="1, 2, 3"
              value={valuesStr}
              onChange={(e) => setValuesStr(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); setOpen(false); } if (e.key === 'Escape') { e.preventDefault(); const init = initialRef.current; setKind(init.kind as any); setValuesStr(init.valuesStr); setLabelsStr(init.labelsStr); setColorsStr(init.colorsStr); setTitle(init.title); setOpen(false); } }}
            />
          </div>
          <div className="grid grid-cols-[92px_1fr] items-center gap-2 mb-2 last:mb-0">
            <label className="text-xs text-[var(--color-muted-foreground)]">Labels</label>
            <input className="w-full border border-[var(--color-border)] bg-[var(--color-popover)] px-2 py-1.5 rounded-[6px] outline-none focus:ring-2 focus:ring-inset focus:ring-[var(--color-accent)] focus:border-transparent" type="text" placeholder="A, B, C" value={labelsStr} onChange={(e) => setLabelsStr(e.target.value)} />
          </div>
          <div className="grid grid-cols-[92px_1fr] items-center gap-2 mb-2 last:mb-0">
            <label className="text-xs text-[var(--color-muted-foreground)]">Colors</label>
            <input className="w-full border border-[var(--color-border)] bg-[var(--color-popover)] px-2 py-1.5 rounded-[6px] outline-none focus:ring-2 focus:ring-inset focus:ring-[var(--color-accent)] focus:border-transparent" type="text" placeholder="#2563eb, #16a34a" value={colorsStr} onChange={(e) => setColorsStr(e.target.value)} />
          </div>
          <div className="grid grid-cols-[92px_1fr] items-center gap-2 mb-2 last:mb-0">
            <label className="text-xs text-[var(--color-muted-foreground)]">Title</label>
            <input className="w-full border border-[var(--color-border)] bg-[var(--color-popover)] px-2 py-1.5 rounded-[6px] outline-none focus:ring-2 focus:ring-inset focus:ring-[var(--color-accent)] focus:border-transparent" type="text" placeholder="Optional" value={title} onChange={(e) => setTitle(e.target.value)} />
          </div>
          <div className="mt-1.5 p-2 bg-[var(--color-elev)] rounded-[6px] text-sm flex items-center justify-center">
            {chartReady ? (
              <canvas className="block" ref={canvasRef} width={160} height={80} />
            ) : (
              fallbackBars || <div className="text-[var(--color-muted-foreground)]">Graph preview</div>
            )}
          </div>
          {error && <div className="mt-1.5 text-[var(--color-danger)] text-xs" role="alert">{error}</div>}
          <div className="flex justify-end gap-2 mt-2">
            <button type="button" className="border border-[var(--color-danger)] bg-[var(--color-popover)] px-2.5 py-1.5 rounded-[6px] cursor-pointer text-[var(--color-danger)] hover:bg-[var(--color-elev)] focus-visible:shadow-[var(--shadow-danger)]" title="Remove graph" onMouseDown={onRemove}>Remove</button>
            <button type="button" className="border border-[var(--color-border)] bg-[var(--color-popover)] px-2.5 py-1.5 rounded-[6px] cursor-pointer hover:bg-[var(--color-elev)] focus-visible:shadow-[var(--shadow-focus)] focus-visible:border-[var(--color-accent)]" title="Close" onMouseDown={(e) => { e.preventDefault(); setOpen(false); }}>Done</button>
          </div>
        </div>
      )}
    </span>
  );
}
