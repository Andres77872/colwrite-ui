import type { ReferenceRecord } from '@/editor';
import type { PaperPassage } from '@/data/papers';

/* ----------------------------------------
   Find citations (P2.UI-3, 13 §7)

   The author selects a passage and picks "Find citations". Each sentence
   that makes a claim is searched for passages of papers' text that bear on
   it (`GET …/papers/passages`, the search the assistant's `paper_passages`
   runs), and up to three works are offered for it, each with the passage it
   would rest on, how much of the work was read, and its state. The author
   ticks what to cite; Insert places the citations after their sentences in
   one undo step. Nothing is rewritten, and a sentence with no good source
   says so.
   ---------------------------------------- */

/** Works offered per sentence. */
export const CANDIDATES_PER_SENTENCE = 3;
/** Sentences searched per run, so a long selection asks the sources a bounded number of times. */
export const MAX_SENTENCES = 8;
/** Below this many words a sentence makes no claim worth a source ("See Table 2."). */
const MIN_WORDS = 5;

export type Sentence = {
  /** The sentence as the block's prose has it, trimmed. */
  text: string;
  /** Prose offsets of the trimmed sentence in its block. */
  start: number;
  end: number;
};

export type Candidate = {
  record: ReferenceRecord;
  /** The passage the citation would rest on. */
  passage: string;
  level: PaperPassage['level'];
};

export type SentenceCandidates = Sentence & {
  /** `skipped` sentences are not searched: too short, or already cited. */
  status: 'searching' | 'found' | 'none' | 'skipped' | 'failed';
  /** Why it was skipped, or why its search failed. */
  reason?: string;
  candidates: Candidate[];
};

const splitter = typeof Intl !== 'undefined' && 'Segmenter' in Intl
  ? new Intl.Segmenter('en', { granularity: 'sentence' })
  : null;

/**
 * The sentences of `prose` within [from, to), trimmed, with their offsets.
 * A selection that begins or ends partway through a sentence keeps the part
 * selected.
 */
export function sentencesIn(prose: string, from = 0, to = prose.length): Sentence[] {
  const slice = prose.slice(from, to);
  const parts = splitter
    ? [...splitter.segment(slice)].map((segment) => ({ text: segment.segment, index: segment.index }))
    : [...slice.matchAll(/[^.!?]+(?:[.!?]+["”’)\]]*|$)\s*/g)].map((match) => ({ text: match[0], index: match.index ?? 0 }));
  return parts.flatMap(({ text, index }) => {
    const lead = text.length - text.trimStart().length;
    const trimmed = text.trim();
    if (!trimmed) return [];
    const start = from + index + lead;
    return [{ text: trimmed, start, end: start + trimmed.length }];
  });
}

/** Where a sentence's citation goes: before its closing punctuation, as "… in compute [1]." reads. */
export function citePoint(sentence: Sentence): number {
  const closing = sentence.text.match(/[\s.!?;:,"”’)\]]*$/)?.[0].length ?? 0;
  return sentence.end - closing;
}

export function wordCount(text: string): number {
  return text.split(/\s+/).filter((word) => /\p{L}/u.test(word)).length;
}

/** Why a sentence is not searched, or `null` to search it. */
export function skipReason(sentence: Sentence, alreadyCited: boolean): string | null {
  if (alreadyCited) return 'Already cited.';
  if (wordCount(sentence.text) < MIN_WORDS) return 'Too short to need a source.';
  return null;
}

/** Up to three works for a sentence from its passages, each once, with its first (best) passage. */
export function candidatesFrom(passages: readonly PaperPassage[]): Candidate[] {
  const byWork = new Map<string, Candidate>();
  for (const item of passages) {
    const { record } = item.paper;
    if (byWork.has(record.key)) continue;
    byWork.set(record.key, { record, passage: item.text, level: item.level });
    if (byWork.size === CANDIDATES_PER_SENTENCE) break;
  }
  return [...byWork.values()];
}

/** A sentence's ticked works, by key: what Insert cites. */
export type Ticks = ReadonlyMap<number, ReadonlySet<string>>;

/** What Insert places: each sentence with at least one ticked work, and its works in the order offered. */
export function picksOf(sentences: readonly SentenceCandidates[], ticks: Ticks): Array<{ sentence: Sentence; records: ReferenceRecord[] }> {
  return sentences.flatMap((sentence, index) => {
    const ticked = ticks.get(index);
    const records = sentence.candidates.filter((candidate) => ticked?.has(candidate.record.key)).map((candidate) => candidate.record);
    return records.length ? [{ sentence, records }] : [];
  });
}

/**
 * Where each picked sentence's citation goes in the block's prose as it is
 * now: the sentence is found again by its words, so an edit made while the
 * sources were searched does not misplace it. A sentence no longer in the
 * block is `missed`. Later sentences first, so placing one never moves the
 * next.
 */
export function placements(
  prose: string,
  picks: ReadonlyArray<{ sentence: Sentence; records: ReferenceRecord[] }>,
): { placed: Array<{ at: number; records: ReferenceRecord[] }>; missed: Sentence[] } {
  const placed: Array<{ at: number; records: ReferenceRecord[] }> = [];
  const missed: Sentence[] = [];
  for (const pick of picks) {
    // Where it was, if it is still there; else wherever its words are now.
    const at = prose.slice(pick.sentence.start, pick.sentence.end) === pick.sentence.text
      ? pick.sentence.start
      : prose.indexOf(pick.sentence.text);
    if (at === -1) {
      missed.push(pick.sentence);
      continue;
    }
    const moved = { ...pick.sentence, start: at, end: at + pick.sentence.text.length };
    placed.push({ at: citePoint(moved), records: pick.records });
  }
  return { placed: placed.sort((a, b) => b.at - a.at), missed };
}
