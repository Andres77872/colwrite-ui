import { useCallback, useSyncExternalStore } from 'react';
import { describeApiError, problemCode } from '@/api/errors';
import { getJob, jobSettled, type WorkspaceJob } from '@/data/trash';
import { jobPollDelay } from '@/lib/pollSchedule';
import { registerModuleReset } from '@/lib/moduleState';

/**
 * Trash work that finishes after its request answered: a collection's pages
 * moving to or from the Trash, a purge, emptying the Trash. The request
 * answers 202 with a job; this follows it (`GET …/jobs/{id}`, with a growing
 * wait between looks) until it is `done` or `failed`, so the sidebar and the
 * Trash can show how far it is, and what it changed is read again once it is
 * done.
 *
 * Module state, because a job outlives the dialog or menu that started it.
 * A workspace switch and a sign-out forget every job (`registerModuleReset`);
 * the server finishes them regardless.
 */

/** A job being followed, as the progress line shows it. */
export type FollowedJob = {
  key: string;
  workspaceId: string;
  /** What is happening, in the author's words: "Moving Chapter 1 to Trash". */
  label: string;
  /** What `progress` counts: "pages". */
  unit: string;
  job: WorkspaceJob;
  /** Why it stopped, once it failed; the line stays until dismissed. */
  error: string | null;
};

type Follow = {
  label: string;
  unit: string;
  /** Called once, when the job is done or has failed. */
  onSettled?: (job: WorkspaceJob) => void;
};

let jobs: readonly FollowedJob[] = [];
const timers = new Map<string, number>();
const listeners = new Set<() => void>();
let generation = 0;

function publish(next: readonly FollowedJob[]) {
  jobs = next;
  for (const listener of listeners) listener();
}

function update(key: string, change: Partial<FollowedJob>) {
  publish(jobs.map((item) => (item.key === key ? { ...item, ...change } : item)));
}

function forget(key: string) {
  const timer = timers.get(key);
  if (timer !== undefined) window.clearTimeout(timer);
  timers.delete(key);
  publish(jobs.filter((item) => item.key !== key));
}

registerModuleReset(() => {
  generation += 1;
  for (const timer of timers.values()) window.clearTimeout(timer);
  timers.clear();
  publish([]);
});

/** Why a job ended `failed`, said for the author. */
function failureOf(job: WorkspaceJob): string {
  if (job.progress?.dry_run) return 'Nothing was deleted: permanent deletion is in a dry run on this server.';
  return job.last_error || 'The server could not finish it.';
}

/**
 * Follow `job` until it ends. A job already settled in the answer that
 * armed it ends at once. A job the server no longer knows (404
 * `job_not_found`) ends as done: there is nothing left to wait for.
 */
export function followJob(workspaceId: string, job: WorkspaceJob, follow: Follow): void {
  const key = `${workspaceId}:${job.id}`;
  const started = generation;
  let settled = false;
  const settle = (final: WorkspaceJob) => {
    if (settled || started !== generation) return;
    settled = true;
    follow.onSettled?.(final);
    if (final.status === 'failed') update(key, { job: final, error: failureOf(final) });
    else forget(key);
  };

  if (jobs.some((item) => item.key === key)) forget(key);
  publish([...jobs, { key, workspaceId, label: follow.label, unit: follow.unit, job, error: null }]);
  if (jobSettled(job)) {
    settle(job);
    return;
  }

  const look = (attempt: number) => {
    timers.set(key, window.setTimeout(() => {
      timers.delete(key);
      void getJob(workspaceId, job.id).then(
        (next) => {
          if (started !== generation || settled) return;
          if (jobSettled(next)) {
            settle(next);
            return;
          }
          update(key, { job: next });
          look(attempt + 1);
        },
        (error: unknown) => {
          if (started !== generation || settled) return;
          if (problemCode(error) === 'job_not_found') {
            settle({ ...job, status: 'done' });
            return;
          }
          // The network or the server stumbled: look again, a little later.
          update(key, { error: null });
          if (attempt > 30) {
            settled = true;
            update(key, { error: describeApiError(error, 'Could not find out how it went.') });
            return;
          }
          look(attempt + 1);
        },
      );
    }, jobPollDelay(attempt)));
  };
  look(0);
}

/**
 * Follow `job` as `followJob` does, and resolve with it once it is `done` or
 * `failed`: for work whose result the caller shows (a claim check, a
 * reference audit). A workspace switch forgets it, and the promise with it.
 */
export function settledJob(workspaceId: string, job: WorkspaceJob, follow: Omit<Follow, 'onSettled'>): Promise<WorkspaceJob> {
  return new Promise((resolve) => {
    followJob(workspaceId, job, { ...follow, onSettled: resolve });
  });
}

/** Stop showing a job that failed. */
export function dismissJob(key: string): void {
  forget(key);
}

const NONE: readonly FollowedJob[] = [];

/** The jobs being followed in a workspace, for the progress lines. */
export function useWorkspaceJobs(workspaceId: string): readonly FollowedJob[] {
  const subscribe = useCallback((listener: () => void) => {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }, []);
  const snapshot = useSyncExternalStore(subscribe, () => jobs, () => NONE);
  return snapshot.filter((item) => item.workspaceId === workspaceId);
}
