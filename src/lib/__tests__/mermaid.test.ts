import { beforeEach, describe, expect, it, vi } from 'vitest';

// Mermaid lays out against a real browser DOM (getBBox, font metrics), which
// jsdom does not have. The module is replaced with one that records how it
// was driven and returns an SVG scoped to the id it was given, the way the
// real one scopes its styles and markers.
const mocks = vi.hoisted(() => ({
  initialize: vi.fn(),
  parse: vi.fn(),
  render: vi.fn(),
}));

vi.mock('mermaid', () => ({
  default: { initialize: mocks.initialize, parse: mocks.parse, render: mocks.render },
}));

const {
  MAX_MERMAID_SOURCE,
  mermaidErrorMessage,
  mermaidThemeFor,
  renderMermaid,
  resetMermaidForTests,
} = await import('../mermaid');

function scopedSvg(id: string): string {
  return `<svg id="${id}"><style>#${id} .node{fill:red}</style><path marker-end="url(#${id}_arrow)"/></svg>`;
}

beforeEach(() => {
  resetMermaidForTests();
  mocks.initialize.mockReset();
  mocks.parse.mockReset().mockResolvedValue({ diagramType: 'flowchart-v2' });
  mocks.render.mockReset().mockImplementation(async (id: string) => ({
    svg: scopedSvg(id),
    diagramType: 'flowchart-v2',
  }));
});

describe('mermaidThemeFor', () => {
  it('draws in the light palette when there is no element to read', () => {
    const theme = mermaidThemeFor(null);
    expect(theme.dark).toBe(false);
    expect(theme.variables).toMatchObject({
      darkMode: false,
      background: '#ffffff',
      primaryColor: '#e7f3f8',
      primaryTextColor: '#2c2c2b',
      pie1: '#2f78d4',
      pie8: '#cf4c4c',
      git0: '#2f78d4',
    });
  });

  it('reads the tokens of the element it is drawn in, so a dark island draws dark', () => {
    const host = document.createElement('div');
    host.style.setProperty('--color-background', '#191919');
    host.style.setProperty('--color-foreground', '#d4d4d4');
    host.style.setProperty('--color-tint-blue', '#143a4e');
    document.body.append(host);

    const theme = mermaidThemeFor(host);
    host.remove();

    expect(theme.dark).toBe(true);
    expect(theme.variables).toMatchObject({
      darkMode: true,
      background: '#191919',
      primaryTextColor: '#d4d4d4',
      primaryColor: '#143a4e',
    });
    expect(theme.key).not.toBe(mermaidThemeFor(null).key);
  });

  it('falls back rather than hand Mermaid a colour it cannot parse', () => {
    const host = document.createElement('div');
    host.style.setProperty('--color-background', 'oklch(0.2 0 0)');
    document.body.append(host);

    const theme = mermaidThemeFor(host);
    host.remove();

    expect(theme.variables.background).toBe('#ffffff');
  });

  it('lets the export name its own font', () => {
    const theme = mermaidThemeFor(null, { fontFamily: '"CW Inter", sans-serif' });
    expect(theme.fontFamily).toBe('"CW Inter", sans-serif');
    expect(theme.variables.fontFamily).toBe('"CW Inter", sans-serif');
  });
});

describe('renderMermaid', () => {
  it('draws in strict mode with the theme and without Mermaid painting errors itself', async () => {
    const theme = mermaidThemeFor(null);
    const result = await renderMermaid('flowchart LR\n  A --> B', theme);

    expect(result).toEqual({ ok: true, svg: expect.stringContaining('<svg'), diagramType: 'flowchart-v2' });
    expect(mocks.initialize).toHaveBeenCalledWith(
      expect.objectContaining({
        startOnLoad: false,
        securityLevel: 'strict',
        theme: 'base',
        themeVariables: theme.variables,
        suppressErrorRendering: true,
      }),
    );
    // Validated first, so an invalid source never reaches the layout engine.
    expect(mocks.parse).toHaveBeenCalledWith('flowchart LR\n  A --> B');
  });

  it('refuses an empty or oversized source without loading Mermaid', async () => {
    const theme = mermaidThemeFor(null);
    expect(await renderMermaid('   \n', theme)).toEqual({ ok: false, error: 'The diagram is empty.' });
    const long = await renderMermaid(`flowchart LR\n${'A-->B\n'.repeat(MAX_MERMAID_SOURCE / 4)}`, theme);
    expect(long.ok).toBe(false);
    expect(long.ok ? '' : long.error).toMatch(/too long to draw/);
    expect(mocks.initialize).not.toHaveBeenCalled();
  });

  it('draws one diagram at a time, so a theme is never swapped mid-render', async () => {
    const order: string[] = [];
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    mocks.initialize.mockImplementation((config: { themeVariables: { background: string } }) => {
      order.push(`init ${config.themeVariables.background}`);
    });
    mocks.render.mockImplementationOnce(async (id: string) => {
      await gate;
      order.push('render first');
      return { svg: scopedSvg(id), diagramType: 'flowchart-v2' };
    });

    const host = document.createElement('div');
    host.style.setProperty('--color-background', '#191919');
    document.body.append(host);
    const first = renderMermaid('flowchart LR\n  A --> B', mermaidThemeFor(null));
    const second = renderMermaid('flowchart LR\n  C --> D', mermaidThemeFor(host));
    host.remove();

    await Promise.resolve();
    release();
    await Promise.all([first, second]);

    expect(order).toEqual(['init #ffffff', 'render first', 'init #191919']);
  });

  it('reuses a drawing, under a new element id each time it is shown again', async () => {
    const theme = mermaidThemeFor(null);
    const first = await renderMermaid('flowchart LR\n  A --> B', theme);
    const again = await renderMermaid('flowchart LR\n  A --> B', theme);

    expect(mocks.render).toHaveBeenCalledTimes(1);
    if (!first.ok || !again.ok) throw new Error('expected both to draw');
    const firstId = /id="([^"]+)"/.exec(first.svg)?.[1];
    const againId = /id="([^"]+)"/.exec(again.svg)?.[1];
    expect(firstId).toBeTruthy();
    expect(againId).not.toBe(firstId);
    // Styles and markers follow the new id, so the copy stands on its own.
    expect(again.svg).not.toContain(firstId);
    expect(again.svg).toContain(`#${againId} .node`);
    expect(again.svg).toContain(`url(#${againId}_arrow)`);
  });

  it('draws again when the theme changes', async () => {
    await renderMermaid('flowchart LR\n  A --> B', mermaidThemeFor(null));
    const host = document.createElement('div');
    host.style.setProperty('--color-background', '#191919');
    document.body.append(host);
    await renderMermaid('flowchart LR\n  A --> B', mermaidThemeFor(host));
    host.remove();
    expect(mocks.render).toHaveBeenCalledTimes(2);
  });

  it('turns a parse error into a message instead of rejecting', async () => {
    mocks.parse.mockRejectedValueOnce(
      new Error(`Parse error on line 2:\n...A -->\n-----^\nExpecting ${"'NODE_STRING', ".repeat(60)}got 'EOF'`),
    );
    const result = await renderMermaid('flowchart LR\n  A -->', mermaidThemeFor(null));

    expect(result.ok).toBe(false);
    const error = result.ok ? '' : result.error;
    expect(error).toMatch(/^Parse error on line 2:/);
    expect(error).toContain('-----^');
    expect(error.length).toBeLessThan(300);
    expect(mocks.render).not.toHaveBeenCalled();
  });
});

describe('mermaidErrorMessage', () => {
  it('explains an unknown diagram type in words an author can act on', () => {
    expect(mermaidErrorMessage(new Error('No diagram type detected matching given configuration for text: hello'))).toMatch(
      /^Unknown diagram type/,
    );
  });

  it('never returns an empty message', () => {
    expect(mermaidErrorMessage(undefined)).toBe('The diagram could not be drawn.');
  });
});
