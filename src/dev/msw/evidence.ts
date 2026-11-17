/**
 * A conversation's evidence store, as the mock keeps it: a port of the API's
 * (`ColWrite-api/src/agent/notebook/evidence.py`, `docs/assistant-notebook.md`)
 * down to what the preview shows.
 *
 * - A source is a work the conversation may cite, under a handle (`S1`,
 *   `S2`, …) issued once per conversation and never reused. Works merge by
 *   key and alias: one work, one handle, and a later record of it fills in
 *   the fields the first lacked.
 * - A passage is an excerpt of a source a tool returned (`S3.1`, `S3.2`, …),
 *   with how much of the work the server holds. The same excerpt read again
 *   names the same passage. The `evidence` event carries its id and level;
 *   an author can read its text on demand through the private source route.
 * - One run sends each source the first time it touches it (new, or a work
 *   an earlier turn found, found again) and again when it changed, and each
 *   new passage once.
 *
 * A chat keeps its store with its messages (`StoredChat.evidence`), so a
 * later turn cites what an earlier one found; an inline run has none and
 * keeps its evidence for the run.
 */
import type { EvidenceData, EvidencePassage, EvidenceSource, ReferenceRecordOutput } from '@/api/schema';

/** A source's record: the reference as the page's library holds it (`ReferenceRecord`). */
export type WorkRecord = ReferenceRecordOutput;
/** A work as a tool states it (the API's `source` member): its record, its kind, and the other keys it is known by. */
export type Work = { record: WorkRecord; kind: EvidenceSource['kind']; aliases?: readonly string[] };
/** An excerpt as a tool states it (the API's `passage` member). */
export type Excerpt = { text: string; level: EvidencePassage['level'] };

type StoredSource = EvidenceSource & { aliases: string[] };
type StoredPassage = EvidencePassage & { text: string };
/** What a conversation keeps: its sources and passages, in the order they were stored. */
export type StoredEvidence = { sources: StoredSource[]; passages: StoredPassage[] };

export function emptyEvidence(): StoredEvidence {
  return { sources: [], passages: [] };
}

/** The source as the `evidence` event and a reply's record carry it. */
function sent({ aliases: _aliases, ...source }: StoredSource): EvidenceSource {
  return structuredClone(source);
}

/** A stored source, from a work: its state and flags are its record's, the provider the one that returned it. */
function stored(handle: string, work: Work): StoredSource {
  const record = structuredClone(work.record);
  return {
    handle,
    key: record.key,
    kind: work.kind,
    title: record.csl.title,
    state: record.state,
    flags: [...record.flags],
    provider: record.provider,
    record,
    aliases: (work.aliases ?? []).filter((alias) => alias && alias !== record.key),
  };
}

/** A conversation's store seeded with works, under `S1`, `S2`, … in order. */
export function seededEvidence(works: readonly Work[], passages: ReadonlyArray<{ handle: string; excerpt: Excerpt }> = []): StoredEvidence {
  const store = emptyEvidence();
  const run = new RunEvidence(store);
  const handles = works.map((work) => run.register(work).handle);
  for (const { handle, excerpt } of passages) {
    const index = handles.indexOf(handle);
    const work = works[index];
    if (work) run.register(work, [excerpt]);
  }
  return store;
}

/** One run's view of a conversation's store: what it registers, and the `evidence` events it sends. */
export class RunEvidence {
  private readonly sentHandles = new Set<string>();
  private unsentSources: string[] = [];
  private unsentPassages: string[] = [];
  private readonly store: StoredEvidence;

  constructor(store: StoredEvidence) {
    this.store = store;
  }

  /** Register one work and its excerpts: the work's handle (its `cite_as`) and the excerpts' passage ids. */
  register(work: Work, excerpts: readonly Excerpt[] = []): { handle: string; passages: string[] } {
    const source = this.admit(work);
    const passages = excerpts.map((excerpt) => this.admitPassage(source, excerpt));
    return { handle: source.handle, passages };
  }

  /**
   * A work the citation pipeline checked: its checked reference replaces what
   * the conversation held (`cite_sources`), and is sent again.
   */
  checked(handle: string, record: WorkRecord): void {
    const source = this.store.sources.find((item) => item.handle === handle);
    if (!source) return;
    source.record = structuredClone(record);
    source.state = record.state;
    source.flags = [...record.flags];
    source.provider = record.provider;
    this.touch(handle, true);
  }

  /** The record a handle names, or `undefined`. */
  recordOf(handle: string): WorkRecord | undefined {
    return this.store.sources.find((item) => item.handle === handle)?.record as WorkRecord | undefined;
  }

  /** The handles the conversation holds, in the order they were issued. */
  handles(): string[] {
    return this.store.sources.map((source) => source.handle);
  }

  /** The `evidence` event of what this run touched since the last one, or `null` when it touched nothing. */
  drain(): EvidenceData | null {
    if (!this.unsentSources.length && !this.unsentPassages.length) return null;
    const event: EvidenceData = {
      sources: this.unsentSources.flatMap((handle) => {
        const source = this.store.sources.find((item) => item.handle === handle);
        return source ? [sent(source)] : [];
      }),
      passages: this.unsentPassages.flatMap((id) => {
        const item = this.store.passages.find((passage) => passage.id === id);
        return item ? [{ id: item.id, level: item.level }] : [];
      }),
    };
    for (const handle of this.unsentSources) this.sentHandles.add(handle);
    this.unsentSources = [];
    this.unsentPassages = [];
    return event;
  }

  private admit(work: Work): StoredSource {
    const names = [work.record.key, ...(work.aliases ?? [])];
    const existing = this.store.sources.find((source) => names.some((name) => name === source.key || source.aliases.includes(name)));
    if (!existing) {
      const number = Math.max(0, ...this.store.sources.map((source) => Number(source.handle.slice(1)))) + 1;
      const source = stored(`S${number}`, work);
      this.store.sources.push(source);
      this.touch(source.handle, true);
      return source;
    }
    // A later record of the same work fills in the CSL variables the first lacked.
    let changed = false;
    const csl = existing.record.csl as Record<string, unknown>;
    for (const [field, value] of Object.entries(work.record.csl)) {
      if (csl[field] == null && value != null) {
        csl[field] = value;
        changed = true;
      }
    }
    if (existing.kind === 'other' && work.kind !== 'other') {
      existing.kind = work.kind;
      changed = true;
    }
    this.touch(existing.handle, changed);
    return existing;
  }

  private admitPassage(source: StoredSource, excerpt: Excerpt): string {
    const id = this.store.passages.find((item) => item.id.startsWith(`${source.handle}.`) && item.level === excerpt.level && item.text === excerpt.text)?.id;
    if (id) return id;
    const count = this.store.passages.filter((item) => item.id.startsWith(`${source.handle}.`)).length;
    const passage: StoredPassage = { id: `${source.handle}.${count + 1}`, level: excerpt.level, text: excerpt.text };
    this.store.passages.push(passage);
    this.unsentPassages.push(passage.id);
    return passage.id;
  }

  /** Sent with the next event: new or changed, or the first time this run touches it. */
  private touch(handle: string, changed: boolean): void {
    if ((changed || !this.sentHandles.has(handle)) && !this.unsentSources.includes(handle)) this.unsentSources.push(handle);
  }
}
