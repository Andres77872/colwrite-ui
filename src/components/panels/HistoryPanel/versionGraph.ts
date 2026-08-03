/**
 * Version-tree lane assignment — the math behind the History panel's rail.
 *
 * The server keeps every revision's `parentRevisionId`, and a restore moves the
 * document's current-version pointer without writing a revision, so the next
 * save forks the tree from wherever the pointer sits. That makes history a DAG
 * (a tree, in practice) rather than a line, and the panel draws it git-log
 * style: rows stay newest-first, and a narrow rail on the left shows which row
 * descends from which.
 *
 * Lane rules, applied newest → oldest (the order rows are rendered in):
 *  - A revision inherits the lane its *first* (newest) loaded child reserved
 *    for it, so a straight line of saves stays in a single column.
 *  - Every other child of that same parent sits in its own lane and its edge
 *    curves into the parent's lane — that curve is the fork.
 *  - A parent outside the loaded pages never claims its lane back; the edge is
 *    marked dangling and the rail fades it toward "Show older versions".
 */

/** The only revision fields the graph needs. `RevisionSummary` satisfies it. */
export interface VersionGraphNode {
  revisionId: string;
  parentRevisionId: string | null;
}

/** A branch crossing a row without a node on it. */
export interface VersionGraphLane {
  lane: number;
  /** The edge leads to a revision that is not loaded (older page, or gone). */
  dangling: boolean;
}

export interface VersionGraphRow {
  revisionId: string;
  /** Column the revision's node dot sits in. */
  lane: number;
  /** Lanes of other branches passing this row top to bottom. */
  through: VersionGraphLane[];
  /** A newer loaded revision descends from this one — draw the edge upward. */
  hasChildAbove: boolean;
  /** Lane this row's edge to its parent lands in; null for a root revision. */
  parentLane: number | null;
  /** The parent is not in the loaded pages — the downward edge fades out. */
  parentDangling: boolean;
  /** Loaded revisions whose parent is this revision. */
  childCount: number;
  /** Two or more loaded children: this row is a fork point. */
  isFork: boolean;
}

export interface VersionGraph {
  rows: VersionGraphRow[];
  /** Widest point of the rail, in lanes; 0 when there is nothing to draw. */
  laneCount: number;
  /**
   * Lanes whose edge leaves the bottom of the loaded list, because the parent
   * they lead to has not been paged in. The rail fades these out toward
   * "Show older versions".
   */
  danglingLanes: number[];
}

/**
 * Assign a lane to every revision, in the order given (newest first).
 *
 * Pure and total: unknown parents, duplicate ids and out-of-order rows all
 * degrade to a dangling edge rather than throwing, because the input is
 * whatever pages the panel happens to have loaded.
 */
export function buildVersionGraph(revisions: readonly VersionGraphNode[]): VersionGraph {
  const indexById = new Map<string, number>();
  revisions.forEach((revision, index) => {
    if (!indexById.has(revision.revisionId)) indexById.set(revision.revisionId, index);
  });

  /** A parent is only drawable when it is loaded *below* the child. */
  const resolvesBelow = (revisionId: string, fromIndex: number): boolean => {
    const at = indexById.get(revisionId);
    return at !== undefined && at > fromIndex;
  };

  const childCounts = new Map<string, number>();
  revisions.forEach((revision, index) => {
    const parentId = revision.parentRevisionId;
    if (!parentId || !resolvesBelow(parentId, index)) return;
    childCounts.set(parentId, (childCounts.get(parentId) ?? 0) + 1);
  });

  // lanes[i] holds the revision id that lane is waiting for — the parent an
  // already-placed child descends from — or null while the lane is free.
  const lanes: (string | null)[] = [];
  const rows: VersionGraphRow[] = [];

  revisions.forEach((revision, index) => {
    let lane = lanes.indexOf(revision.revisionId);
    const hasChildAbove = lane !== -1;
    if (!hasChildAbove) {
      lane = lanes.indexOf(null);
      if (lane === -1) {
        lanes.push(null);
        lane = lanes.length - 1;
      }
    }
    // Defensive: a second reservation for the same revision folds into the
    // first instead of drawing a duplicate node lane.
    for (let other = lane + 1; other < lanes.length; other += 1) {
      if (lanes[other] === revision.revisionId) lanes[other] = null;
    }

    const through: VersionGraphLane[] = [];
    lanes.forEach((waitingFor, laneIndex) => {
      if (laneIndex === lane || waitingFor === null) return;
      through.push({ lane: laneIndex, dangling: !resolvesBelow(waitingFor, index) });
    });

    const parentId = revision.parentRevisionId;
    let parentLane: number | null = null;
    let parentDangling = false;
    if (parentId) {
      const reserved = lanes.indexOf(parentId);
      if (reserved !== -1 && reserved !== lane) {
        // A newer sibling already owns the parent's lane: this branch ends
        // here and curves into it.
        lanes[lane] = null;
        parentLane = reserved;
      } else {
        lanes[lane] = parentId;
        parentLane = lane;
      }
      parentDangling = !resolvesBelow(parentId, index);
    } else {
      lanes[lane] = null;
    }

    const childCount = childCounts.get(revision.revisionId) ?? 0;
    rows.push({
      revisionId: revision.revisionId,
      lane,
      through,
      hasChildAbove,
      parentLane,
      parentDangling,
      childCount,
      isFork: childCount >= 2,
    });
  });

  const danglingLanes: number[] = [];
  lanes.forEach((waitingFor, laneIndex) => {
    if (waitingFor !== null) danglingLanes.push(laneIndex);
  });

  return { rows, laneCount: lanes.length, danglingLanes };
}
