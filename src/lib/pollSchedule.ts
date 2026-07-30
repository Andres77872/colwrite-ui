/**
 * The backoff policy for polling a resource that is still being converted.
 *
 * Extraction usually finishes in a few seconds but can take minutes for a long
 * scan, so a fixed interval is wrong in both directions: too slow to feel live
 * at the start, and a permanent background request afterwards. The dashboard
 * used to poll every 4s forever while mounted, which meant one stuck file kept
 * asking until the page was closed. One schedule, used by both pollers.
 */
export const SETTLING_POLL = {
  /** Fast enough that a normal conversion appears to resolve on its own. */
  first: 1_500,
  factor: 1.6,
  max: 15_000,
  /** Past this, stop asking: a refresh is the honest way to find out. */
  ceiling: 4 * 60_000,
} as const;

export type PollSchedule = {
  /** How long to wait before the next attempt. */
  delay: () => number;
  /** Record that an attempt was made and back off. */
  advance: () => void;
  /** Whether the ceiling has been reached and polling should stop. */
  exhausted: () => boolean;
  /** Back to the first delay — call when there is nothing left to watch. */
  reset: () => void;
};

export function createPollSchedule(): PollSchedule {
  let delay: number = SETTLING_POLL.first;
  let elapsed = 0;

  return {
    delay: () => delay,
    advance: () => {
      elapsed += delay;
      delay = Math.min(delay * SETTLING_POLL.factor, SETTLING_POLL.max);
    },
    exhausted: () => elapsed >= SETTLING_POLL.ceiling,
    reset: () => {
      delay = SETTLING_POLL.first;
      elapsed = 0;
    },
  };
}
