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
  it('shows the failure cause inline for a failed run', () => {
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
    fireEvent.click(screen.getByRole('button', { name: /1 step/ }));
    expect(screen.getByText(/1 failed/)).toBeTruthy();
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
    expect(screen.getByText(/1 interrupted/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /2 steps/ }));
    expect(screen.getByText(/— interrupted/)).toBeTruthy();
  });

  it('reveals input and output previews behind the Details disclosure', () => {
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
    fireEvent.click(screen.getByRole('button', { name: /1 step/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Details' }));
    expect(screen.getByText('Input')).toBeTruthy();
    expect(screen.getByText(/transformer attention/)).toBeTruthy();
    expect(screen.getByText(/Output/)).toBeTruthy();
    expect(screen.getByText(/"Attention"/)).toBeTruthy();
    // The preview is a slice; say so.
    expect(screen.getByText(/of 48,000 characters/)).toBeTruthy();
  });

  it('flags output the assistant only partially saw', () => {
    render(
      <AgentActivity
        live={false}
        runs={[doneRun({ outputTruncated: true })]}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /1 step/ }));
    expect(
      screen.getByText(/cut at the size limit; the assistant saw only part of it/),
    ).toBeTruthy();
  });

  it('shows token usage once the turn is over', () => {
    render(
      <AgentActivity
        live={false}
        runs={[doneRun()]}
        usage={{ promptTokens: 12_400, completionTokens: 890 }}
      />,
    );
    expect(screen.getByText(/12\.4k in · 890 out/)).toBeTruthy();
  });

  it('can be collapsed while live, and aria-expanded tells the truth', () => {
    render(
      <AgentActivity
        live
        runs={[doneRun({ state: 'running' })]}
      />,
    );
    const toggle = screen.getAllByRole('button')[0];
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    fireEvent.click(toggle);
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
  });

  it('headlines the tool that is running now, not the last one finished', () => {
    render(
      <AgentActivity
        live
        runs={[
          doneRun({ id: 'call-a', tool: 'doc_read' }),
          doneRun({ id: 'call-b', tool: 'search_citations', state: 'running' }),
          doneRun({ id: 'call-c', tool: 'doc_read' }),
        ]}
      />,
    );
    expect(screen.getByText(/Searching for sources…/)).toBeTruthy();
  });
});
