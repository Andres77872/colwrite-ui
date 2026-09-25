import { describe, it, expect, afterEach } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { AgentActivity } from '../AgentActivity';
import type { ToolRun } from '../AgentActivity';

/**
 * The activity list is where a writer learns what the assistant actually did —
 * and, when something failed, why. These tests pin the contract that failure
 * causes are visible without extra clicks, unresolved calls are never painted
 * as successes, and the input/output details stay one disclosure away.
 */

afterEach(cleanup);

const doneRun = (over: Partial<ToolRun> = {}): ToolRun => ({
  id: 'call-1',
  tool: 'semantic_scholar_search',
  state: 'done',
  durationMs: 1200,
  ...over,
});

describe('AgentActivity', () => {
  it('shows each run as one line with its duration', () => {
    render(<AgentActivity live={false} runs={[doneRun()]} />);
    expect(screen.getByText('Searched Semantic Scholar')).toBeTruthy();
    expect(screen.getByText(/· 1\.2s/)).toBeTruthy();
    expect(screen.getByText('finished')).toBeTruthy();
  });

  it('shows the failure cause inline for a failed run, without a click', () => {
    render(
      <AgentActivity
        live={false}
        runs={[
          doneRun({
            state: 'error',
            error: "Tool 'semantic_scholar_search' timed out after 90.0s",
            errorType: 'TimeoutError',
          }),
        ]}
      />,
    );
    expect(screen.getByText('failed')).toBeTruthy();
    expect(
      screen.getByText(/Took too long and was stopped — Tool 'semantic_scholar_search' timed out/),
    ).toBeTruthy();
  });

  it('renders interrupted runs as interrupted, not done', () => {
    render(
      <AgentActivity
        live={false}
        runs={[doneRun(), doneRun({ id: 'call-2', state: 'interrupted' })]}
      />,
    );
    expect(screen.getByText(/— interrupted/)).toBeTruthy();
    expect(screen.getByText('interrupted')).toBeTruthy();
    expect(screen.getAllByText('finished')).toHaveLength(1);
  });

  it('reveals input and output previews when a run is opened', () => {
    render(
      <AgentActivity
        live={false}
        runs={[
          doneRun({
            args: { query: 'transformer attention' },
            outputPreview: '{"papers": [{"title": "Attention"}]}',
            outputChars: 48_000,
          }),
        ]}
      />,
    );
    const line = screen.getByRole('button', { name: /Searched Semantic Scholar/ });
    expect(line.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(line);
    expect(line.getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByText('Input')).toBeTruthy();
    expect(screen.getByText(/transformer attention/)).toBeTruthy();
    expect(screen.getByText(/Output/)).toBeTruthy();
    expect(screen.getByText(/"Attention"/)).toBeTruthy();
    // The preview is a slice; say so.
    expect(screen.getByText(/of 48,000 characters/)).toBeTruthy();
  });

  it('flags output the assistant only partially saw', () => {
    render(<AgentActivity live={false} runs={[doneRun({ outputTruncated: true })]} />);
    fireEvent.click(screen.getByRole('button', { name: /Searched Semantic Scholar/ }));
    expect(
      screen.getByText(/cut at the size limit; the assistant saw only part of it/),
    ).toBeTruthy();
  });

  it('folds a long finished run under one summary line', () => {
    const runs = [1, 2, 3, 4].map((n) => doneRun({ id: `call-${n}` }));
    runs[2] = { ...runs[2], state: 'error' };
    render(<AgentActivity live={false} runs={runs} />);

    const summary = screen.getByRole('button', { name: /Used 4 tools/ });
    expect(screen.getByText(/1 failed/)).toBeTruthy();
    expect(summary.getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByText('Searched Semantic Scholar')).toBeNull();

    fireEvent.click(summary);
    expect(summary.getAttribute('aria-expanded')).toBe('true');
    expect(screen.getAllByText('Searched Semantic Scholar')).toHaveLength(4);
  });

  it('keeps every step in view while the turn is live', () => {
    const runs = [1, 2, 3, 4].map((n) => doneRun({ id: `call-${n}` }));
    render(<AgentActivity live runs={runs} />);
    expect(screen.queryByRole('button', { name: /Used 4 tools/ })).toBeNull();
    expect(screen.getAllByText('Searched Semantic Scholar')).toHaveLength(4);
  });

  it('names the tool that is running now in its present tense', () => {
    render(
      <AgentActivity
        live
        runs={[
          doneRun({ id: 'call-a', tool: 'doc_read' }),
          doneRun({ id: 'call-b', tool: 'search_citations', state: 'running' }),
        ]}
      />,
    );
    expect(screen.getByText(/Searching for sources…/)).toBeTruthy();
    expect(screen.getByText('running')).toBeTruthy();
  });
});
