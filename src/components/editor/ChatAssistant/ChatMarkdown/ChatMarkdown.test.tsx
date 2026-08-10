import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ChatMarkdown } from './ChatMarkdown';

/**
 * Regression coverage for the render-loop hang: the fence detector used to
 * require a single-word info string (`/^```(\w*)\s*$/`) while the paragraph
 * branch excluded ANY line starting with ```. A fence that failed the strict
 * regex was consumed by neither branch, so `index` never advanced and the
 * render looped forever — a tab-locking DoS reachable from ordinary model
 * output like ```bash (run this).
 *
 * These tests mostly assert termination: if parseBlocks regresses, the test
 * worker hangs instead of failing.
 */
describe('ChatMarkdown fence parsing', () => {
  const hangInducing = [
    '```bash (run this)\nls -la\n```',
    '``` python\nprint(1)\n```',
    '```js title="a.js"\nconst a = 1;\n```',
    'Some prose\n```diff patch\n-a\n+b\n```',
    '```py t', // mid-stream partial opener
    '```', // bare opener, unterminated
    '```\ncode without closer',
  ];

  it.each(hangInducing)('terminates on %j', (text) => {
    const { container } = render(<ChatMarkdown text={text} />);
    expect(container.firstChild).not.toBeNull();
  });

  it('renders a well-formed fence with its language', () => {
    const { container } = render(<ChatMarkdown text={'```python\nprint(1)\n```'} />);
    const pre = container.querySelector('pre');
    expect(pre).not.toBeNull();
    expect(pre?.textContent).toContain('print(1)');
  });

  it('treats a fence with a spaced info string as code, using the first word as lang', () => {
    const { container } = render(<ChatMarkdown text={'```bash (run this)\nls -la\n```'} />);
    const pre = container.querySelector('pre');
    expect(pre?.textContent).toContain('ls -la');
  });

  it('still renders surrounding prose and inline tokens', () => {
    render(<ChatMarkdown text={'Before **bold** and `code`.\n\n```\nx\n```\n\nAfter.'} />);
    expect(screen.getByText(/Before/)).toBeTruthy();
    expect(screen.getByText(/After/)).toBeTruthy();
  });
});
