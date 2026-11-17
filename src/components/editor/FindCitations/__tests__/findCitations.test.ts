import { describe, expect, it } from 'vitest';
import type { ReferenceRecord } from '@/editor';
import type { PaperPassage } from '@/data/papers';
import { candidatesFrom, citePoint, picksOf, placements, sentencesIn, skipReason } from '../findCitations';

const record = (key: string): ReferenceRecord => ({
  key, kind: 'paper', provider: 'openalex', state: 'unchecked', flags: [], csl: { id: key, type: 'article', title: key },
});
const passage = (key: string, text: string, level: PaperPassage['level'] = 'abstract'): PaperPassage => ({
  paper: { record: record(key), abstract: null, citationCount: null, referenceCount: null, openAccess: null, foundBy: ['openalex'] },
  text, level, section: null, page: null,
});

const PROSE = 'Sparse routing keeps the compute per token constant. See Table 2. Router z-loss stabilises training at scale!';

describe('the sentences of a selection', () => {
  it('splits it into sentences with their offsets in the block, trimmed', () => {
    const sentences = sentencesIn(PROSE);
    expect(sentences.map((sentence) => sentence.text)).toEqual([
      'Sparse routing keeps the compute per token constant.', 'See Table 2.', 'Router z-loss stabilises training at scale!',
    ]);
    for (const sentence of sentences) expect(PROSE.slice(sentence.start, sentence.end)).toBe(sentence.text);
  });

  it('keeps the part of a sentence the selection covers', () => {
    const from = PROSE.indexOf('Router');
    expect(sentencesIn(PROSE, from, from + 'Router z-loss stabilises'.length).map((sentence) => sentence.text)).toEqual(['Router z-loss stabilises']);
  });

  it('puts the citation before the closing punctuation', () => {
    const [first] = sentencesIn(PROSE);
    expect(PROSE.slice(0, citePoint(first!))).toBe('Sparse routing keeps the compute per token constant');
  });

  it('searches nothing for a sentence too short to need a source, or already cited', () => {
    const [claim, short] = sentencesIn(PROSE);
    expect(skipReason(claim!, false)).toBeNull();
    expect(skipReason(short!, false)).toBe('Too short to need a source.');
    expect(skipReason(claim!, true)).toBe('Already cited.');
  });
});

describe('what a sentence is offered', () => {
  it('offers up to three works, each once, with its first passage', () => {
    const offered = candidatesFrom([
      passage('a', 'first of a', 'full_text'), passage('a', 'second of a'), passage('b', 'of b'), passage('c', 'of c'), passage('d', 'of d'),
    ]);
    expect(offered.map((candidate) => [candidate.record.key, candidate.passage, candidate.level])).toEqual([
      ['a', 'first of a', 'full_text'], ['b', 'of b', 'abstract'], ['c', 'of c', 'abstract'],
    ]);
  });
});

describe('what Insert places', () => {
  const sentences = sentencesIn(PROSE).map((sentence, index) => ({
    ...sentence, status: 'found' as const, candidates: index === 1 ? [] : candidatesFrom([passage(`w${index}a`, 'x'), passage(`w${index}b`, 'y')]),
  }));

  it('only what was ticked, in the order offered', () => {
    const picks = picksOf(sentences, new Map([[0, new Set(['w0b', 'w0a'])], [2, new Set<string>()]]));
    expect(picks.map((pick) => [pick.sentence.text, pick.records.map((item) => item.key)])).toEqual([
      ['Sparse routing keeps the compute per token constant.', ['w0a', 'w0b']],
    ]);
  });

  it('after each sentence as the block reads now, later ones first, and misses a sentence edited away', () => {
    const picks = picksOf(sentences, new Map([[0, new Set(['w0a'])], [2, new Set(['w2b'])]]));
    const edited = `Intro. ${PROSE}`;
    const { placed, missed } = placements(edited, picks);
    expect(placed.map((item) => edited.slice(0, item.at).slice(-12))).toEqual(['ning at scale', 'oken constant'].map((tail) => tail.slice(-12)));
    expect(missed).toEqual([]);
    expect(placements(PROSE.replace('Router z-loss', 'A router loss'), picks).missed.map((sentence) => sentence.text)).toEqual([
      'Router z-loss stabilises training at scale!',
    ]);
  });
});
