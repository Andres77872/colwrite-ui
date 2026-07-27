import { useMemo, useState } from 'react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import {
  formatNumber,
  seriesColor,
} from '@/components/editor/blocks/ParagraphBlock/Inlines/GraphInline/chartScale';
import type { ActivityDay } from '@/services/userProfile';
import { Activity, BarChart3, Table2 } from 'lucide-react';

/**
 * Three measures of the same unit (events), so they stack on one axis.
 * The order is fixed — a hue belongs to a measure, and hiding one must never
 * repaint the others.
 */
const SERIES = [
  { key: 'document_events', label: 'Document edits', slot: 0 },
  { key: 'agent_run_events', label: 'Assistant runs', slot: 1 },
  { key: 'upload_events', label: 'Uploads', slot: 2 },
] as const;

type SeriesKey = (typeof SERIES)[number]['key'];

type DenseDay = {
  key: string;
  date: Date;
  total: number;
  values: Record<SeriesKey, number>;
};

const PLOT_HEIGHT = 128;
/** Mark spec: columns are capped rather than filling their band. */
const MAX_COLUMN_WIDTH = 24;
/** Surface-coloured gap that separates stacked segments — never a stroke. */
const SEGMENT_GAP = 2;

function isoDay(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(
    date.getDate(),
  ).padStart(2, '0')}`;
}

/**
 * Expand the API's sparse series onto a real calendar.
 *
 * The server omits days with no activity — an absent day and a zero day are
 * the same fact, and the client owns the window it renders against.
 */
function densify(activity: ActivityDay[], days: number): DenseDay[] {
  const byDay = new Map(activity.map((entry) => [entry.day.slice(0, 10), entry]));
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  return Array.from({ length: days }, (_, offset) => {
    const date = new Date(today);
    date.setDate(today.getDate() - (days - 1 - offset));
    const key = isoDay(date);
    const entry = byDay.get(key);
    const values = {
      document_events: entry?.document_events ?? 0,
      agent_run_events: entry?.agent_run_events ?? 0,
      upload_events: entry?.upload_events ?? 0,
    };
    return {
      key,
      date,
      values,
      total: values.document_events + values.agent_run_events + values.upload_events,
    };
  });
}

function shortDate(date: Date): string {
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

/**
 * ActivityChart — stacked columns of daily activity, with a table twin.
 *
 * Stacked rather than grouped because the three measures share a unit and the
 * question is "how busy was that day, and with what". The table view is not
 * an extra: it is how the values stay reachable without relying on colour or
 * a hover.
 */
export function ActivityChart({
  activity,
  days = 30,
}: {
  activity: ActivityDay[];
  days?: number;
}) {
  const [hovered, setHovered] = useState<number | null>(null);
  const [asTable, setAsTable] = useState(false);

  const series = useMemo(() => densify(activity, days), [activity, days]);
  const max = useMemo(
    () => series.reduce((peak, day) => Math.max(peak, day.total), 0),
    [series],
  );
  const totals = useMemo(
    () =>
      SERIES.reduce(
        (acc, entry) => ({
          ...acc,
          [entry.key]: series.reduce((sum, day) => sum + day.values[entry.key], 0),
        }),
        {} as Record<SeriesKey, number>,
      ),
    [series],
  );

  const heading = (
    <div className="flex flex-wrap items-center justify-between gap-2">
      <div>
        <h3 className="text-md font-semibold">Activity</h3>
        <p className="text-xs text-muted-foreground">Last {days} days</p>
      </div>
      <Button
        variant="outline"
        size="sm"
        onClick={() => setAsTable((previous) => !previous)}
        aria-pressed={asTable}
      >
        {asTable ? <BarChart3 aria-hidden="true" /> : <Table2 aria-hidden="true" />}
        {asTable ? 'Chart' : 'Table'}
      </Button>
    </div>
  );

  if (max === 0) {
    return (
      <section className="rounded-xl border border-border/60 bg-card p-4">
        {heading}
        <EmptyState
          icon={Activity}
          title="No activity yet"
          description="Edits, assistant runs, and uploads from the last 30 days appear here."
        />
      </section>
    );
  }

  return (
    <section className="rounded-xl border border-border/60 bg-card p-4">
      {heading}

      {/* Legend is always present for more than one series: identity must
          never rest on colour matching alone. */}
      <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-1.5">
        {SERIES.map((entry) => (
          <li key={entry.key} className="flex items-center gap-1.5 text-xs">
            <span
              aria-hidden="true"
              className="h-2.5 w-2.5 shrink-0 rounded-[2px]"
              style={{ background: seriesColor(entry.slot) }}
            />
            <span className="text-muted-foreground">{entry.label}</span>
            <span className="font-medium tabular-nums">{formatNumber(totals[entry.key])}</span>
          </li>
        ))}
      </ul>

      {asTable ? (
        <ActivityTable series={series} />
      ) : (
        <div className="mt-4">
          <div className="flex gap-3">
            {/* Y axis: the peak and the baseline. Two ticks carry a 30-column
                strip; a full grid would out-weigh the data. */}
            <div
              className="flex w-8 shrink-0 flex-col justify-between text-right text-2xs tabular-nums text-muted-foreground"
              style={{ height: PLOT_HEIGHT }}
              aria-hidden="true"
            >
              <span>{formatNumber(max)}</span>
              <span>0</span>
            </div>

            <div
              className="relative min-w-0 flex-1"
              onMouseLeave={() => setHovered(null)}
            >
              <div
                className="flex items-end border-b border-[var(--color-chart-axis)]"
                style={{ height: PLOT_HEIGHT, gap: SEGMENT_GAP }}
              >
                {series.map((day, index) => (
                  <Column
                    key={day.key}
                    day={day}
                    max={max}
                    active={hovered === index}
                    onActivate={() => setHovered(index)}
                    onDismiss={() => setHovered(null)}
                  />
                ))}
              </div>

              <div className="mt-1.5 flex justify-between text-2xs text-muted-foreground">
                <span>{shortDate(series[0].date)}</span>
                <span>{shortDate(series[series.length - 1].date)}</span>
              </div>

              {hovered !== null && <Tooltip day={series[hovered]} index={hovered} count={series.length} />}
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

function Column({
  day,
  max,
  active,
  onActivate,
  onDismiss,
}: {
  day: DenseDay;
  max: number;
  active: boolean;
  onActivate: () => void;
  onDismiss: () => void;
}) {
  const present = SERIES.filter((entry) => day.values[entry.key] > 0);
  // The surface gaps are part of the column's height, so the scale has to pay
  // for them. Scaling against the full plot height instead let the busiest
  // day's stack finish a few pixels above its own axis maximum.
  const usable = PLOT_HEIGHT - Math.max(0, present.length - 1) * SEGMENT_GAP;

  return (
    <button
      type="button"
      // The whole band is the hit target, not just the painted column, so a
      // quiet day is as easy to hover as a busy one.
      className={cn(
        'group relative flex h-full min-w-0 flex-1 cursor-default flex-col justify-end rounded-sm',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        active && 'bg-foreground/5',
      )}
      style={{ maxWidth: MAX_COLUMN_WIDTH }}
      onMouseEnter={onActivate}
      onFocus={onActivate}
      onBlur={onDismiss}
      aria-label={`${shortDate(day.date)}: ${day.total} event${day.total === 1 ? '' : 's'}`}
    >
      {/* Segments are separated by a 2px gap in the surface colour rather than
          a stroke — no ink that is not data. */}
      <span
        className="flex w-full flex-col justify-end"
        style={{ gap: SEGMENT_GAP }}
        aria-hidden="true"
      >
        {present.map((entry, position) => (
          <span
            key={entry.key}
            className={cn('w-full', position === 0 && 'rounded-t-[4px]')}
            style={{
              background: seriesColor(entry.slot),
              // A floor of 2px so a single event is still a visible mark
              // rather than a sub-pixel sliver that rounds away.
              height: Math.max(2, (day.values[entry.key] / max) * usable),
            }}
          />
        ))}
        {/* A day with nothing keeps a hairline, so the calendar reads as
            continuous instead of as missing data. */}
        {day.total === 0 && <span className="h-[2px] w-full rounded-[1px] bg-border" />}
      </span>
    </button>
  );
}

function Tooltip({ day, index, count }: { day: DenseDay; index: number; count: number }) {
  // Anchored to the column's band and flipped near the right edge so it never
  // leaves the card.
  const position = (index + 0.5) / count;
  const flip = position > 0.6;

  return (
    <div
      role="status"
      className={cn(
        'pointer-events-none absolute bottom-full z-[var(--z-popover)] mb-2 w-40 rounded-lg',
        'border border-border bg-popover p-2.5 shadow-lg',
      )}
      style={
        flip
          ? { right: `${(1 - position) * 100}%`, marginRight: -8 }
          : { left: `${position * 100}%`, marginLeft: -8 }
      }
    >
      <p className="text-xs font-medium">{shortDate(day.date)}</p>
      <ul className="mt-1.5 space-y-1">
        {SERIES.map((entry) => (
          <li key={entry.key} className="flex items-center gap-1.5 text-2xs">
            <span
              aria-hidden="true"
              className="h-2 w-2 shrink-0 rounded-[2px]"
              style={{ background: seriesColor(entry.slot) }}
            />
            <span className="flex-1 text-muted-foreground">{entry.label}</span>
            <span className="tabular-nums">{day.values[entry.key]}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function ActivityTable({ series }: { series: DenseDay[] }) {
  // The table twin only lists days that happened — a run of empty rows is
  // noise, and the chart already shows the gaps.
  const rows = series.filter((day) => day.total > 0).reverse();

  return (
    <div className="mt-3 max-h-64 overflow-y-auto">
      <table className="w-full text-left text-xs">
        <caption className="sr-only">Daily activity counts</caption>
        <thead className="sticky top-0 bg-card text-muted-foreground">
          <tr>
            <th scope="col" className="py-1.5 pr-2 font-medium">Day</th>
            {SERIES.map((entry) => (
              <th key={entry.key} scope="col" className="py-1.5 pl-2 text-right font-medium">
                {entry.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((day) => (
            <tr key={day.key} className="border-t border-border/50">
              <th scope="row" className="py-1.5 pr-2 font-normal">
                {shortDate(day.date)}
              </th>
              {SERIES.map((entry) => (
                <td key={entry.key} className="py-1.5 pl-2 text-right tabular-nums">
                  {day.values[entry.key]}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
