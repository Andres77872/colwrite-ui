import { itemAt } from '@/lib/itemAt';
import { agentWorker } from '@/__tests__/agentWorker';
import { describe, it, expect, afterEach } from 'vitest';
import { cleanup, fireEvent, render as plainRender, screen } from '@testing-library/react';
import type { ReactElement, ReactNode } from 'react';
import { AssistantCatalogContext, catalogValue } from '@/components/preferences/assistantCatalogContextState';
import { PERSONAL_WORKSPACE_ID, catalogOf } from '@/dev/msw/fixtures';
import { AgentActivity } from '../AgentActivity';
import type { ToolRun } from '../AgentActivity';
import { decodeAgentEvent, handleAgentEvent } from '@/api/assistant/streamParser';
import type { AgentWorker } from '@/api/assistant/streamParser';
import { withToolEnd, withToolStart, withWorker } from '../transcript';
import type { ChatMessage } from '../chatUtils';

/**
 * The activity list is where a writer learns what the assistant actually did —
 * and, when something failed, why. These tests pin the contract that failure
 * causes are visible without extra clicks, unresolved calls are never painted
 * as successes, and the input/output details stay one disclosure away.
 */

afterEach(cleanup);

/** Rendered in a workspace whose catalog is the mock API's: rows are named from it. */
function CatalogWrapper({ children }: { children: ReactNode }) {
  return <AssistantCatalogContext.Provider value={catalogValue(catalogOf(PERSONAL_WORKSPACE_ID), false, null)}>{children}</AssistantCatalogContext.Provider>;
}
const render = (ui: ReactElement) => plainRender(ui, { wrapper: CatalogWrapper });

const doneRun = (over: Partial<ToolRun> = {}): ToolRun => ({
  id: 'call-1',
  tool: 'paper_search',
  state: 'done',
  durationMs: 1200,
  ...over,
});

describe('AgentActivity', () => {
  it('shows each run as one line with its duration', () => {
    render(<AgentActivity live={false} runs={[doneRun()]} />);
    expect(screen.getByText('Searched for papers')).toBeTruthy();
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
            error: 'External research tool failed; content-bearing details redacted.',
            errorType: 'timeout',
            outputPreview: '{"content_redacted": true, "status": "error", "code": "timeout"}',
          }),
        ]}
      />,
    );
    expect(screen.getByText('failed')).toBeTruthy();
    expect(
      screen.getByText('Took too long and was stopped — External research tool failed; content-bearing details redacted.'),
    ).toBeTruthy();
    // A failure's preview holds only its code: the row names the code once, not as output.
    fireEvent.click(screen.getByRole('button', { name: /Searched for papers/ }));
    expect(screen.getByText('timeout').closest('p')?.textContent).toBe('Error type: timeout');
    expect(screen.queryByText('Output')).toBeNull();
  });

  it.each([
    ['timeout', 'Took too long and was stopped'],
    ['tool_cancelled', 'Cancelled before it finished'],
    ['invalid_request', 'The assistant wrote an invalid request'],
    ['repeated_call', 'The same call had already failed twice, so it was not run again'],
    ['internal_error', 'The tool ran into an error'],
    ['budget_exhausted', 'This reply used up its allowance for this kind of step'],
    ['run_stopped', 'The run stopped before this step ran'],
    ['worker_failed', 'The research worker could not finish'],
    ['provider_rate_limited', 'The research service is busy'],
    ['provider_unavailable', 'The research service is unavailable'],
    ['provider_failed', 'The research service could not answer'],
    // A code this client has no words for.
    ['bad_gateway', 'Failed'],
  ])('leads a %s failure with what it means', (errorType, lead) => {
    render(<AgentActivity live={false} runs={[doneRun({ state: 'error', error: 'Server text.', errorType })]} />);
    expect(screen.getByText(`${lead} — Server text.`)).toBeTruthy();
  });

  it('says why a page was not created after the run read outside material (untrusted_content)', () => {
    const detail = 'This run has read untrusted content (a PDF, a paper, a web page or a research worker\'s report), so it can no longer create a page.';
    render(
      <AgentActivity
        live={false}
        runs={[doneRun({ id: 'call-2', tool: 'doc_create', state: 'error', error: detail, errorType: 'untrusted_content' })]}
      />,
    );
    expect(
      screen.getByText(
        'The assistant read outside material in this run, so it can propose changes but not create pages. Start a new message to create one — ' + detail,
      ),
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
            args: { content_redacted: true, query_redacted: true, query_length: 21, limit: 10 },
            outputPreview: '{"content_redacted": true, "papers_count": 5, "providers_count": 1}',
            outputChars: 48_000,
          }),
        ]}
      />,
    );
    const line = screen.getByRole('button', { name: /Searched for papers/ });
    expect(line.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(line);
    expect(line.getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByText('Input')).toBeTruthy();
    expect(screen.getByText(/"query_length": 21/)).toBeTruthy();
    expect(screen.getByText(/Output/)).toBeTruthy();
    expect(screen.getByText(/"papers_count": 5/)).toBeTruthy();
    // The preview is the server's projection of the result, not its start.
    expect(screen.getByText(/summary of 48,000 characters/)).toBeTruthy();
  });

  it('shows a result fitted under its limit as a success, with a quiet note', () => {
    render(<AgentActivity live={false} runs={[doneRun({ outputTruncated: true })]} />);
    const line = screen.getByRole('button', { name: /Searched for papers/ });
    expect(line.textContent).toContain('finished');
    expect(screen.queryByText(/failed/)).toBeNull();
    fireEvent.click(line);
    expect(screen.getByText('Trimmed to fit: the assistant read a shortened result.')).toBeTruthy();
  });

  it('folds a long finished run under one summary line', () => {
    const runs = [1, 2, 3, 4].map((n) => doneRun({ id: `call-${n}` }));
    runs[2] = { ...itemAt(runs, 2), state: 'error' };
    render(<AgentActivity live={false} runs={runs} />);

    const summary = screen.getByRole('button', { name: /Used 4 tools/ });
    expect(screen.getByText(/1 failed/)).toBeTruthy();
    expect(summary.getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByText('Searched for papers')).toBeNull();

    fireEvent.click(summary);
    expect(summary.getAttribute('aria-expanded')).toBe('true');
    expect(screen.getAllByText('Searched for papers')).toHaveLength(4);
  });

  it('keeps every step in view while the turn is live', () => {
    const runs = [1, 2, 3, 4].map((n) => doneRun({ id: `call-${n}` }));
    render(<AgentActivity live runs={runs} />);
    expect(screen.queryByRole('button', { name: /Used 4 tools/ })).toBeNull();
    expect(screen.getAllByText('Searched for papers')).toHaveLength(4);
  });

  it('names the tool that is running now in its present tense', () => {
    render(
      <AgentActivity
        live
        runs={[
          doneRun({ id: 'call-a', tool: 'doc_read' }),
          doneRun({ id: 'call-b', tool: 'paper_search', state: 'running' }),
        ]}
      />,
    );
    expect(screen.getByText(/Searching for papers…/)).toBeTruthy();
    expect(screen.getByText('running')).toBeTruthy();
  });
});

describe('research workers in the activity list', () => {
  const runs: ToolRun[] = [
    doneRun({ id: 'call-1', tool: 'delegate' }),
    doneRun({ id: 'w1:call_a', tool: 'web_search' }),
    doneRun({ id: 'w2:call_a', tool: 'paper_search' }),
    doneRun({ id: 'w1:call_b', tool: 'web_read', state: 'running', durationMs: undefined }),
  ];
  const workers: AgentWorker[] = [
    agentWorker({ status: 'running' }),
    agentWorker({ id: 'w2', title: 'Related work' }),
  ];

  it('gathers each worker\u2019s steps under its own line', () => {
    render(<AgentActivity live runs={runs} workers={workers} />);

    // The assistant's own list holds its call and the two workers.
    const own = screen.getByRole('list', { name: 'What the assistant did' });
    expect(own.querySelectorAll(':scope > li')).toHaveLength(3);

    // A working worker is open; its steps are its own, in order.
    const first = screen.getByRole('list', { name: "Web researcher · Routing evidence's steps" });
    expect(first.textContent).toContain('Searched the web');
    expect(first.textContent).not.toContain('papers');
    expect(screen.getByRole('button', { name: /Web researcher.*Routing evidence.*working.*2 steps/ })).toBeTruthy();

    // A finished one folds to its line, and opens on request.
    const second = screen.getByRole('button', { name: /Web researcher.*Related work.*reported back.*1 step/ });
    expect(second.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(second);
    expect(screen.getByRole('list', { name: "Web researcher · Related work's steps" }).textContent).toContain('Searched for papers');
  });

  it.each([
    ['failed', false, 'could not finish'],
    ['partial', false, 'reported back with partial findings'],
    ['budget_exceeded', false, 'stopped at its limit'],
    ['cancelled', false, 'stopped'],
    ['running', false, 'interrupted'],
    ['running', true, 'working'],
    ['queued', true, 'waiting to start'],
    // A queued worker always ends; a turn over with it queued ended around it.
    ['queued', false, 'interrupted'],
  ])('says how a worker with status %s (live: %s) ended', (status, live, text) => {
    render(<AgentActivity live={live} runs={[]} workers={[{ ...agentWorker(), status }]} />);
    expect(screen.getByText(new RegExp(`Web researcher.*Routing evidence.*${text}`))).toBeTruthy();
  });

  it('keeps one named line for a worker from queued through running to reported back', () => {
    // The events as the stream delivers them, through the decoder and the
    // transcript's own update, as the chat turn applies them.
    let message: ChatMessage = { id: 'a1', role: 'assistant', content: '', runs: [], changeSetIds: [] };
    const subagent = (id: string, status: string) => {
      const event = decodeAgentEvent('subagent', { ...agentWorker({ id, title: id === 'w1' ? 'Routing evidence' : 'Related work' }), status });
      if (!event) throw new Error('subagent event refused');
      handleAgentEvent(event, { onSubagent: (worker) => { message = withWorker(message, worker); } });
    };
    const view = () => <AgentActivity live runs={message.runs} workers={message.workers} />;

    subagent('w1', 'queued');
    const { rerender } = render(view());
    expect(screen.getByText(/Web researcher.*Routing evidence.*waiting to start…/)).toBeTruthy();
    expect(screen.queryByText(/working/)).toBeNull();

    // It gets a slot and takes a step, while a second worker waits.
    subagent('w1', 'running');
    subagent('w2', 'queued');
    message = withToolStart(message, { id: 'w1:call_a', tool: 'web_search', display: null }, 0);
    rerender(view());
    expect(screen.getByRole('button', { name: /Web researcher.*Routing evidence.*working.*1 step/ })).toBeTruthy();
    expect(screen.getByRole('list', { name: "Web researcher · Routing evidence's steps" }).textContent).toContain('Searching the web');
    expect(screen.getByText(/Web researcher.*Related work.*waiting to start…/)).toBeTruthy();

    message = withToolEnd(message, {
      tool: 'web_search', toolCallId: 'w1:call_a', durationMs: 900, isError: false, error: null, errorType: null,
      outputPreview: '{"content_redacted": true, "result_count": 6}', outputChars: 120, outputTruncated: false, argumentsPreview: '{}', argumentsTruncated: false,
    });
    subagent('w1', 'completed');
    rerender(view());
    expect(message.workers?.map((worker) => [worker.id, worker.status])).toEqual([['w1', 'completed'], ['w2', 'queued']]);
    const own = screen.getByRole('list', { name: 'What the assistant did' });
    expect(own.querySelectorAll(':scope > li')).toHaveLength(2);
    expect(screen.getByRole('button', { name: /Web researcher.*Routing evidence.*reported back.*1 step/ })).toBeTruthy();
    expect(screen.getByText(/Web researcher.*Related work.*waiting to start…/)).toBeTruthy();
  });

  it.each([
    ['library_reader', 'Library reader'],
    ['reviewer', 'Reviewer'],
  ] as const)('names the %s profile from the catalog', (profile, label) => {
    render(<AgentActivity live={false} runs={[]} workers={[agentWorker({ profile, status: 'partial' })]} />);
    expect(screen.getByText(`${label} · Routing evidence`, { exact: false }).textContent).toContain('partial findings');
    expect(screen.queryByText(/interrupted|could not finish/)).toBeNull();
  });

  it('counts the workers in the folded summary of a finished turn', () => {
    render(<AgentActivity live={false} runs={runs.map((run) => ({ ...run, state: 'done' as const }))} workers={workers.map((worker) => ({ ...worker, status: 'completed' }))} />);
    expect(screen.getByRole('button', { name: /Used 4 tools.*2 research workers/ })).toBeTruthy();
  });
});

describe('a tool row named by the catalog (P1.UI-1)', () => {
  const display = { label: 'Read the page outline', running_label: 'Reading the page outline', icon: 'file-search', detail_templates: ['{sections_count} sections'], value_labels: {} };

  it('names a call with its catalog row: label, icon and the first detail template it can fill', () => {
    render(<AgentActivity live={false} runs={[doneRun({ args: { content_redacted: true, query_redacted: true, year_from: 2019, year_to: 2023 } })]} />);
    const row = screen.getByRole('button', { name: /Searched for papers/ });
    expect(row.querySelector('svg.lucide-book-open')).toBeTruthy();
    fireEvent.click(row);
    expect(screen.getByText('Published 2019–2023')).toBeTruthy();
  });

  it('falls to a later template when an earlier one has no value, and to none when no template can be filled', () => {
    const { rerender } = render(<AgentActivity live={false} runs={[doneRun({ args: { year_to: 2023 } })]} />);
    fireEvent.click(screen.getByRole('button', { name: /Searched for papers/ }));
    expect(screen.getByText('Published up to 2023')).toBeTruthy();
    rerender(<AgentActivity live={false} runs={[doneRun({ id: 'call-2', args: { query_redacted: true } })]} />);
    fireEvent.click(screen.getByRole('button', { name: /Searched for papers/ }));
    expect(screen.queryByText(/Published/)).toBeNull();
  });

  it('writes an enum argument in the words the catalog gives its values', () => {
    render(<AgentActivity live={false} runs={[doneRun({ id: 'call-g', tool: 'paper_graph', args: { content_redacted: true, relation: 'citations' } })]} />);
    fireEvent.click(screen.getByRole('button', { name: /Explored the citation graph/ }));
    expect(screen.getByText('Following the papers citing it')).toBeTruthy();
  });

  it('renders a tool the catalog does not list from its start event’s display, with its label and icon', () => {
    render(<AgentActivity live runs={[doneRun({ id: 'call-o', tool: 'page_outline', state: 'running', durationMs: undefined, display })]} />);
    const running = screen.getByText('Reading the page outline…').closest('li');
    expect(running?.querySelector('svg.lucide-file-search')).toBeTruthy();
    cleanup();
    render(<AgentActivity live={false} runs={[doneRun({ id: 'call-o', tool: 'page_outline', display, args: { sections_count: 4 } })]} />);
    fireEvent.click(screen.getByRole('button', { name: /Read the page outline/ }));
    expect(screen.getByText('4 sections')).toBeTruthy();
  });

  it('reads as its id a tool neither the catalog nor its events name, with a generic icon', () => {
    render(<AgentActivity live={false} runs={[doneRun({ tool: 'citation_audit' })]} />);
    const row = screen.getByText('citation audit').closest('li');
    expect(row?.querySelector('svg.lucide-wand-sparkles, svg.lucide-wand2, svg.lucide-wand')).toBeTruthy();
  });
});

describe('a tool row for every reader (U-17)', () => {
  it('keeps the disclosure chevron visible where there is no hover', () => {
    render(<AgentActivity live={false} runs={[doneRun({ args: { content_redacted: true, year_from: 2020 } })]} />);
    const chevron = screen.getByRole('button', { name: /Searched for papers/ }).querySelector('svg.lucide-chevron-right');
    expect(chevron?.getAttribute('class')).toContain('[@media(hover:none)]:opacity-100');
  });

  it('gives a running call’s size and time a text alternative, in coarse steps', () => {
    render(
      <AgentActivity
        live
        runs={[doneRun({ tool: 'doc_edit', state: 'running', durationMs: undefined, startedAt: Date.now() - 25_000, argumentsChars: 2410 })]}
      />,
    );
    const row = screen.getByText(/Drafting changes/).closest('li');
    expect(row?.textContent).toContain('2,410 characters written, for 20 seconds');
  });
});
