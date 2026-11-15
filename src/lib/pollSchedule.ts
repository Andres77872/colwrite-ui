/**
 * The backoff policy for polling a resource that is still being converted.
 *
 * Extraction usually finishes in a few seconds but can take minutes for a long
 * scan, so a fixed interval is wrong in both directions: too slow to feel live
 * at the start, and a permanent background request afterwards. The dashboard
 * used to poll every 4s forever while mounted, which meant one stuck file kept
 * asking until the page was closed.
 */
export const SETTLING_POLL = {
  /** Fast enough that a normal conversion appears to resolve on its own. */
  first: 1_500,
  factor: 1.6,
  max: 15_000,
  /** Past this, stop asking: a refresh is the honest way to find out. */
  ceiling: 4 * 60_000,
} as const;

/**
 * How long to wait before the next look, `elapsed` ms after the first one
 * that found something still converting; `false` once the ceiling is reached.
 *
 * Waits that grow by `factor` from `first` add up so that each one is
 * `first + (factor - 1) × elapsed`, so the schedule needs only the elapsed
 * time and can be a query's `refetchInterval`.
 */
export function settlingPollInterval(elapsed: number): number | false {
  if (elapsed >= SETTLING_POLL.ceiling) return false;
  return Math.min(SETTLING_POLL.first + (SETTLING_POLL.factor - 1) * Math.max(0, elapsed), SETTLING_POLL.max);
}

/**
 * The backoff for following a workspace job (a collection's pages moving to
 * or from the Trash, a purge). Most finish within a second or two, so the
 * first looks come quickly; a long one is asked about every few seconds
 * until it is `done` or `failed`. A job always ends, so there is no ceiling.
 */
export const JOB_POLL = {
  first: 400,
  factor: 1.6,
  max: 5_000,
} as const;

/** How long to wait before the `attempt`-th look at a job (0 is the first). */
export function jobPollDelay(attempt: number): number {
  return Math.min(JOB_POLL.first * JOB_POLL.factor ** Math.max(0, attempt), JOB_POLL.max);
}
