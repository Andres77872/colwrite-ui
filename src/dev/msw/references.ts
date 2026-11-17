/**
 * The mock's reference audit, AI-use log and claim check, as the API computes
 * them (`ColWrite-api/src/services/reference_audit.py`, `ai_use.py`,
 * `claim_checks.py`, `docs/citations.md`), over the fixtures' pages and the
 * works the mock's registries know (`REGISTRY_RECORDS`).
 *
 * The audit looks every library reference up again: a work the registries
 * now give otherwise is `stale`, and its newer record is proposed as an
 * `update_sources` change set (`origin: "reference_audit"`). It counts the
 * orphan citations, uncited entries, duplicates (one key among the other's
 * identifiers, or the same title, first author and year), cited preprints
 * with a version of record and citations with no passage. With outside
 * research off in the workspace nothing is looked up and nothing refreshed.
 */
import type {
  AiUseEntry,
  AiUseStatement,
  AuditedReference,
  ClaimCheckResult,
  ReferenceAuditReport,
  ReferenceRecordOutput,
} from '@/api/schema';
import { FEDUS, LEPIKHIN, OKAFOR, SHAZEER, VASWANI, VASWANI_DOI, ZOPH } from '../fixtureReferences';

type Record_ = ReferenceRecordOutput;
type WireBlock = { id: string; type: string; html?: string; children?: Array<Record<string, unknown>> };
type Page = { _id: string; blocks: WireBlock[]; sources?: Record_[] | null };

/**
 * What the mock's registries give each work today. GShard has had a
 * correction since the page cited it, so an audit finds its entry stale and
 * proposes the newer record; the others are as the page holds them.
 */
export const REGISTRY_RECORDS: ReadonlyMap<string, Record_> = new Map([
  ...[VASWANI, FEDUS, SHAZEER, OKAFOR, ZOPH].map((work) => [work.key, work] as const),
  [VASWANI_DOI.key, { ...VASWANI_DOI, state: 'verified' as const, checked: '2026-11-16' }],
  [LEPIKHIN.key, {
    ...LEPIKHIN,
    flags: ['corrected' as const],
    checked: '2026-11-16',
    notices: [{ type: 'correction' as const, date: '2026-10-02', doi: '10.5555/iclr.2021.fix', source: 'crossref' }],
  }],
]);

const RESOLVABLE = /^(doi|arxiv|pmid|pmcid):/;

/** The other keys a record names its work by: its DOI and its arXiv id. */
function identifiersOf(record: Record_): string[] {
  const ids = [record.key];
  if (record.csl.DOI) ids.push(`doi:${record.csl.DOI.toLowerCase()}`);
  const arxiv = record.csl.DOI?.match(/^10\.48550\/arxiv\.(.+)$/i)?.[1];
  if (arxiv) ids.push(`arxiv:${arxiv}`);
  return ids;
}

const firstAuthor = (record: Record_) => record.csl.author?.[0]?.family?.toLowerCase() ?? '';
const yearOf = (record: Record_) => record.csl.issued?.['date-parts']?.[0]?.[0] ?? null;

/** The fields an audit compares, and the CSL variables a reader sees printed. */
function changesBetween(page: Record_, now: Record_): string[] {
  const changed: string[] = [];
  const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
  for (const field of ['state', 'flags', 'notices', 'published_doi', 'differs'] as const) {
    if (!same(page[field], now[field])) changed.push(field);
  }
  for (const variable of ['title', 'author', 'issued', 'container-title', 'volume', 'issue', 'page', 'DOI', 'publisher', 'type'] as const) {
    if (!same(page.csl[variable], now.csl[variable])) changed.push(variable);
  }
  return changed;
}

type Citation = { blockId: string; id: string; keys: string[]; passage: unknown };

function citationsOf(page: Page): Citation[] {
  return page.blocks.flatMap((block) => (block.children ?? []).flatMap((child) => (
    child.type === 'citation'
      ? [{ blockId: block.id, id: String(child.id), keys: (child.keys as string[] | undefined) ?? [], passage: child.passage ?? null }]
      : []
  )));
}

/**
 * The page's audit as `GET …/references/status` reports it, and the records
 * to refresh (`update_sources`). `outsideLookups` is the workspace's policy.
 */
export function auditPage(page: Page, etag: string, outsideLookups: boolean): { report: ReferenceAuditReport; refresh: Record_[] } {
  const library = page.sources ?? [];
  const citations = citationsOf(page);
  const cited = new Map<string, number>();
  for (const citation of citations) for (const key of citation.keys) cited.set(key, (cited.get(key) ?? 0) + 1);
  const refresh: Record_[] = [];

  const references: AuditedReference[] = library.map((record) => {
    const uses = cited.get(record.key) ?? 0;
    const resolvable = RESOLVABLE.test(record.key) || Boolean(record.csl.DOI);
    const now = outsideLookups && resolvable ? REGISTRY_RECORDS.get(record.key) : undefined;
    const outcome: AuditedReference['outcome'] = !outsideLookups ? 'not_checked' : !resolvable ? 'not_checkable' : now ? 'checked' : 'not_found';
    const shown = now ?? record;
    const changes = now ? changesBetween(record, now) : [];
    const stale = changes.length > 0;
    if (stale && now) refresh.push(structuredClone(now));
    const flags = [...shown.flags.filter((flag) => flag !== 'uncited'), ...(uses === 0 ? ['uncited' as const] : [])];
    return {
      key: record.key,
      title: shown.csl.title,
      kind: shown.kind,
      provider: shown.provider,
      state: outcome === 'not_found' ? 'not_found' : shown.state,
      flags,
      cited: uses,
      outcome,
      stale,
      changes: stale ? changes : null,
      checked: now?.checked ?? record.checked ?? null,
      differs: shown.differs ?? null,
      notices: shown.notices ?? null,
      published_doi: shown.published_doi ?? null,
      aliases: identifiersOf(shown).filter((id) => id !== shown.key),
      found_title: null,
    };
  });

  const held = new Set(library.map((record) => record.key));
  const orphanKeys = [...cited.keys()].filter((key) => !held.has(key));
  const orphans = orphanKeys.map((key) => ({
    key,
    title: key,
    block_ids: [...new Set(citations.filter((citation) => citation.keys.includes(key)).map((citation) => citation.blockId))],
    resolved: outsideLookups && REGISTRY_RECORDS.has(key),
  }));

  const duplicates: ReferenceAuditReport['duplicates'] = [];
  for (let i = 0; i < library.length; i += 1) {
    for (let j = i + 1; j < library.length; j += 1) {
      const [a, b] = [library[i] as Record_, library[j] as Record_];
      if (identifiersOf(a).includes(b.key) || identifiersOf(b).includes(a.key)) {
        duplicates.push({ keys: [a.key, b.key], reason: 'identifier' });
      } else if (a.csl.title.toLowerCase() === b.csl.title.toLowerCase() && firstAuthor(a) === firstAuthor(b) && yearOf(a) === yearOf(b)) {
        duplicates.push({ keys: [a.key, b.key], reason: 'title' });
      }
    }
  }

  const preprints = library
    .filter((record) => (cited.get(record.key) ?? 0) > 0 && record.flags.includes('has_published_version'))
    .map((record) => ({
      key: record.key,
      published_doi: record.published_doi ?? null,
      published_in_library: Boolean(record.published_doi && held.has(`doi:${record.published_doi.toLowerCase()}`)),
    }));
  const withoutPassage = citations.filter((citation) => !citation.passage).map((citation) => ({
    block_id: citation.blockId, citation_id: citation.id, keys: citation.keys,
  }));

  const count = (test: (reference: AuditedReference) => boolean) => references.filter(test).length;
  const report: ReferenceAuditReport = {
    document_id: page._id,
    checked_at: new Date().toISOString(),
    etag,
    outside_lookups: outsideLookups,
    references,
    orphans,
    uncited: references.filter((reference) => reference.cited === 0).map((reference) => reference.key),
    duplicates,
    preprints,
    without_passage: withoutPassage,
    counts: {
      references: references.length,
      cited: count((reference) => reference.cited > 0),
      uncited: count((reference) => reference.cited === 0),
      verified: count((reference) => reference.state === 'verified'),
      needs_review: count((reference) => reference.state === 'needs_review'),
      not_found: count((reference) => reference.state === 'not_found'),
      unchecked: count((reference) => reference.state === 'unchecked'),
      mismatched: count((reference) => reference.outcome === 'mismatch'),
      retracted: count((reference) => reference.flags.includes('retracted')),
      stale: count((reference) => reference.stale),
      orphans: orphans.length,
      duplicates: duplicates.length,
      preprints: preprints.length,
      without_passage: withoutPassage.length,
    },
    change_set_id: null,
    notes: outsideLookups ? [] : ['Outside research is switched off in this workspace, so nothing was looked up.'],
  };
  return { report, refresh: outsideLookups ? refresh : [] };
}

/* ----------------------------------------
   The AI-use log (`ai_use.py`)
   ---------------------------------------- */

export const MOCK_BUILD = '2026.11.16-mock';
const TOOL_NAME = 'ColWrite assistant';
const PURPOSE_WORDS: Record<AiUseEntry['purposes'][number], string> = {
  drafted: 'draft new text',
  rewrote: 'rewrite passages',
  edited: 'edit wording',
  restructured: 'reorder or remove parts',
  added_citations: 'insert citations from checked records',
  managed_sources: 'add or remove reference library entries',
  refreshed_references: 'refresh reference records from the registries',
  set_metadata: 'rename the page or set its citation style',
  created_page: 'create the page',
  suggested: 'suggest rewrites in the editor',
  checked_references: 'check the references',
  generated_images: 'include AI-generated conceptual illustrations',
};

/** The purposes a change set's operations show, in a fixed order (`purposes_of`). */
export function purposesOf(tool: string, operations: ReadonlyArray<{ op: string; position?: string }>): AiUseEntry['purposes'] {
  const found = new Set<AiUseEntry['purposes'][number]>();
  if (tool === 'cite_sources') found.add('added_citations');
  for (const operation of operations) {
    if (operation.op === 'write_blocks') {
      if (tool !== 'cite_sources') found.add(operation.position === 'replace' ? 'rewrote' : 'drafted');
    } else if (operation.op === 'replace_text') found.add('edited');
    else if (operation.op === 'delete_blocks' || operation.op === 'move_block') found.add('restructured');
    else if (operation.op === 'set_meta') found.add('set_metadata');
    else if ((operation.op === 'add_sources' || operation.op === 'remove_sources') && tool !== 'cite_sources') found.add('managed_sources');
    else if (operation.op === 'update_sources') found.add('refreshed_references');
  }
  const order = Object.keys(PURPOSE_WORDS);
  return [...found].sort((a, b) => order.indexOf(a) - order.indexOf(b));
}

/** How a change set's result was verified, from its decisions (`_verification`). */
export function verificationOf(
  operations: number,
  decisions: ReadonlyArray<{ decision: string; origin?: string | null; decided_at?: string | null }>,
  status: string,
): AiUseEntry['verification'] {
  const accepted = decisions.filter((item) => item.decision === 'accepted');
  const auto = accepted.filter((item) => item.origin === 'auto').length;
  const rejected = decisions.filter((item) => item.decision === 'rejected').length;
  const pending = Math.max(0, operations - decisions.length);
  const method: AiUseEntry['verification']['method'] = pending === operations && status === 'pending'
    ? 'pending'
    : auto > 0 && auto === accepted.length && rejected === 0 && pending === 0
      ? 'applied_by_auto'
      : accepted.length === operations
        ? 'accepted_by_author'
        : accepted.length > 0
          ? 'partly_accepted'
          : rejected > 0 && pending === 0
            ? 'rejected'
            : pending > 0 ? 'pending' : 'not_applied';
  return {
    method,
    status,
    operations,
    accepted: accepted.length,
    accepted_by_auto: auto,
    rejected,
    pending,
    decided_at: decisions.at(-1)?.decided_at ?? null,
  };
}

const listed = (items: readonly string[]) => (items.length < 2 ? items.join('') : `${items.slice(0, -1).join(', ')} and ${items.at(-1)}`);

type Venue = AiUseStatement['venue'] & { note?: string };

/** The venue profiles (`VENUES`), as the API read them. */
export const MOCK_VENUES: readonly Venue[] = [
  { id: 'elsevier', name: 'Elsevier journals', placement: 'A separate AI declaration statement at submission, printed with the article.', asks: ['tool', 'purpose', 'verification'], required: true, policy_url: 'https://www.elsevier.com/about/policies-and-standards/generative-ai-policies-for-journals', read_on: '2026-11-15', read_from: 'page', note: 'Basic checks of grammar, spelling and punctuation need no declaration; substantive changes to structure or wording do.' },
  { id: 'taylor_and_francis', name: 'Taylor & Francis', placement: 'A statement within the article: the tool’s full name with its version, how it was used and why.', asks: ['tool', 'version', 'purpose'], required: true, policy_url: 'https://taylorandfrancis.com/our-policies/ai-policy/', read_on: '2026-11-15', read_from: 'page', note: 'Some journals allow language improvement only; check the journal’s own instructions.' },
  { id: 'ieee', name: 'IEEE', placement: 'The acknowledgments: the AI system used, the sections with AI-generated content, and the level of use.', asks: ['tool', 'parts', 'purpose'], required: true, policy_url: 'https://journals.ieeeauthorcenter.ieee.org/become-an-ieee-journal-author/publishing-ethics/guidelines-and-policies/submission-and-peer-review-policies/', read_on: '2026-11-15', read_from: 'page', note: 'Editing and grammar help need not be disclosed, but disclosure is recommended.' },
  { id: 'plos', name: 'PLOS', placement: 'The Methods, the Acknowledgements or the figure legend: the tools, how they were used, what was affected and how the output was validated.', asks: ['tool', 'version', 'purpose', 'parts', 'verification'], required: true, policy_url: 'https://journals.plos.org/plosone/s/ethical-publishing-practice', read_on: '2026-11-15', read_from: 'page', note: 'Spelling, grammar and rephrasing need no disclosure.' },
  { id: 'science', name: 'Science journals', placement: 'The cover letter, and the acknowledgments (writing) or the methods (research use), with the model name and version.', asks: ['tool', 'version', 'purpose'], required: true, policy_url: 'https://www.science.org/content/page/science-journals-editorial-policies', read_on: '2026-11-15', read_from: 'search_extract', note: 'AI-generated images are not permitted without the editors’ permission. Literature searches and language refinement need no declaration.' },
  { id: 'acm', name: 'ACM', placement: 'Writing assistance no longer needs disclosing; AI used in the research is described in the methods.', asks: ['tool', 'purpose'], required: false, policy_url: 'https://www.acm.org/publications/policies/frequently-asked-questions', read_on: '2026-11-15', read_from: 'search_extract', note: 'Some ACM conference pages still ask for full disclosure: check the venue’s call.' },
  { id: 'neurips', name: 'NeurIPS', placement: 'Writing and editing help need not be documented; an LLM that is an important, original or non-standard part of the method is described in the paper.', asks: ['tool', 'purpose'], required: false, policy_url: 'https://neurips.cc/Conferences/2026/MainTrackHandbook', read_on: '2026-11-15', read_from: 'page', note: 'The position-paper track asks for AI to be used only for copy-editing.' },
  { id: 'iclr', name: 'ICLR', placement: 'Any use of an LLM is disclosed, in the paper’s text and in the submission form.', asks: ['tool', 'version', 'purpose', 'parts'], required: true, policy_url: 'https://blog.iclr.cc/2025/08/26/policies-on-large-language-model-usage-at-iclr-2026/', read_on: '2026-11-15', read_from: 'page' },
];

const LIMITS_SENTENCE = 'This record covers what the ColWrite assistant did on this page; it does not cover text from other tools pasted into it.';

/** A draft statement for `venue` from the page's entries (`render_statement`). */
export function renderStatement(venue: Venue, entries: readonly AiUseEntry[]): AiUseStatement {
  const kept = (entry: AiUseEntry) => !['rejected', 'not_applied', 'pending', 'unknown'].includes(entry.verification.method);
  const acting = entries.filter((entry) => entry.kind !== 'reference_check' && kept(entry));
  const checks = entries.filter((entry) => entry.kind === 'reference_check');
  const methods = acting.map((entry) => entry.verification.method);
  const order = Object.keys(PURPOSE_WORDS) as Array<AiUseEntry['purposes'][number]>;
  const summary: AiUseStatement['summary'] = {
    actions: acting.length,
    purposes: order.filter((purpose) => acting.some((entry) => entry.purposes.includes(purpose))),
    models: [...new Set(acting.flatMap((entry) => entry.models))],
    build: MOCK_BUILD,
    sections: [...new Set(acting.flatMap((entry) => entry.sections))],
    accepted_by_author: methods.filter((method) => method === 'accepted_by_author' || method === 'partly_accepted').length,
    applied_by_auto: methods.filter((method) => method === 'applied_by_auto').length,
    suggestions: methods.filter((method) => method === 'not_recorded').length,
    reference_checks: checks.length,
    last_reference_check: checks.at(-1)?.at?.slice(0, 10) ?? null,
    first_at: acting[0]?.at ?? null,
    last_at: acting.at(-1)?.at ?? null,
  };
  const { note, ...profile } = venue;
  const notes = [
    ...(venue.required ? [] : [`${venue.name} does not require disclosing writing assistance; the statement is there if you choose to.`]),
    ...(note ? [note] : []),
    ...(venue.read_from === 'search_extract' ? ['This venue’s policy was read through a search extract: check the policy page before submitting.'] : []),
    'A draft from the page’s log: edit it to say what you did.',
  ];
  if (!summary.actions && !summary.reference_checks) {
    return { venue: profile, statement: `No use of the ${TOOL_NAME} is recorded for this page. ${LIMITS_SENTENCE}`, summary, notes };
  }
  let tool = `the ${TOOL_NAME}`;
  if (venue.asks.includes('version') || venue.asks.includes('tool')) {
    tool = `the ${TOOL_NAME} (ColWrite ${summary.build}, with ${listed(summary.models) || 'the models it was configured with'})`;
  }
  const purposes = listed(summary.purposes.map((purpose) => PURPOSE_WORDS[purpose])) || 'review the references';
  const sentences = [
    venue.id === 'elsevier'
      ? `During the preparation of this work the author(s) used ${tool} in order to ${purposes}.`
      : `The authors used ${tool} to ${purposes}.`,
  ];
  if (venue.asks.includes('parts') && summary.sections.length) {
    sentences.push(`It was used in the sections ${listed(summary.sections.slice(0, 8).map((section) => `“${section}”`))}.`);
  }
  if (summary.purposes.includes('generated_images')) {
    sentences.push('AI-generated illustrations are recorded on this page. The log does not establish their visual accuracy or venue permission; verify both and disclose the images in their captions or methods.');
  }
  if (summary.reference_checks) {
    sentences.push(`The references were checked against the bibliographic registries with ColWrite${summary.last_reference_check ? ` on ${summary.last_reference_check}.` : '.'}`);
  }
  const verified = [
    ...(summary.accepted_by_author ? ['each proposed change was reviewed by the authors and accepted or rejected one at a time'] : []),
    ...(summary.applied_by_auto ? ['some changes were applied automatically and then reviewed by the authors'] : []),
    ...(summary.suggestions ? ['the authors chose in the editor whether to keep each suggestion'] : []),
  ];
  if ((venue.asks.includes('verification') || venue.id === 'plos' || venue.id === 'elsevier') && verified.length) {
    sentences.push(`To validate the output, ${listed(verified)}.`);
  }
  sentences.push(venue.id === 'elsevier'
    ? 'After using this tool, the author(s) reviewed and edited the content as needed and take(s) full responsibility for the content of the published article.'
    : 'The authors reviewed the content and take full responsibility for it.');
  sentences.push(LIMITS_SENTENCE);
  return { venue: profile, statement: sentences.join(' '), summary, notes };
}

/* ----------------------------------------
   The Research panel's claim check (`claim_checks.py`)
   ---------------------------------------- */

/** The text the mock's sources hold of each work: Switch Transformers' full text, the others' abstracts. */
const PASSAGES: ReadonlyMap<string, { text: string; level: 'full_text' | 'abstract' }> = new Map([
  [FEDUS.key, { text: 'We simplify the MoE routing algorithm: each token is routed to a single expert, which keeps the computational cost per token constant as experts are added.', level: 'full_text' }],
  [ZOPH.key, { text: 'Router z-loss resolves training instabilities while slightly improving quality, at a fraction of the compute of a dense model.', level: 'abstract' }],
  [VASWANI.key, { text: 'We propose the Transformer, based solely on attention mechanisms, dispensing with recurrence and convolutions entirely.', level: 'abstract' }],
  [LEPIKHIN.key, { text: 'GShard enables scaling a multilingual translation model with sparsely gated mixture of experts beyond 600 billion parameters.', level: 'abstract' }],
]);

const RECORDS: ReadonlyMap<string, Record_> = new Map([FEDUS, ZOPH, VASWANI, LEPIKHIN, OKAFOR].map((work) => [work.key, work]));

/**
 * What `claim_check` judges, outside a conversation. With sources named,
 * their passages (an abstract where the mock holds no text): on abstracts
 * alone, "cannot assess". With none, passages of papers' text about the
 * claim: Switch Transformers' full text supports it, ST-MoE's abstract
 * narrows it.
 */
export function claimCheckResult(claim: string, sources: readonly string[]): ClaimCheckResult {
  const named = sources.length > 0;
  const keys = named ? sources.filter((key) => PASSAGES.has(key)) : [FEDUS.key, ZOPH.key];
  const passages = keys.map((key, index) => {
    const held = PASSAGES.get(key)!;
    const stance: ClaimCheckResult['passages'][number]['stance'] = named
      ? 'unrelated'
      : index === 0 ? 'supports' : 'limits';
    return { id: `P${index + 1}`, text: held.text, level: held.level, stance, record: structuredClone(RECORDS.get(key)!), section: null, page: null };
  });
  const fullText = passages.some((passage) => passage.level === 'full_text');
  const supports = passages.some((passage) => passage.stance === 'supports');
  const limits = passages.some((passage) => passage.stance === 'limits');
  const verdict: ClaimCheckResult['verdict'] = supports ? (limits ? 'partly' : 'supported') : 'insufficient';
  const cannotAssess = verdict === 'insufficient' && !fullText;
  return {
    claim: claim.split(/\s+/).join(' ').trim(),
    verdict,
    summary: cannotAssess
      ? 'The abstracts do not say enough to judge the claim.'
      : verdict === 'partly'
        ? 'Switch Transformers bears out the routing claim; ST-MoE qualifies it for training stability.'
        : 'The passages bear the claim out.',
    evidence_level: passages.length ? (fullText ? 'full_text' : 'abstract') : null,
    cannot_assess: cannotAssess,
    note: null,
    how_to_get: cannotAssess ? 'Upload the paper’s PDF and check it against the full text, or open an open-access copy.' : null,
    judged: null,
    passages,
    not_found: sources.filter((key) => !PASSAGES.has(key)),
    notes: [],
    usage: { model_calls: 1, input_tokens: 1_840, output_tokens: 220, cost: 0.0042 },
  };
}
