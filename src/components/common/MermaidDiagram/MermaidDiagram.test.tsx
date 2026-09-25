import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

const mermaid = vi.hoisted(() => ({
  initialize: vi.fn(),
  parse: vi.fn(),
  render: vi.fn(),
}));
const download = vi.hoisted(() => ({ downloadBlob: vi.fn() }));

vi.mock('mermaid', () => ({ default: mermaid }));
vi.mock('@/export/download', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/export/download')>()),
  downloadBlob: download.downloadBlob,
}));

const { MermaidDiagram } = await import('./MermaidDiagram');
const { resetMermaidForTests } = await import('@/lib/mermaid');

const SOURCE = 'flowchart LR\n  A --> B';

beforeEach(() => {
  resetMermaidForTests();
  download.downloadBlob.mockReset();
  mermaid.initialize.mockReset();
  mermaid.parse.mockReset().mockResolvedValue({ diagramType: 'flowchart-v2' });
  mermaid.render.mockReset().mockImplementation(async (id: string) => ({
    svg: `<svg id="${id}" width="100%" style="max-width: 400px;"><style>#${id} .node{}</style></svg>`,
    diagramType: 'flowchart-v2',
  }));
});

afterEach(cleanup);

describe('MermaidDiagram', () => {
  it('holds a wide drawing at a legible scale instead of shrinking it to fit', async () => {
    render(<MermaidDiagram source={SOURCE} />);
    const drawing = await screen.findByRole('img', { name: 'Diagram' });
    expect(drawing.querySelector('svg')?.getAttribute('style')).toBe('max-width: 400px; min-width: 300px;');
  });

  it('reports each draw to the parent', async () => {
    const onResult = vi.fn();
    render(<MermaidDiagram source={SOURCE} onResult={onResult} />);
    await waitFor(() => expect(onResult).toHaveBeenCalledWith(expect.objectContaining({ ok: true })));
  });

  it('offers no actions unless asked, and none before there is a drawing', async () => {
    const { rerender } = render(<MermaidDiagram source={SOURCE} />);
    await screen.findByRole('img', { name: 'Diagram' });
    expect(screen.queryByRole('button', { name: 'Open diagram larger' })).toBeNull();

    mermaid.parse.mockRejectedValueOnce(new Error('Parse error'));
    rerender(<MermaidDiagram source="flowchart LR\n  A -->" actions />);
    expect(await screen.findByText('Error — showing the last version that drew')).toBeTruthy();
    // A stale drawing is not what the source says; nothing offers to export it.
    expect(screen.queryByRole('button', { name: 'Download diagram as SVG' })).toBeNull();
  });

  it('opens larger under its own element id', async () => {
    render(<MermaidDiagram source={SOURCE} actions label="Pipeline" />);
    const inline = await screen.findByRole('img', { name: 'Pipeline' });
    const inlineId = inline.querySelector('svg')?.id;

    fireEvent.click(screen.getByRole('button', { name: 'Open diagram larger' }));

    const dialog = await screen.findByRole('dialog', { name: 'Pipeline' });
    const enlargedId = dialog.querySelector('svg')?.id;
    expect(enlargedId).toBe(`${inlineId}-expanded`);
    expect(dialog.querySelector('style')?.textContent).toContain(`#${enlargedId} .node`);
  });

  it('downloads the drawing as a standalone SVG file', async () => {
    render(<MermaidDiagram source={SOURCE} actions filename="routing" />);
    await screen.findByRole('img', { name: 'Diagram' });

    fireEvent.click(screen.getByRole('button', { name: 'Download diagram as SVG' }));

    expect(download.downloadBlob).toHaveBeenCalledWith(expect.any(Blob), 'routing.svg');
    const file = download.downloadBlob.mock.calls[0][0] as Blob;
    expect(file.type).toBe('image/svg+xml;charset=utf-8');
    const text = await file.text();
    expect(text.startsWith('<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg"')).toBe(true);
    // The file keeps its natural size; the legibility floor is on-screen only.
    expect(text).not.toContain('min-width');
  });

  it('copies the source', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    render(<MermaidDiagram source={SOURCE} actions />);
    await screen.findByRole('img', { name: 'Diagram' });

    fireEvent.click(screen.getByRole('button', { name: 'Copy diagram source' }));

    await waitFor(() => expect(screen.getByRole('button', { name: 'Diagram source copied' })).toBeTruthy());
    expect(writeText).toHaveBeenCalledWith(SOURCE);
  });
});
