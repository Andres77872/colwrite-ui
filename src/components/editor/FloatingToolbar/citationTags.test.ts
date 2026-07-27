import { describe, expect, it } from 'vitest';
import {
  commitMaterializedCitationSuggestion,
  materializeCitationSuggestion,
  materializeCitationSuggestionForAction,
  parseCitationSuggestion,
} from './citationTags';

describe('citation suggestion tags', () => {
  it('preserves surrounding text and materializes strict backend tags', () => {
    const parsed = parseCitationSuggestion(
      'Claim one <citation title="Paper &amp; Proof" authors="Smith (2024)" page="12" url="https://arxiv.org/abs/2401.00001" /> then more.',
    );

    expect(parsed).toEqual([
      { type: 'text', text: 'Claim one ' },
      {
        type: 'citation',
        key: '2401.00001',
        locator: 'p. 12',
        source: expect.objectContaining({
          key: '2401.00001',
          title: 'Paper & Proof',
          authors: 'Smith (2024)',
          year: '2024',
          provider: 'arxiv',
          providerId: '2401.00001',
        }),
      },
      { type: 'text', text: ' then more.' },
    ]);
  });

  it('prefers canonical DOI and supports Semantic Scholar fallback ids', () => {
    const doi = parseCitationSuggestion(
      '<citation title="DOI paper" doi="HTTPS://DOI.ORG/10.1000/ABC." url="https://example.test/paper" />',
    );
    const semantic = parseCitationSuggestion(
      "<citation title='S2 paper' paper_id='abc123' url='https://www.semanticscholar.org/paper/abc123' />",
    );

    expect(doi?.[0]).toMatchObject({
      type: 'citation',
      key: '10.1000/abc',
      source: { doi: '10.1000/abc' },
    });
    expect(semantic?.[0]).toMatchObject({
      type: 'citation',
      key: 'S2:abc123',
      source: {
        provider: 'semantic_scholar',
        providerId: 'abc123',
      },
    });
  });

  it('honors the backend DOI key before Semantic Scholar URL identity', () => {
    const parsed = parseCitationSuggestion(
      '<citation key="DOI:10.1000/Backend.Key." title="Backend paper" ' +
        'authors="B. Author" year="2025" ' +
        'url="https://www.semanticscholar.org/paper/backend-paper" />',
    );

    expect(parsed?.[0]).toMatchObject({
      type: 'citation',
      key: '10.1000/backend.key',
      source: {
        key: '10.1000/backend.key',
        doi: '10.1000/backend.key',
        provider: 'semantic_scholar',
        providerId: 'backend-paper',
        externalIds: { DOI: '10.1000/backend.key' },
      },
    });
  });

  it.each([
    '<citation title="not closed" url="https://example.test">',
    '<citation title="bad url" url="javascript:alert(1)" />',
    '<citation title="unknown attr" url="https://example.test" onclick="x" />',
    '<citation title="missing identity" />',
    '<citation><img src=x onerror=alert(1)></citation>',
  ])('falls back when a citation tag is malformed: %s', (value) => {
    expect(parseCitationSuggestion(value)).toBeNull();
    expect(materializeCitationSuggestion(value, () => 'unused')).toBeNull();
  });

  it('creates text nodes and empty placeholders without injecting raw HTML', () => {
    const materialized = materializeCitationSuggestion(
      'Literal <img src=x onerror=alert(1)> <citation title="Safe" key="safe-key" url="https://example.test/paper" /> end',
      () => 'citation-1',
    );
    const host = document.createElement('div');
    if (materialized) host.append(materialized.fragment);

    expect(host.querySelector('img')).toBeNull();
    expect(host.textContent).toContain('Literal <img src=x onerror=alert(1)>');
    expect(host.querySelector('[data-child-id="citation-1"]')?.innerHTML).toBe('');
    expect(materialized?.children).toEqual([
      expect.objectContaining({
        id: 'citation-1',
        type: 'citation',
        keys: ['safe-key'],
        sources: [expect.objectContaining({ title: 'Safe' })],
      }),
    ]);
  });

  it('rejects the whole structured transform when one of several tags is malformed', () => {
    expect(
      parseCitationSuggestion(
        'Good <citation title="A" key="a" url="https://example.test/a" /> bad <citation title="B">',
      ),
    ).toBeNull();
  });

  it('only materializes citation tags for the search-for-references action', () => {
    const value =
      '<citation title="A" key="a" url="https://example.test/a" />';
    expect(
      materializeCitationSuggestionForAction('grammar', value, () => 'not-used'),
    ).toBeNull();
    expect(
      materializeCitationSuggestionForAction(
        'search-for-references',
        value,
        () => 'citation-1',
      )?.children[0],
    ).toMatchObject({ id: 'citation-1', keys: ['a'] });
  });

  it('queues every citation child before committing placeholder HTML', () => {
    const materialized = materializeCitationSuggestion(
      '<citation title="A" key="a" url="https://example.test/a" /> and ' +
        '<citation title="B" key="b" url="https://example.test/b" />',
      (() => {
        let next = 0;
        return () => `citation-${++next}`;
      })(),
    );
    if (!materialized) throw new Error('Expected a structured citation suggestion');

    const calls: string[] = [];
    commitMaterializedCitationSuggestion(
      'paragraph-1',
      materialized,
      (_blockId, child) => {
        calls.push(`child:${child.id}`);
        return child.id;
      },
      () => calls.push('html'),
    );

    expect(calls).toEqual(['child:citation-1', 'child:citation-2', 'html']);
  });
});
