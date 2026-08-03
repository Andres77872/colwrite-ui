import { useId } from 'react';
import { cn } from '@/lib/utils';
import type { VersionGraphRow } from './versionGraph';

/**
 * The git-log style rail drawn to the left of every history row.
 *
 * Pure decoration: the list itself stays a plain `ol`/`li`, and this is
 * `aria-hidden`, so the graph adds nothing a screen reader has to walk past.
 * The SVG is sized per row at {@link RAIL_ROW_HEIGHT}; anything below that
 * (an expanded inspector, a row that wrapped) is filled by 1px continuation
 * lines so the branches stay unbroken down the whole list.
 */

const LANE_WIDTH = 12;
/** Beyond this the deepest lanes share a column — the rail is a hint, not a map. */
const MAX_LANES = 4;
/** Vertical center of a row's first text line: where the node dot sits. */
const NODE_Y = 18;

/** Height the rail draws one row at; row buttons are pinned to it. */
export const RAIL_ROW_HEIGHT = 54;
/** Height of the fade under the last row, where unloaded lineage leaves. */
const TAIL_HEIGHT = 16;

function laneX(lane: number): number {
  return Math.min(lane, MAX_LANES - 1) * LANE_WIDTH + LANE_WIDTH / 2;
}

function railWidth(laneCount: number): number {
  return Math.min(Math.max(laneCount, 1), MAX_LANES) * LANE_WIDTH;
}

/** Vertical edge, straight down a single lane. */
function straightPath(x: number, fromY: number, toY: number): string {
  return `M ${x} ${fromY} V ${toY}`;
}

/** Fork edge: leaves the node, bends across, lands in the parent's lane. */
function curvePath(fromX: number, toX: number): string {
  const mid = (NODE_Y + RAIL_ROW_HEIGHT) / 2;
  return `M ${fromX} ${NODE_Y} C ${fromX} ${mid} ${toX} ${mid} ${toX} ${RAIL_ROW_HEIGHT}`;
}

export function VersionGraphRail({
  row,
  laneCount,
  isCurrent,
}: {
  row: VersionGraphRow;
  laneCount: number;
  isCurrent: boolean;
}) {
  const width = railWidth(laneCount);
  const x = laneX(row.lane);
  // Everything still open at the bottom edge of the drawn row keeps going. A
  // lane can be reached twice — crossed by a branch *and* landed in by this
  // row's fork edge — and is still one line.
  const continuing = new Map<number, boolean>();
  row.through.forEach((lane) => {
    continuing.set(lane.lane, (continuing.get(lane.lane) ?? false) || lane.dangling);
  });
  if (row.parentLane !== null) {
    continuing.set(
      row.parentLane,
      (continuing.get(row.parentLane) ?? false) || row.parentDangling,
    );
  }

  return (
    <span
      aria-hidden="true"
      className="relative shrink-0 self-stretch overflow-hidden"
      style={{ width }}
    >
      <svg
        className="block"
        width={width}
        height={RAIL_ROW_HEIGHT}
        viewBox={`0 0 ${width} ${RAIL_ROW_HEIGHT}`}
        fill="none"
      >
        {row.through.map((lane) => (
          <path
            key={`through-${lane.lane}`}
            d={straightPath(laneX(lane.lane), 0, RAIL_ROW_HEIGHT)}
            className={cn('stroke-border', lane.dangling && 'opacity-50')}
            strokeWidth={1.5}
            strokeDasharray={lane.dangling ? '2 3' : undefined}
          />
        ))}
        {row.hasChildAbove && (
          <path
            d={straightPath(x, 0, NODE_Y)}
            className="stroke-border"
            strokeWidth={1.5}
          />
        )}
        {row.parentLane !== null && (
          <path
            d={
              row.parentLane === row.lane
                ? straightPath(x, NODE_Y, RAIL_ROW_HEIGHT)
                : curvePath(x, laneX(row.parentLane))
            }
            className={cn('stroke-border', row.parentDangling && 'opacity-50')}
            strokeWidth={1.5}
            strokeDasharray={row.parentDangling ? '2 3' : undefined}
          />
        )}
        {isCurrent && <circle cx={x} cy={NODE_Y} r={6} className="fill-primary/20" />}
        <circle
          cx={x}
          cy={NODE_Y}
          r={isCurrent ? 4 : 3}
          className={isCurrent ? 'fill-primary' : 'fill-muted-foreground/70'}
        />
      </svg>
      {[...continuing].map(([lane, dangling]) => (
        <span
          key={`continue-${lane}`}
          className={cn('absolute w-px bg-border', dangling && 'opacity-50')}
          style={{ left: laneX(lane) - 0.5, top: RAIL_ROW_HEIGHT, bottom: 0 }}
        />
      ))}
    </span>
  );
}

/**
 * The stub under the last row: every lane whose parent is still unloaded
 * leaves the list here, fading toward the "Show older versions" button.
 */
export function VersionGraphTail({
  lanes,
  laneCount,
}: {
  lanes: number[];
  laneCount: number;
}) {
  // useId's separators are not safe inside a `url(#…)` reference.
  const fadeId = `history-graph-fade-${useId().replace(/[^\w-]/g, '')}`;
  if (lanes.length === 0) return null;
  const width = railWidth(laneCount);
  return (
    <svg
      aria-hidden="true"
      className="block shrink-0 self-start text-border"
      width={width}
      height={TAIL_HEIGHT}
      viewBox={`0 0 ${width} ${TAIL_HEIGHT}`}
      fill="none"
    >
      <defs>
        {/* userSpaceOnUse: a vertical line has a zero-width bounding box, which
            would leave an objectBoundingBox gradient unrendered. */}
        <linearGradient
          id={fadeId}
          gradientUnits="userSpaceOnUse"
          x1={0}
          y1={0}
          x2={0}
          y2={TAIL_HEIGHT}
        >
          <stop offset="0%" stopColor="currentColor" stopOpacity={0.5} />
          <stop offset="100%" stopColor="currentColor" stopOpacity={0} />
        </linearGradient>
      </defs>
      {lanes.map((lane) => (
        <path
          key={`tail-${lane}`}
          d={straightPath(laneX(lane), 0, TAIL_HEIGHT)}
          stroke={`url(#${fadeId})`}
          strokeWidth={1.5}
          strokeDasharray="2 3"
        />
      ))}
    </svg>
  );
}
