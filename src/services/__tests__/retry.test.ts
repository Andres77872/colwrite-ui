import { describe, it, expect, vi, afterEach } from 'vitest';
import { ApiError } from '../contracts';
import {
  abortableSleep,
  isRetryableProblem,
  isTerminalReadiness,
  MAX_RETRY_DELAY_MS,
  MIN_RETRY_DELAY_MS,
  retryDelayMs,
  retryWaitMs,
} from '../retry';

function problem(body: unknown, status = 503): ApiError {
  return new ApiError('nope', status, body);
}

describe('isRetryableProblem', () => {
  it('accepts the projection lag the server reports as ready', () => {
    // The status column says `ready` for the rest of a document's life once it
    // has been projected even once; the gap between the two sequences is what
    // actually failed. Reading the string as terminal is the bug this guards.
    expect(
      isRetryableProblem(
        problem({
          code: 'projection_pending',
          retryable: true,
          readiness_status: 'ready',
          expected_head_seq: 8,
          applied_head_seq: 3,
        }),
      ),
    ).toBe(true);
  });

  it.each(['deleted', 'deleting', 'failed', 'scope_mismatch', 'conflicting'])(
    'refuses a %s projection, which never catches up',
    (readiness_status) => {
      expect(
        isRetryableProblem(
          problem({ code: 'projection_pending', retryable: true, readiness_status }),
        ),
      ).toBe(false);
    },
  );

  it.each([
    ['history_not_ready', 409],
    ['document_rate_limit_exceeded', 429],
  ])('accepts %s despite its non-503 status', (code, status) => {
    expect(isRetryableProblem(problem({ code, retryable: true }, status))).toBe(true);
  });

  it('refuses a code it does not recognise, even when flagged retryable', () => {
    // Retrying on the flag alone would replay problems whose safety we have
    // not reasoned about — a future code has to be added here deliberately.
    expect(isRetryableProblem(problem({ code: 'some_future_problem', retryable: true }))).toBe(
      false,
    );
  });

  it('refuses a known code the server did not flag', () => {
    expect(isRetryableProblem(problem({ code: 'projection_pending' }))).toBe(false);
  });

  it.each([
    ['a plain body with no problem code', problem({ detail: 'Service unavailable' })],
    ['an ordinary Error', new Error('network down')],
    ['nothing at all', null],
  ])('refuses %s', (_label, error) => {
    expect(isRetryableProblem(error)).toBe(false);
  });
});

describe('isTerminalReadiness', () => {
  it.each(['ready', 'pending', 'missing', 'disabled', 'unavailable'])(
    'treats %s as worth asking again',
    (status) => {
      expect(isTerminalReadiness(status)).toBe(false);
    },
  );

  it('treats an absent status as non-terminal', () => {
    expect(isTerminalReadiness(undefined)).toBe(false);
    expect(isTerminalReadiness(null)).toBe(false);
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
