import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import { ChartFigure } from './ChartFigure';

afterEach(cleanup);

describe('ChartFigure data access', () => {
  it('exposes every bar as a row in a visually hidden table', () => {
    render(<ChartFigure kind="bar" values={[3, 7]} labels={['Alpha', 'Beta']} />);

    // The svg only announces "bar chart with 2 values"; the numbers themselves
    // need a text structure, which is what the pie's visible legend already is.
    expect(screen.getByRole('img', { name: 'bar chart with 2 values' })).toBeTruthy();
    const table = screen.getByRole('table', { name: 'bar chart data' });
    expect(table.className).toContain('sr-only');

    for (const [label, value] of [['Alpha', '3'], ['Beta', '7']] as const) {
      const row = within(table).getByRole('rowheader', { name: label }).closest('tr')!;
      expect(within(row).getByRole('cell', { name: value })).toBeTruthy();
    }
  });

  it('names the columns from the axis labels when they are set', () => {
    render(
      <ChartFigure kind="line" values={[1]} labels={['2024']} xLabel="Year" yLabel="Citations" />,
    );

    const table = screen.getByRole('table', { name: 'line chart data' });
    expect(within(table).getByRole('columnheader', { name: 'Year' })).toBeTruthy();
    expect(within(table).getByRole('columnheader', { name: 'Citations' })).toBeTruthy();
  });

  it('leaves the pie chart to its visible legend instead', () => {
    render(<ChartFigure kind="pie" values={[3, 7]} labels={['Alpha', 'Beta']} />);

    expect(screen.queryByRole('table')).toBeNull();
    expect(screen.getByRole('img', { name: 'Pie chart with 2 slices' })).toBeTruthy();
  });
});
