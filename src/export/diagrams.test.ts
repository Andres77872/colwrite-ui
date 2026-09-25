import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Doc } from '@/editor/types';
import type { DocumentExportOptions } from './types';

const mermaid = vi.hoisted(() => ({
  initialize: vi.fn(),
  parse: vi.fn(),
  render: vi.fn(),
}));

vi.mock('mermaid', () => ({ default: mermaid }));

const { EXPORT_DIAGRAM_FONT, renderDocumentDiagrams } = await import('./diagrams');
const { renderStandaloneHtml } = await import('./renderStandaloneHtml');
const { safeDiagramSvg } = await import('./sanitize');
const { resetMermaidForTests } = await import('@/lib/mermaid');

const options: DocumentExportOptions = {
  profile: 'paper',
  page_size: 'A4',
  orientation: 'portrait',
  include_title: false,
  ai_beat: 'omit',
  include_references: true,
};
const snapshot = { base_version: 1, local_revision: 1, dirty: false };

function doc(): Doc {
  return {
    version: 1,
    name: 'Diagrams',
    blocks: [
      { id: 'flow', type: 'code', text: 'flowchart LR\n  A --> B', language: 'mermaid' },
      { id: 'py', type: 'code', text: 'print(1)', language: 'python' },
      { id: 'bad', type: 'code', text: 'flowchart LR\n  A -->', language: 'mermaid' },
    ],
  };
}

beforeEach(() => {
  resetMermaidForTests();
  mermaid.initialize.mockReset();
  mermaid.parse.mockReset().mockImplementation(async (source: string) => {
    if (source.endsWith('-->')) throw new Error('Parse error on line 2');
    return { diagramType: 'flowchart-v2' };
  });
  mermaid.render.mockReset().mockImplementation(async (id: string) => ({
    svg: `<svg id="${id}" xmlns="http://www.w3.org/2000/svg"><g><text>A</text></g></svg>`,
    diagramType: 'flowchart-v2',
  }));
});

describe('renderDocumentDiagrams', () => {
  it('draws every diagram block, in the light palette and the export font', async () => {
    const drawn = await renderDocumentDiagrams(doc().blocks);

    expect([...drawn.keys()]).toEqual(['flow']);
    expect(mermaid.render).toHaveBeenCalledTimes(1);
    expect(mermaid.initialize).toHaveBeenCalledWith(
      expect.objectContaining({
        fontFamily: EXPORT_DIAGRAM_FONT,
        themeVariables: expect.objectContaining({ background: '#ffffff', darkMode: false }),
      }),
    );
  });

  it('does not load Mermaid for a document without diagrams', async () => {
    const drawn = await renderDocumentDiagrams([{ id: 'py', type: 'code', text: 'x = 1', language: 'python' }]);
    expect(drawn.size).toBe(0);
    expect(mermaid.initialize).not.toHaveBeenCalled();
  });
});

describe('renderStandaloneHtml with diagrams', () => {
  it('prints a drawn diagram as a figure and one that did not draw as its source', async () => {
    const source = doc();
    const html = renderStandaloneHtml(source, options, snapshot, await renderDocumentDiagrams(source.blocks));
    const body = new DOMParser().parseFromString(html, 'text/html');

    const figure = body.querySelector('figure.export-diagram');
    expect(figure?.getAttribute('role')).toBe('img');
    expect(figure?.querySelector('svg text')?.textContent).toBe('A');

    const code = [...body.querySelectorAll('pre.export-code')].map((pre) => [pre.getAttribute('data-language'), pre.textContent]);
    expect(code).toEqual([
      ['python', 'print(1)'],
      ['mermaid', 'flowchart LR\n  A -->'],
    ]);
  });

  it('prints the source when no drawings were handed in', () => {
    const html = renderStandaloneHtml(doc(), options, snapshot);
    expect(html).not.toContain('export-diagram"');
    expect(html).toContain('flowchart LR\n  A --&gt; B');
  });

  it('refuses a drawing that carries script, and prints the source instead', () => {
    const html = renderStandaloneHtml(
      doc(),
      options,
      snapshot,
      new Map([['flow', '<svg><script>alert(1)</script></svg>']]),
    );
    expect(html).not.toContain('<script');
    expect(html).toContain('flowchart LR\n  A --&gt; B');
  });
});

describe('safeDiagramSvg', () => {
  it('accepts a lone svg, whatever its labels say', () => {
    const svg = '<svg id="d"><text>online = true; javascript: the good parts</text></svg>';
    expect(safeDiagramSvg(svg)).toBe(svg);
  });

  it.each([
    ['nothing', undefined],
    ['not an svg', '<div>x</div>'],
    ['a script', '<svg><script>alert(1)</script></svg>'],
    ['an event handler', '<svg><g onclick="alert(1)"></g></svg>'],
    ['a javascript: link', '<svg><a href="javascript:alert(1)">x</a></svg>'],
    ['an embedded frame', '<svg><foreignObject><iframe src="x"></iframe></foreignObject></svg>'],
    ['trailing markup', '<svg></svg><img src=x onerror=alert(1)>'],
  ])('rejects %s', (_label, svg) => {
    expect(safeDiagramSvg(svg)).toBeNull();
  });
});
