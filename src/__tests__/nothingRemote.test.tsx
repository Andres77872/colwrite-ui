import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, waitFor } from '@testing-library/react';
import type { Doc } from '@/editor/types';
import { recordRequests } from '@/__tests__/server';

/**
 * Nothing the assistant writes can make the page fetch from another origin
 * (P0.UI-7): not a Mermaid diagram, not a figure's image node, not a chat
 * reply, and not the export of a page holding them. A fetch on render would
 * tell that host who is reading, and when.
 *
 * jsdom loads no images, so the checks are on what reaches the DOM: no
 * element is left that names a remote resource to load (a link is fine:
 * following it is the reader's choice), and no request leaves for another
 * origin while it renders.
 */

const EVIL = 'evil.example';

// jsdom cannot lay a diagram out: the real pipeline (src/lib/mermaid.ts)
// runs against a Mermaid that returns what an image shape and an HTML
// label would — remote images, after its own sanitising.
const mermaid = vi.hoisted(() => ({ initialize: vi.fn(), parse: vi.fn(), render: vi.fn() }));
vi.mock('mermaid', () => ({ default: mermaid }));

const { ChatMarkdown } = await import('@/components/editor/ChatAssistant/ChatMarkdown');
const { resetMermaidForTests } = await import('@/lib/mermaid');
const { renderDocumentDiagrams } = await import('@/export/diagrams');
const { renderStandaloneHtml } = await import('@/export/renderStandaloneHtml');

const REMOTE_FIGURE = JSON.stringify({
  caption: 'A photo.',
  nodes: [{ id: 'photo', shape: 'image', src: `https://${EVIL}/figure.png`, label: 'Photo' }, 'b'],
  edges: ['photo -> b'],
});
const MERMAID = 'flowchart LR\n  A@{ img: "https://evil.example/shape.png" } --> B';

/** Every attribute in `root` that names something to load from another origin. */
function remoteLoads(root: ParentNode): string[] {
  const found: string[] = [];
  for (const element of Array.from(root.querySelectorAll('*'))) {
    for (const attribute of Array.from(element.attributes)) {
      const name = attribute.name.toLowerCase();
      // A link loads nothing until it is followed.
      if (element.localName === 'a' && (name === 'href' || name === 'xlink:href')) continue;
      if (attribute.value.includes(EVIL)) found.push(`<${element.localName} ${name}="${attribute.value}">`);
    }
    if (element.localName === 'style' && element.textContent?.includes(EVIL)) found.push(`<style>${element.textContent}</style>`);
  }
  return found;
}

beforeEach(() => {
  resetMermaidForTests();
  mermaid.initialize.mockReset();
  mermaid.parse.mockReset().mockResolvedValue({ diagramType: 'flowchart-v2' });
  mermaid.render.mockReset().mockImplementation(async (id: string) => ({
    svg: `<svg id="${id}" xmlns="http://www.w3.org/2000/svg" data-testid="drawn">`
      + `<style>@import url("https://${EVIL}/x.css");</style>`
      + `<g><image href="https://${EVIL}/shape.png" width="20" height="20"></image>`
      + `<foreignObject><div xmlns="http://www.w3.org/1999/xhtml"><img src="https://${EVIL}/label.png"><span>A</span></div></foreignObject>`
      + `<rect style="fill: url(https://${EVIL}/p)"></rect></g></svg>`,
    diagramType: 'flowchart-v2',
  }));
});
afterEach(cleanup);

describe('nothing remote renders (P0.UI-7)', () => {
  it('a chat reply: markdown images, raw HTML, a figure and a Mermaid diagram', async () => {
    const requests = recordRequests();
    const text = [
      `Here is a chart ![chart](https://${EVIL}/chart.png) and <img src="https://${EVIL}/raw.png">.`,
      '',
      '```figure',
      REMOTE_FIGURE,
      '```',
      '',
      '```mermaid',
      MERMAID,
      '```',
    ].join('\n');
    const { container } = render(<ChatMarkdown text={text} />);

    await waitFor(() => expect(container.querySelector('[data-testid="drawn"]')).not.toBeNull());
    // The figure is drawn, with a placeholder where its remote image would be.
    await waitFor(() => expect(container.textContent).toContain('remote image not loaded'));

    expect(remoteLoads(container)).toEqual([]);
    expect(container.querySelector('img')).toBeNull();
    // The diagram kept the rest of its drawing.
    expect(container.querySelector('[data-testid="drawn"] span')?.textContent).toBe('A');
    expect(requests.filter((request) => new URL(request.url).origin !== window.location.origin)).toEqual([]);
  });

  it('the export of a page holding a remote-image figure and such a diagram', async () => {
    const doc: Doc = {
      name: 'Remote',
      blocks: [
        { id: 'fig', type: 'code', language: 'figure', text: REMOTE_FIGURE },
        { id: 'flow', type: 'code', language: 'mermaid', text: MERMAID },
      ],
    };
    const html = renderStandaloneHtml(
      doc,
      { profile: 'paper', page_size: 'A4', orientation: 'portrait', include_title: false, ai_beat: 'omit', include_references: true },
      { local_revision: 1, dirty: false },
      await renderDocumentDiagrams(doc.blocks),
    );
    const page = new DOMParser().parseFromString(html, 'text/html');

    expect(page.querySelector('figure.export-diagram svg')).not.toBeNull();
    expect(remoteLoads(page)).toEqual([]);
    // And the file itself refuses any image that is not inline.
    expect(page.querySelector('meta[http-equiv="Content-Security-Policy"]')?.getAttribute('content')).toContain('img-src data:');
  });
});
