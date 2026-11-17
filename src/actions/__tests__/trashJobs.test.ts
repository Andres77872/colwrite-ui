import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { http, server } from '@/__tests__/server';
import { TEST_WORKSPACE_ID as WS } from '@/__tests__/workspace';
import { resetModuleState } from '@/lib/moduleState';
import { JOB_POLL, jobPollDelay } from '@/lib/pollSchedule';
import { getJob, type WorkspaceJob } from '@/data/trash';
import { fixtures, jobState, startJob } from '@/dev/msw/fixtures';
import { dismissJob, followJob, useWorkspaceJobs } from '../trashJobs';

/**
 * A 202 job is followed until it ends, with a growing wait between looks,
 * so its progress can be shown; what it changed is read again once it is
 * done, and a failure stays, saying why, until it is dismissed.
 */

async function tick(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  resetModuleState();
  vi.useRealTimers();
});

describe('jobPollDelay', () => {
  it('looks again quickly at first, then less often, up to a few seconds', () => {
    expect(jobPollDelay(0)).toBe(JOB_POLL.first);
    expect(jobPollDelay(1)).toBeGreaterThan(jobPollDelay(0));
    expect(jobPollDelay(30)).toBe(JOB_POLL.max);
  });
});

describe('followJob', () => {
  it('shows the progress while it runs, then reads again once and goes when it is done', async () => {
    fixtures.jobDurationMs = 3_000;
    const job = jobState(startJob(WS, 'collection_trash', 12));
    const onSettled = vi.fn();
    const { result } = renderHook(() => useWorkspaceJobs(WS));

    act(() => followJob(WS, job, { label: 'Moving Chapter 1 to Trash', unit: 'pages', onSettled }));
    expect(result.current).toHaveLength(1);
    expect(result.current[0]).toMatchObject({ label: 'Moving Chapter 1 to Trash', unit: 'pages', error: null });

    await tick(1_600);
    expect(result.current[0]?.job.status).toBe('running');
    expect(result.current[0]?.job.progress?.done).toBeGreaterThan(0);
    expect(onSettled).not.toHaveBeenCalled();

    await tick(10_000);
    expect(onSettled).toHaveBeenCalledTimes(1);
    expect(onSettled.mock.calls[0]?.[0]).toMatchObject({ status: 'done', progress: { done: 12, total: 12 } });
    expect(result.current).toEqual([]);
  });

  it('keeps a job that failed, saying why, until it is dismissed', async () => {
    const failed: WorkspaceJob = {
      id: 77, kind: 'collection_purge', status: 'failed', last_error: 'dry run',
      progress: { done: 0, total: 1, dry_run: true, items: [], result: null }, created_at: null, updated_at: null,
    };
    server.use(http.get('/workspaces/{workspace_id}/jobs/{job_id}', ({ response }) => response(200).json(failed)));
    const onSettled = vi.fn();
    const { result } = renderHook(() => useWorkspaceJobs(WS));

    act(() => followJob(WS, { ...failed, status: 'pending' }, { label: 'Deleting Old drafts forever', unit: 'items', onSettled }));
    await tick(JOB_POLL.first);

    expect(onSettled).toHaveBeenCalledTimes(1);
    expect(result.current[0]?.error).toBe('Nothing was deleted: permanent deletion is in a dry run on this server.');
    act(() => dismissJob(result.current[0]?.key ?? ''));
    expect(result.current).toEqual([]);
  });

  it('stops following when the workspace is left', async () => {
    const job = jobState(startJob(WS, 'trash_empty', 3));
    const onSettled = vi.fn();
    const { result } = renderHook(() => useWorkspaceJobs(WS));
    act(() => followJob(WS, job, { label: 'Emptying the Trash', unit: 'items', onSettled }));

    act(() => resetModuleState());
    await tick(20_000);

    expect(result.current).toEqual([]);
    expect(onSettled).not.toHaveBeenCalled();
  });

  it('reads a job of its own workspace only', async () => {
    const job = startJob(WS, 'trash_empty', 1);
    await expect(getJob('wsp-elsewhere', job.id)).rejects.toMatchObject({ status: 404 });
  });
});
