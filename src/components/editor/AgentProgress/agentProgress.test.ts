import { describe, expect, it } from 'vitest';
import {
  advanceProgress,
  formatDraftSize,
  formatElapsed,
  progressForStatus,
} from './agentProgress';

describe('progressForStatus', () => {
  it('shows the engine’s own wording for starting, retrying and reconnecting', () => {
    expect(progressForStatus('starting', 'Starting Claude Code…')).toEqual({
      phase: 'starting',
      label: 'Starting Claude Code…',
    });
    expect(
      progressForStatus('retrying', 'Claude is overloaded — retrying in 8s (attempt 2 of 10)'),
    ).toEqual({
      phase: 'retrying',
      label: 'Claude is overloaded — retrying in 8s (attempt 2 of 10)',
    });
    expect(progressForStatus('reconnecting', 'Reconnecting to your saved run…')?.phase).toBe('reconnecting');
    expect(progressForStatus('queued', 'Waiting to start…')).toEqual({
      phase: 'queued',
      label: 'Waiting to start…',
    });
  });

  it('reads older and generic statuses as thinking', () => {
    // The gateway's separator status named the wrong step.
    expect(progressForStatus('thinking', 'Processing tool results...')).toEqual({
      phase: 'thinking',
      label: 'Thinking…',
    });
    expect(progressForStatus('running', 'Thinking…')).toEqual({ phase: 'thinking', label: 'Thinking…' });
    expect(progressForStatus('something_new', '')).toEqual({ phase: 'thinking', label: 'Thinking…' });
  });

  it('leaves tool steps to the tool events', () => {
    expect(progressForStatus('executing_tool', 'Running doc_edit...')).toBeNull();
  });
});

describe('advanceProgress', () => {
  it('keeps the start time while the step is the same', () => {
    const current = { phase: 'thinking' as const, label: 'Thinking…', since: 1_000 };
    expect(advanceProgress(current, { phase: 'thinking', label: 'Thinking…' }, 5_000)).toBe(current);
    expect(advanceProgress(current, { phase: 'tool', label: 'Searching the web…' }, 5_000)).toEqual({
      phase: 'tool',
      label: 'Searching the web…',
      since: 5_000,
    });
  });
});

describe('formatting', () => {
  it('formats elapsed time for a status line', () => {
    expect(formatElapsed(-50)).toBe('0s');
    expect(formatElapsed(8_900)).toBe('8s');
    expect(formatElapsed(65_000)).toBe('1m 05s');
  });

  it('formats a drafted size', () => {
    expect(formatDraftSize(2_410)).toBe(`${(2410).toLocaleString()} characters`);
    expect(formatDraftSize(12_400)).toBe('12.4k characters');
  });
});
