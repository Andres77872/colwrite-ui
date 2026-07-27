import { describe, it, expect, afterEach } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import type { ActivityDay } from '@/services/userProfile';
import { ActivityChart } from '../ActivityChart';

afterEach(cleanup);

/** ISO day `offset` days before today, matching what the API returns. */
function daysAgo(offset: number): string {
  const date = new Date();
  date.setHours(0, 0, 0, 0);
  date.setDate(date.getDate() - offset);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(
    date.getDate(),
  ).padStart(2, '0')}`;
}

const SAMPLE: ActivityDay[] = [
  { day: daysAgo(1), document_events: 4, agent_run_events: 2, upload_events: 1 },
  { day: daysAgo(5), document_events: 9, agent_run_events: 0, upload_events: 0 },
];

describe('ActivityChart', () => {
  it('reports nothing to show when the window is empty', () => {
    render(<ActivityChart activity={[]} days={30} />);

    expect(screen.getByText('No activity yet')).toBeTruthy();
  });

  it('always shows a legend, so identity never rests on colour alone', () => {
    render(<ActivityChart activity={SAMPLE} days={30} />);

    for (const label of ['Document edits', 'Assistant runs', 'Uploads']) {
      expect(screen.getAllByText(label).length).toBeGreaterThan(0);
    }
  });

  it('totals each series in the legend', () => {
    render(<ActivityChart activity={SAMPLE} days={30} />);

    // 4 + 9 document edits across the window.
    expect(screen.getByText('13')).toBeTruthy();
  });

  it('renders one focusable column per day in the window', () => {
    render(<ActivityChart activity={SAMPLE} days={7} />);

    // Every column is a button so a keyboard user reaches the same values a
    // pointer user gets from hovering.
    expect(screen.getAllByRole('button').filter((node) =>
      node.getAttribute('aria-label')?.includes('event'),
    )).toHaveLength(7);
  });

  it('fills days the API omitted with zero rather than dropping them', () => {
    render(<ActivityChart activity={SAMPLE} days={7} />);

    const quiet = screen
      .getAllByRole('button')
      .filter((node) => node.getAttribute('aria-label')?.includes('0 events'));
    // Seven days, two of which had activity.
    expect(quiet).toHaveLength(5);
  });

  it('names the day and its total on each column for assistive tech', () => {
    render(<ActivityChart activity={SAMPLE} days={30} />);

    const columns = screen
      .getAllByRole('button')
      .map((node) => node.getAttribute('aria-label') ?? '');
    expect(columns.some((label) => label.endsWith(': 7 events'))).toBe(true);
    expect(columns.some((label) => label.endsWith(': 9 events'))).toBe(true);
  });

  it('shows a per-day tooltip on focus', () => {
    render(<ActivityChart activity={SAMPLE} days={30} />);

    const busiest = screen
      .getAllByRole('button')
      .find((node) => node.getAttribute('aria-label')?.endsWith(': 7 events'));
    fireEvent.focus(busiest!);

    const tooltip = screen.getByRole('status');
    expect(within(tooltip).getByText('Uploads')).toBeTruthy();
  });

  it('offers a table twin so values are reachable without hovering', () => {
    render(<ActivityChart activity={SAMPLE} days={30} />);

    fireEvent.click(screen.getByRole('button', { name: 'Table' }));

    const table = screen.getByRole('table');
    // Only days that happened; a run of zero rows says nothing.
    expect(within(table).getAllByRole('row')).toHaveLength(3);
    expect(within(table).getByText('Daily activity counts')).toBeTruthy();
  });
});
