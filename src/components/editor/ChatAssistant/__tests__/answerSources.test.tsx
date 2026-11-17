import { takeItems } from '@/lib/itemAt';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { ChatMarkdown } from '../ChatMarkdown';
import { citedOrder } from '../answerSourceMarkers';
import { answerForClipboard } from '../answerClipboard';
import { resolveAssistantOutput } from '@/editor/assistantOutput';
import { assistantOutputBlocks } from '@/editor/markdown';
import { agentSource } from '@/__tests__/agentSource';
import type { ParagraphBlock } from '@/editor/types';

afterEach(cleanup);

const SOURCES = [
  agentSource('S1', { key: 'doi:10.1234/a', title: 'Paper A', authors: 'Ada Lovelace', year: 2020, provider: 'crossref', doi: '10.1234/a' }),
  agentSource('S2', { key: 'url:https://example.org', title: 'Page B', provider: 'web', kind: 'web', csl: { type: 'webpage', URL: 'https://example.org' } }),
  agentSource('S3', { key: 'arxiv:2101.00001', title: 'Preprint C', provider: 'semantic_scholar', kind: 'preprint', flags: ['preprint'] }),
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
          describe: (handle) => SOURCES.find((source) => source.handle === handle)?.title,
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
      agentSource('S4', { key: 'x', title: 'Unused' }),
    ].map((source) =>
      source.handle === 'S3'
        ? agentSource('S3', {
          key: 'arxiv:2101.00001', title: 'Preprint C', authors: 'William Fedus, Barret Zoph, Noam Shazeer', year: 2021, venue: 'JMLR', url: 'https://example.org/switch',
        })
        : source,
    ));
    expect(plain).toContain('**Scaling** works [1]. Also [2, 1]. Made up [S9].');
    expect(plain).not.toMatch(/\[S[13]\]/);
    // Each as the reference list prints it, from its record.
    expect(plain).toContain('Sources\n[1] Fedus W, Zoph B, Shazeer N. Preprint C. JMLR [Internet]. 2021. Available from: https://example.org/switch\n[2] Lovelace A. Paper A. 2020. doi:10.1234/a');
    expect(plain).not.toContain('Unused');
    expect(html).toContain('<strong>Scaling</strong>');
    expect(html).toContain('<a href="https://example.org/switch" rel="noopener noreferrer">');
  });

  it('copies an answer without sources as written', () => {
    expect(answerForClipboard('Just text.', []).plain).toBe('Just text.');
  });
});

describe('inserting a reply', () => {
  it('turns markers for received sources into citations carrying their records, and nothing else of the source', () => {
    const blocks = assistantOutputBlocks(resolveAssistantOutput('## Findings\n\n- Scaling works [S1, S3].\n- Invented [S7].', SOURCES));
    expect(blocks[0]).toMatchObject({ type: 'heading', level: 2, html: 'Findings' });
    const [first, second] = takeItems(blocks.slice(1) as ParagraphBlock[], 2);
    expect(first.variant).toBe('bullet');
    const [citation] = takeItems(first.children ?? [], 1);
    expect(citation).toMatchObject({ type: 'citation', keys: ['doi:10.1234/a', 'arxiv:2101.00001'] });
    expect(citation.type === 'citation' && citation.sources?.map((source) => source.csl.title)).toEqual([
      'Paper A',
      'Preprint C',
    ]);
    // The citation is the record: the handle never reaches the document.
    expect(citation.type === 'citation' && citation.sources).toEqual([SOURCES[0]?.record, SOURCES[2]?.record]);
    expect(JSON.stringify(citation)).not.toMatch(/"handle"/);
    // A handle the reply never received stays text.
    expect(second.children ?? []).toHaveLength(0);
    expect(second.html).toContain('[S7]');
  });
});
