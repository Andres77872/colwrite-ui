import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

// jsdom cannot lay a diagram out; the real pipeline (src/lib/mermaid.ts) runs
// against a Mermaid that returns a marked SVG, so these tests cover when and
// how a reply's diagram is drawn rather than Mermaid itself.
const mermaid = vi.hoisted(() => ({
  initialize: vi.fn(),
  parse: vi.fn(),
  render: vi.fn(),
}));

vi.mock('mermaid', () => ({ default: mermaid }));

const { ChatMarkdown } = await import('./ChatMarkdown');
const { resetMermaidForTests } = await import('@/lib/mermaid');

beforeEach(() => {
  resetMermaidForTests();
  mermaid.initialize.mockReset();
  mermaid.parse.mockReset().mockResolvedValue({ diagramType: 'flowchart-v2' });
  mermaid.render.mockReset().mockImplementation(async (id: string, source: string) => ({
    svg: `<svg id="${id}" data-testid="drawn"><text>${source.split('\n')[0]}</text></svg>`,
    diagramType: 'flowchart-v2',
  }));
});

afterEach(cleanup);

describe('ChatMarkdown maths', () => {
  it('typesets inline $…$ and \\(…\\) maths with KaTeX', () => {
    const { container } = render(
      <ChatMarkdown text={'Energy is $E = mc^2$ and momentum \\(p = mv\\).'} />,
    );
    const maths = container.querySelectorAll('.chat-math .katex');
    expect(maths).toHaveLength(2);
    // MathML travels with the visual render, so the maths is read as maths.
    expect(container.querySelector('.katex-mathml math')).not.toBeNull();
    expect(container.textContent).not.toContain('$E');
  });

  it.each([
    'It costs $5 and $10 at the door.',
    'Prices went from US$5 to US$10.',
    'Budget: 5$ per seat, 10$ per desk.',
    'Escaped \\$x$ stays literal.',
  ])('leaves dollar amounts alone: %j', (text) => {
    const { container } = render(<ChatMarkdown text={text} />);
    expect(container.querySelector('.katex')).toBeNull();
    expect(container.textContent).toBe(text);
  });

  it('typesets the maths and leaves the dollar amount on the same line', () => {
    const { container } = render(
      <ChatMarkdown text={'It costs under $1\\%$ of throughput — about $5 an hour.'} />,
    );
    expect(container.querySelectorAll('.katex')).toHaveLength(1);
    expect(container.textContent).toContain('about $5 an hour.');
  });

  it('keeps maths in a code span as code', () => {
    const { container } = render(<ChatMarkdown text={'Write `$x$` to get inline maths.'} />);
    expect(container.querySelector('.katex')).toBeNull();
    expect(container.querySelector('code')?.textContent).toBe('$x$');
  });

  it('typesets maths inside bold and table cells', () => {
    const { container } = render(
      <ChatMarkdown text={'**Result: $\\alpha = 0.05$**\n\n| Symbol | Meaning |\n|---|---|\n| $\\beta$ | power |'} />,
    );
    expect(container.querySelector('strong .katex')).not.toBeNull();
    expect(container.querySelector('td .katex')).not.toBeNull();
  });

  it.each([
    ['$$ on its own lines', '$$\n\\int_0^1 x\\,dx = \\tfrac12\n$$'],
    ['\\[ on its own lines', '\\[\n\\sum_{i=1}^n i = \\frac{n(n+1)}{2}\n\\]'],
    ['a one-line $$ block', '$$ a^2 + b^2 = c^2 $$'],
    ['a ```math fence', '```math\ne^{i\\pi} + 1 = 0\n```'],
  ])('typesets display maths written as %s', (_label, text) => {
    const { container } = render(<ChatMarkdown text={`Before.\n${text}\nAfter.`} />);
    expect(container.querySelector('.chat-math-block .katex-display')).not.toBeNull();
    expect(container.textContent).toContain('Before.');
    expect(container.textContent).toContain('After.');
  });

  it('shows an unterminated display block as source while it streams', () => {
    const { container } = render(<ChatMarkdown text={'The sum is\n$$\n\\sum_{i=1}^n'} />);
    expect(container.querySelector('.katex')).toBeNull();
    expect(container.querySelector('pre')?.textContent).toBe('$$\n\\sum_{i=1}^n');
  });

  it('shows maths KaTeX cannot parse exactly as written', () => {
    const { container } = render(<ChatMarkdown text={'Broken: $\\frac{1}{$ here.'} />);
    expect(container.querySelector('.katex')).toBeNull();
    expect(container.textContent).toBe('Broken: $\\frac{1}{$ here.');
  });

  it('never lets \\href in maths become a link', () => {
    const { container } = render(<ChatMarkdown text={'$\\href{javascript:alert(1)}{x}$'} />);
    expect(container.querySelector('a')).toBeNull();
  });
});

describe('ChatMarkdown diagrams', () => {
  const FLOW = '```mermaid\nflowchart LR\n  A --> B\n```';

  it('draws a finished ```mermaid fence', async () => {
    render(<ChatMarkdown text={`Here is the pipeline:\n\n${FLOW}`} />);
    expect(await screen.findByRole('img', { name: 'Diagram from the assistant' })).toBeTruthy();
    expect(screen.getByTestId('drawn').textContent).toBe('flowchart LR');
    expect(mermaid.initialize).toHaveBeenCalledWith(expect.objectContaining({ securityLevel: 'strict' }));
  });

  it('waits for the closing fence before drawing', () => {
    const { container } = render(<ChatMarkdown text={'```mermaid\nflowchart LR\n  A --> B'} />);
    expect(screen.getByText(/drawn when the reply finishes it/)).toBeTruthy();
    expect(container.querySelector('pre')?.textContent).toContain('A --> B');
    expect(mermaid.render).not.toHaveBeenCalled();
  });

  it('keeps the source one click away', async () => {
    render(<ChatMarkdown text={FLOW} />);
    await screen.findByRole('img', { name: 'Diagram from the assistant' });
    const toggle = screen.getByRole('button', { name: 'Show source' });
    fireEvent.click(toggle);
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByText(/A --> B/, { selector: 'code' })).toBeTruthy();
  });

  it('explains a diagram that does not parse', async () => {
    mermaid.parse.mockRejectedValueOnce(new Error('Parse error on line 2:\nExpecting SEMI'));
    render(<ChatMarkdown text={'```mermaid\nflowchart LR\n  A -->\n```'} />);
    expect(await screen.findByText('This diagram has an error')).toBeTruthy();
    expect(screen.getByText(/Parse error on line 2/)).toBeTruthy();
  });

  it('leaves other fences as code', async () => {
    const { container } = render(<ChatMarkdown text={'```python\nprint(1)\n```'} />);
    await waitFor(() => expect(container.querySelector('pre code')?.textContent).toBe('print(1)'));
    expect(mermaid.render).not.toHaveBeenCalled();
  });
});
