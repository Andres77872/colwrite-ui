import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { ChatMarkdown } from '../ChatMarkdown';
import { citedOrder } from '../answerSourceMarkers';
import { answerForClipboard } from '../answerClipboard';
import { replyToBlocks } from '../replyToBlocks';
import type { AgentSource } from '@/services/streamParser';
import type { ParagraphBlock } from '@/editor/types';

afterEach(cleanup);

const SOURCES: AgentSource[] = [
  { id: 'S1', key: '10.1234/a', title: 'Paper A', authors: 'Ada', year: '2020', provider: 'crossref' },
  { id: 'S2', key: 'https://example.org', title: 'Page B', provider: 'web' },
  { id: 'S3', key: '2101.00001', title: 'Preprint C', provider: 'arxiv' },
];

describe('answer source markers', () => {
  it('numbers sources in the order the answer first cites them', () => {
    expect(citedOrder('Claim [S3]. Another [S1, S3]. Unknown [S9].', SOURCES)).toEqual(['S3', 'S1']);
  });

  it('renders known markers as numbered chips and leaves unknown ids as text', () => {
    const numbers = new Map([['S3', 1], ['S1', 2]]);
    render(
      <ChatMarkdown
        text="Transformers scale [S3]. Also [S1; S3]. Made up [S9]."
        sources={{
          numberOf: (id) => numbers.get(id),
          describe: (id) => SOURCES.find((source) => source.id === id)?.title,
        }}
      />,
    );
    expect(screen.getAllByRole('button', { name: /Source 1: Preprint C/ })).toHaveLength(2);
    expect(screen.getByRole('button', { name: /Source 2: Paper A/ })).toBeTruthy();
    expect(screen.getByText(/Made up \[S9\]/)).toBeTruthy();
  });

  it('keeps a marker on the line of the word before it, without a double gap', () => {
    const numbers = new Map([['S1', 1]]);
    const { container } = render(
      <ChatMarkdown
        text="The parameter count grows [S1]. Then more."
        sources={{ numberOf: (id) => numbers.get(id), describe: () => 'Paper A' }}
      />,
    );
    const glued = container.querySelector('.whitespace-nowrap');
    expect(glued?.textContent).toBe('grows1.');
    expect(container.querySelector('p')?.textContent).toBe('The parameter count grows1. Then more.');
  });

  it('renders markdown tables', () => {
    render(<ChatMarkdown text={'Intro\n| Model | Acc |\n|---|---|\n| A | 0.9 |'} />);
    expect(screen.getByRole('table')).toBeTruthy();
    expect(screen.getByRole('columnheader', { name: 'Model' })).toBeTruthy();
    expect(screen.getByRole('cell', { name: '0.9' })).toBeTruthy();
    expect(screen.getByText('Intro')).toBeTruthy();
  });
});

describe('copying a reply', () => {
  it('uses the numbers the answer shows and lists what they point to', () => {
    const { plain, html } = answerForClipboard('**Scaling** works [S3]. Also [S1; S3]. Made up [S9].', [
      ...SOURCES,
      { id: 'S4', key: 'x', title: 'Unused' },
    ].map((source) =>
      source.id === 'S3' ? { ...source, authors: 'William Fedus, Barret Zoph, Noam Shazeer', year: '2021', venue: 'JMLR', url: 'https://example.org/switch' } : source,
    ));
    expect(plain).toContain('**Scaling** works [1]. Also [2, 1]. Made up [S9].');
    expect(plain).not.toMatch(/\[S[13]\]/);
    expect(plain).toContain('Sources\n[1] Fedus, Zoph, Shazeer. Preprint C. JMLR 2021. https://example.org/switch\n[2] Ada. Paper A. 2020.');
    expect(plain).not.toContain('Unused');
    expect(html).toContain('<strong>Scaling</strong>');
    expect(html).toContain('<a href="https://example.org/switch">');
  });

  it('copies an answer without sources as written', () => {
    expect(answerForClipboard('Just text.', []).plain).toBe('Just text.');
  });
});

describe('inserting a reply', () => {
  it('turns markers for received sources into citations carrying their records', () => {
    const blocks = replyToBlocks('## Findings\n\n- Scaling works [S1, S3].\n- Invented [S7].', SOURCES);
    expect(blocks[0]).toMatchObject({ type: 'heading', level: 2, html: 'Findings' });
    const [first, second] = blocks.slice(1) as ParagraphBlock[];
    expect(first.variant).toBe('bullet');
    const [citation] = first.children ?? [];
    expect(citation).toMatchObject({ type: 'citation', keys: ['10.1234/a', '2101.00001'] });
    expect(citation.type === 'citation' && citation.sources?.map((source) => source.title)).toEqual([
      'Paper A',
      'Preprint C',
    ]);
    // Registry bookkeeping never reaches the document.
    expect(JSON.stringify(citation)).not.toContain('"id":"S1"');
    // An id the reply never received stays text.
    expect(second.children ?? []).toHaveLength(0);
    expect(second.html).toContain('[S7]');
  });
});
