import type { AgentSource } from '@/api/assistant/streamParser';
import type { CslItem, ReferenceRecord } from '@/editor/types';

/** What a test says about a work: its key, and the CSL variables and ColWrite fields it cares about. */
export type ReferenceFields = Partial<Omit<ReferenceRecord, 'key' | 'csl'>> & {
  title?: string;
  /** "Ada Lovelace, Charles Babbage", as given and family names. */
  authors?: string;
  year?: number | string;
  /** `container-title`. */
  venue?: string;
  doi?: string;
  url?: string;
  csl?: Partial<Omit<CslItem, 'id'>>;
};

/**
 * A reference record (`ReferenceRecord`) for a test: a paper that a paper
 * source found (`unchecked`, no flags) unless the fields say otherwise, its
 * `csl.id` its key, its title the key when none is given.
 */
export function reference(key: string, fields: ReferenceFields = {}): ReferenceRecord {
  const { title, authors, year, venue, doi, url, csl, ...rest } = fields;
  const item: CslItem = { id: key, type: 'article-journal', title: title ?? key, ...csl };
  if (venue) item['container-title'] = venue;
  if (doi) item.DOI = doi;
  if (url) item.URL = url;
  if (authors) {
    item.author = authors.split(/\s*,\s*/).map((name) => {
      const words = name.trim().split(/\s+/);
      return words.length > 1 ? { given: words.slice(0, -1).join(' '), family: words.at(-1) ?? name } : { family: name };
    });
  }
  if (year) item.issued = { 'date-parts': [[Number(year)]] };
  return { key, kind: 'paper', provider: 'openalex', state: 'unchecked', flags: [], ...rest, csl: item };
}

/**
 * A source as the `evidence` event and a reply's record carry it, decoded:
 * its handle, its reference record, and the rest as the evidence store sends
 * it (the record's kind, state, flags and provider). It is also what the
 * wire sends, so a mock handler or a stored reply record can carry it.
 */
export function agentSource(
  handle: string,
  record: ReferenceRecord | (ReferenceFields & { key: string }),
  extra: Partial<Omit<AgentSource, 'handle' | 'record'>> = {},
): AgentSource {
  const full = 'csl' in record && record.csl && 'id' in record.csl ? (record as ReferenceRecord) : reference(record.key, record as ReferenceFields);
  return {
    handle,
    key: full.key,
    kind: full.kind,
    title: full.csl.title,
    state: full.state,
    flags: [...full.flags],
    provider: full.provider,
    record: full,
    ...extra,
  };
}
