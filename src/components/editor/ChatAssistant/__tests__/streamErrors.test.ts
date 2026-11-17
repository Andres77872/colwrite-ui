import { describe, expect, it } from 'vitest';
import { friendlyStreamError } from '../chatUtils';

/**
 * How a run that ended on a refusal is worded: what happened, what to do
 * next, and whether asking again can help.
 */
describe('a run refused for what it read', () => {
  it('says the assistant read outside material, so it cannot create a page in this run, and not to retry', () => {
    const detail = 'This run has read untrusted content, so it can no longer create a page.';
    expect(friendlyStreamError('untrusted_content', detail)).toEqual({
      message: 'The assistant read outside material in this run, so it can propose changes but not create pages. Start a new message to create one.',
      detail,
      retryable: false,
    });
  });
});

describe('a local engine that failed', () => {
  it('words any other CLI failure on its own, with the CLI’s words as the detail, even when they quote a 401 or a 429', () => {
    for (const cli of [
      'Claude Code failed: the web_read tool answered 401 Unauthorized from example.org',
      'Codex failed: upstream provider said 429 rate limit for model gpt-6.1',
    ]) {
      const error = friendlyStreamError('ENGINE_FAILED', cli);
      expect(error.message).toBe(
        'The selected engine stopped with an error. Try again; if it keeps failing, switch engines from the menu next to the # button, or in Settings → AI & tools.',
      );
      expect(error.message).not.toMatch(/sign|log ?in|plan|usage limit/i);
      expect(error).toMatchObject({ detail: cli, retryable: true });
    }
  });

  it('keeps a sign-in and a plan limit, which the API now names only from the CLI’s own words, as things to act on', () => {
    expect(friendlyStreamError('ENGINE_AUTH_REQUIRED', 'Claude Code is not signed in.')).toMatchObject({ retryable: false });
    expect(friendlyStreamError('ENGINE_AUTH_REQUIRED', 'Claude Code is not signed in.').message).toContain('Claude Code is not signed in.');
    expect(friendlyStreamError('ENGINE_RATE_LIMITED', 'Your Claude plan’s usage limit was reached: …')).toMatchObject({ retryable: true });
  });
});

describe('a run from a plan, and a resume', () => {
  it('words a plan that is no longer open or changed since as things to fix, not to retry', () => {
    expect(friendlyStreamError('PLAN_NOT_FOUND', 'The plan is done.')).toMatchObject({
      message: expect.stringContaining('That plan is no longer open'), detail: 'The plan is done.', retryable: false,
    });
    expect(friendlyStreamError('STALE_PLAN', '')).toMatchObject({
      message: expect.stringContaining('The plan changed since'), detail: 'STALE_PLAN', retryable: false,
    });
  });

  it('offers to ask again when a run cannot be resumed', () => {
    expect(friendlyStreamError('RUN_NOT_RESUMABLE', 'Its tools changed.')).toMatchObject({
      message: expect.stringContaining('can’t be resumed'), detail: 'Its tools changed.', retryable: true,
    });
  });
});
