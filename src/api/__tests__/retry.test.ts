import { describe, it, expect, vi, afterEach } from 'vitest';
import { ApiError } from '@/api/errors';
import {
  abortableSleep,
  isRetryableProblem,
  mayReplay,
  MAX_RETRY_DELAY_MS,
  MIN_RETRY_DELAY_MS,
  retryDelayMs,
  retryWaitMs,
} from '../retry';

function problem(body: unknown, status = 503): ApiError {
  return new ApiError('nope', status, body);
}

describe('isRetryableProblem', () => {
  it('accepts document_rate_limit_exceeded despite its non-503 status', () => {
    // A status-code test would miss the code the client replays, which is
    // why the gate reads `code` instead.
    expect(isRetryableProblem(problem({ code: 'document_rate_limit_exceeded', retryable: true }, 429))).toBe(true);
  });

  it('refuses a code it does not recognise, even when flagged retryable', () => {
    // Retrying on the flag alone would replay problems whose safety we have
    // not reasoned about — a future code has to be added here deliberately.
    expect(isRetryableProblem(problem({ code: 'some_future_problem', retryable: true }))).toBe(
      false,
    );
  });

  it('refuses a known code the server did not flag', () => {
    expect(isRetryableProblem(problem({ code: 'document_rate_limit_exceeded' }, 429))).toBe(false);
  });

  it.each([
    ['a plain body with no problem code', problem({ detail: 'Service unavailable' })],
    ['an ordinary Error', new Error('network down')],
    ['nothing at all', null],
  ])('refuses %s', (_label, error) => {
    expect(isRetryableProblem(error)).toBe(false);
  });
});

describe('mayReplay', () => {
  const read = new Request('http://x/workspaces/w/documents', { method: 'GET' });
  const keyed = new Request('http://x/workspaces/w/documents', { method: 'POST', headers: { 'Idempotency-Key': 'k' } });
  const unkeyed = new Request('http://x/workspaces/w/documents/d/move', { method: 'POST', headers: { 'If-Match': '"cwp:1"' } });
  const timedOut = problem({ code: 'timeout', retryable: true }, 504);
  const rateLimited = problem({ code: 'rate_limited', retryable: true }, 429);

  it('replays a read or a keyed write on any retryable problem', () => {
    expect(mayReplay(read, timedOut)).toBe(true);
    expect(mayReplay(keyed, timedOut)).toBe(true);
    expect(mayReplay(read, problem({ code: 'unavailable', retryable: true }))).toBe(true);
  });

  it('replays an asset store problem only for reads or keyed writes, never an unkeyed publication', () => {
    const unavailable = problem({ code: 'asset_storage_unavailable', retryable: true, retry_after: 1 });
    expect(mayReplay(read, unavailable)).toBe(true);
    expect(mayReplay(keyed, unavailable)).toBe(true);
    expect(mayReplay(unkeyed, unavailable)).toBe(false);
  });

  it('replays an unkeyed write only on a problem refused before any work', () => {
    expect(mayReplay(unkeyed, timedOut)).toBe(false);
    expect(mayReplay(unkeyed, rateLimited)).toBe(true);
  });

  it('never replays what the server did not call retryable', () => {
    expect(mayReplay(read, problem({ code: 'stale_head' }, 412))).toBe(false);
  });
});

describe('retryDelayMs', () => {
  it("prefers the server's hint over our own backoff", () => {
    expect(retryDelayMs(1, 500, 2)).toBe(2000);
    expect(retryDelayMs(3, 500, 2)).toBe(2000);
  });

  it('clamps a hint into the window we are willing to wait', () => {
    expect(retryDelayMs(1, 500, 0.05)).toBe(MIN_RETRY_DELAY_MS);
    expect(retryDelayMs(1, 500, 600)).toBe(MAX_RETRY_DELAY_MS);
  });

  it('grows and stays inside the bounds without a hint', () => {
    const first = retryDelayMs(1, 500, null);
    const later = retryDelayMs(4, 500, null);
    expect(first).toBeGreaterThanOrEqual(MIN_RETRY_DELAY_MS);
    expect(first).toBeLessThanOrEqual(MAX_RETRY_DELAY_MS);
    expect(later).toBe(MAX_RETRY_DELAY_MS);
  });
});

describe('retryWaitMs', () => {
  it('gives up rather than come back early on a long hint', () => {
    // Clamping a minute-long rate-limit hint down to five seconds would
    // return before the server is ready and make the limit worse.
    expect(retryWaitMs(1, 500, 60)).toBeNull();
  });

  it('waits out a hint inside the window', () => {
    expect(retryWaitMs(1, 500, 2)).toBe(2000);
  });
});

describe('abortableSleep', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('resolves once the delay elapses', async () => {
    vi.useFakeTimers();
    const settled = vi.fn();
    const promise = abortableSleep(1000).then(settled);
    await vi.advanceTimersByTimeAsync(999);
    expect(settled).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    await promise;
    expect(settled).toHaveBeenCalled();
  });

  it('rejects immediately when the signal is already aborted', async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(abortableSleep(1000, controller.signal)).rejects.toThrow('Aborted');
  });

  it('rejects when the signal aborts mid-wait', async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    const expectation = expect(abortableSleep(5000, controller.signal)).rejects.toThrow('Aborted');
    await vi.advanceTimersByTimeAsync(100);
    controller.abort();
    await expectation;
  });
});
