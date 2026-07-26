import { useMemo } from 'react';
import type { GraphChild } from '@/editor';
import type { InlineWidgetProps } from '../types';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { InlineFigureShell, InlineSettings, SettingsRow, useInlineChild } from '../shared';
import { ChartFigure } from './ChartFigure';
import { MAX_PIE_SLICES, seriesColor } from './chartScale';
import { AreaChart, BarChart3, LineChart, PieChart, Plus, X } from 'lucide-react';

/**
 * Type-guard wrapper. It declares no hooks, so returning early here is safe;
 * the guard used to sit above the content component's hooks, which meant a
 * child whose type changed in place rendered fewer hooks than the previous
 * pass and crashed React.
 */
export function GraphInline({ child, ...rest }: InlineWidgetProps) {
  if (child.type !== 'graph') return null;
  return <GraphInlineContent child={child} {...rest} />;
}

const KINDS = [
  { value: 'bar', label: 'Bar', icon: BarChart3, hint: 'Compare values across categories' },
  { value: 'line', label: 'Line', icon: LineChart, hint: 'Show change over an ordered axis' },
  { value: 'area', label: 'Area', icon: AreaChart, hint: 'Change over time, with volume' },
  { value: 'pie', label: 'Pie', icon: PieChart, hint: 'Parts of one whole, at a glance' },
] as const;

function GraphInlineContent(props: InlineWidgetProps<GraphChild>) {
  const { child } = props;
  const { patch, remove } = useInlineChild(props);

  const values = useMemo(
    () => (Array.isArray(child.data?.values) ? child.data.values.filter(Number.isFinite) : []),
    [child.data?.values],
  );
  const labels = useMemo(
    () => (Array.isArray(child.data?.labels) ? child.data.labels : []),
    [child.data?.labels],
  );
  const colors = child.data?.colors;
  const kind = child.kind ?? 'bar';

  /**
   * Points are edited as rows, not as comma-separated strings.
   *
   * The old editor had three text fields — "1, 2, 3" / "A, B, C" / "#fff, …" —
   * that the author had to keep the same length by counting, and it rejected
   * the whole edit with "Labels must match values length" while they were
   * halfway through typing the second one.
   */
  const setPoint = (index: number, next: { label?: string; value?: number }) => {
    const nextValues = values.slice();
    const nextLabels = padLabels(labels, values.length);
    if (next.value !== undefined) nextValues[index] = next.value;
    if (next.label !== undefined) nextLabels[index] = next.label;
    patch({ data: { ...child.data, values: nextValues, labels: nextLabels } });
  };

  const addPoint = () => {
    patch({
      data: {
        ...child.data,
        values: [...values, 0],
        labels: [...padLabels(labels, values.length), ''],
      },
    });
  };

  const removePoint = (index: number) => {
    patch({
      data: {
        ...child.data,
        values: values.filter((_, i) => i !== index),
        labels: padLabels(labels, values.length).filter((_, i) => i !== index),
      },
    });
  };

  const tooManySlices = kind === 'pie' && values.length > MAX_PIE_SLICES;

  return (
    <InlineFigureShell
      label="Figure"
      onRemove={remove}
      controls={
        <>
          <span className="mr-1 flex items-center gap-0.5">
            {KINDS.map(({ value, label, icon: Icon, hint }) => (
              <Button
                key={value}
                type="button"
                variant="ghost"
                size="icon-xs"
                aria-label={label}
                aria-pressed={kind === value}
                title={`${label} — ${hint}`}
                className={cn(
                  'text-muted-foreground hover:text-foreground',
                  kind === value && 'bg-accent text-foreground',
                )}
                onClick={() => patch({ kind: value })}
              >
                <Icon className="h-3.5 w-3.5" />
              </Button>
            ))}
          </span>

          <InlineSettings label="Figure data">
            <SettingsRow label="Title" htmlFor={`title-${child.id}`}>
              <Input
                id={`title-${child.id}`}
                type="text"
                value={child.title ?? ''}
                placeholder="What this figure shows"
                onChange={(event) => patch({ title: event.target.value })}
                className="h-8 px-2"
              />
            </SettingsRow>

            <SettingsRow label="Data">
              <div className="max-h-52 space-y-1 overflow-y-auto pr-1">
                {values.map((value, index) => (
                  <div key={index} className="flex items-center gap-1">
                    <span
                      aria-hidden="true"
                      className="h-3 w-3 shrink-0 rounded-sm"
                      style={{ background: seriesColor(kind === 'pie' ? index : 0, colors) }}
                    />
                    <Input
                      type="text"
                      aria-label={`Label ${index + 1}`}
                      value={labels[index] ?? ''}
                      placeholder={`Item ${index + 1}`}
                      onChange={(event) => setPoint(index, { label: event.target.value })}
                      className="h-7 min-w-0 flex-1 px-2 text-xs shadow-none"
                    />
                    <Input
                      type="number"
                      aria-label={`Value ${index + 1}`}
                      value={Number.isFinite(value) ? value : ''}
                      onChange={(event) =>
                        setPoint(index, { value: Number(event.target.value) || 0 })
                      }
                      className="h-7 w-20 shrink-0 px-2 text-xs tabular-nums shadow-none"
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-xs"
                      aria-label={`Remove point ${index + 1}`}
                      className="shrink-0 text-muted-foreground hover:text-destructive"
                      onClick={() => removePoint(index)}
                    >
                      <X className="h-3 w-3" />
                    </Button>
                  </div>
                ))}
              </div>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="mt-1 h-7 gap-1 px-1.5 text-xs text-muted-foreground"
                onClick={addPoint}
              >
                <Plus className="h-3 w-3" />
                Add point
              </Button>
            </SettingsRow>

            {kind !== 'pie' && (
              <div className="grid grid-cols-2 gap-2">
                <SettingsRow label="X axis" htmlFor={`x-${child.id}`}>
                  <Input
                    id={`x-${child.id}`}
                    type="text"
                    value={child.xLabel ?? ''}
                    onChange={(event) => patch({ xLabel: event.target.value })}
                    className="h-8 px-2"
                  />
                </SettingsRow>
                <SettingsRow label="Y axis" htmlFor={`y-${child.id}`}>
                  <Input
                    id={`y-${child.id}`}
                    type="text"
                    value={child.yLabel ?? ''}
                    onChange={(event) => patch({ yLabel: event.target.value })}
                    className="h-8 px-2"
                  />
                </SettingsRow>
              </div>
            )}

            <SettingsRow label="Caption" htmlFor={`caption-${child.id}`}>
              <Input
                id={`caption-${child.id}`}
                type="text"
                value={child.caption ?? ''}
                placeholder="Figure 1. Accuracy by model size."
                onChange={(event) => patch({ caption: event.target.value })}
                className="h-8 px-2"
              />
            </SettingsRow>

            {tooManySlices && (
              <p className="mt-2 rounded-md bg-warning/10 px-2 py-1 text-[11px] text-warning">
                {values.length} slices is more than a pie can show at a glance. A bar chart
                compares these better.
              </p>
            )}
          </InlineSettings>
        </>
      }
      caption={
        child.caption ? (
          <span className="block border-t border-border/60 px-3 py-1.5 text-xs text-muted-foreground">
            {child.caption}
          </span>
        ) : undefined
      }
    >
      {child.title && (
        <span className="block px-3 pt-2 text-sm font-medium text-foreground">{child.title}</span>
      )}
      <ChartFigure
        kind={kind}
        values={values}
        labels={labels}
        colors={colors}
        xLabel={child.xLabel}
        yLabel={child.yLabel}
        className="px-1 py-2"
      />
    </InlineFigureShell>
  );
}

/** Labels always match the value count, so the two can never drift apart. */
function padLabels(labels: string[], length: number): string[] {
  const out = labels.slice(0, length);
  while (out.length < length) out.push('');
  return out;
}
