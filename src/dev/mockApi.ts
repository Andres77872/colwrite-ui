/**
 * An in-browser stand-in for ColWrite-api, for the dev preview only.
 *
 * `dev-preview.html` installs it before the app loads, so the real app — auth,
 * editor, assistant, panels — renders signed in against a fixture document
 * without a server, credentials or anyone's real data. Nothing here is
 * imported by `index.html`, so production builds never include it.
 */
import { uid } from '@/lib/uid';
import type { ChatAttachment, ChatImage } from '@/services/chatAttachments';
import agentTools from './agentToolsFixture.json';
import { installMockAssistantSocket } from './mockAssistantSocket';
import type { AgentToolSettings } from '@/services/agentTools';
type PreviewAgentSettings = AgentToolSettings & Required<Pick<AgentToolSettings, 'skills' | 'features'>>;
const agentPreferences = structuredClone(agentTools) as PreviewAgentSettings;
import { FIXTURE_DOCUMENT_ID, fixtureDocument } from './fixtureDocument';

type Json = Record<string, unknown>;

const now = new Date('2026-09-20T14:32:00Z').toISOString();
const store = new Map<string, Json>([[FIXTURE_DOCUMENT_ID, fixtureDocument()]]);
const simpleDocument = (_id: string, name: string, version: number, text: string): Json => ({
  _id,
  name,
  version,
  tags: [],
  blocks: [
    { id: `${_id}-h`, type: 'heading', level: 1, html: 'Notes' },
    { id: `${_id}-p`, type: 'paragraph', html: text, children: [] },
  ],
});
for (const doc of [
  simpleDocument('66f0c0ffee0000000000d0c2', 'Related work: conditional computation', 7, 'Mixture-of-experts, routing, and sparsity.'),
  simpleDocument('66f0c0ffee0000000000d0c3', 'Rebuttal notes — ICLR', 2, 'Reviewer 2 asks for a dense baseline at 128k.'),
  simpleDocument('66f0c0ffee0000000000d0c4', 'Scaling laws reading list', 11, 'Kaplan 2020, Hoffmann 2022, Clark 2022.'),
]) {
  store.set(String(doc._id), doc);
}

const REVISIONS = [
  { revision_id: 'rev-3', revision_no: 3, parent_revision_id: 'rev-2', kind: 'save', actor_type: 'human', origin: 'human', created_at: '2026-09-20T14:32:00Z', byte_size: 5120, content_hash: 'h3', summary: 'Edited Method' },
  { revision_id: 'rev-2', revision_no: 2, parent_revision_id: 'rev-1', kind: 'change_set_accept', actor_type: 'agent', origin: 'agent', created_at: '2026-09-19T09:12:00Z', byte_size: 4980, content_hash: 'h2', summary: 'Accepted 2 AI suggestions' },
  { revision_id: 'rev-1', revision_no: 1, parent_revision_id: null, kind: 'create', actor_type: 'human', origin: 'human', created_at: '2026-09-18T17:40:00Z', byte_size: 1200, content_hash: 'h1', summary: 'Created' },
];

/**
 * What each revision held, derived from the live fixture: v2 → v3 reworded the
 * Method paragraph; v1 → v2 (the accepted AI suggestions) rewrote the claim in
 * the introduction, added a contribution and changed a citation's sources.
 */
const OLD_METHOD = 'The objective adds an auxiliary balance term to the task loss: <span data-child-id="e-3" contenteditable="false"></span>';
const OLD_CLAIM = 'We show that sparse routing scales <strong>sublinearly</strong> in compute. Each token <span data-child-id="e-1" contenteditable="false"></span> goes to expert <span data-child-id="e-2" contenteditable="false"></span> through a gate.';

function revisionContent(content: Json, revisionNo: number): Json {
  if (revisionNo >= 3) return content;
  const blocks = (content.blocks as Json[]).flatMap((block): Json[] => {
    if (block.id === 'p-3') return [{ ...block, html: OLD_METHOD }];
    if (revisionNo >= 2) return [block];
    if (block.id === 'p-2') return [{ ...block, html: OLD_CLAIM }];
    if (block.id === 'li-4') return [];
    if (block.id === 'p-1') {
      const children = (block.children as Json[]).map((child) =>
        child.id === 'c-1' ? { ...child, keys: ['2101.03961'] } : child,
      );
      return [{ ...block, children }];
    }
    return [block];
  });
  return { ...content, blocks };
}

const METHOD_CHANGE = { entity: 'block', change: 'changed', entity_id: 'p-3', entity_type: 'paragraph', fields: ['html'] };
const AI_CHANGES = [
  { entity: 'block', change: 'changed', entity_id: 'p-2', entity_type: 'paragraph', fields: ['html'] },
  { entity: 'block', change: 'inserted', entity_id: 'li-4', entity_type: 'paragraph', to_index: 7, fields: [] },
  { entity: 'child', change: 'changed', entity_id: 'c-1', entity_type: 'citation', parent_id: 'p-1', fields: ['keys', 'sources'] },
];

/** The diff between two stored states, in the API's shape. */
function revisionChanges(base: string, against: string): Json[] {
  const rank = (id: string) => (id === 'current' ? 3 : Number(id.replace('rev-', '')) || 3);
  const from = rank(base);
  const to = rank(against);
  const changes: Json[] = [];
  if (from < 2 && to >= 2) changes.push(...AI_CHANGES);
  if (from < 3 && to >= 3) changes.push(METHOD_CHANGE);
  return changes;
}

/**
 * Each document's version tree, as the API keeps it (ColWrite-api
 * `docs/document-history-api.md`): a save writes a revision under the one the
 * document sits on, and a restore moves that pointer without writing one.
 */
type MockHistory = {
  /** Newest first, as the API lists them. */
  revisions: Json[];
  /** What each revision held. */
  contents: Map<string, Json>;
  /** The revision the document sits on. */
  pointer: string;
};
const histories = new Map<string, MockHistory>();

function contentOf(doc: Json): Json {
  return { schema_version: 1, name: doc.name, tags: doc.tags ?? [], blocks: doc.blocks, sources: doc.sources, citationStyle: doc.citationStyle };
}

function historyOf(doc: Json): MockHistory {
  const id = String(doc._id);
  const existing = histories.get(id);
  if (existing) return existing;
  const content = structuredClone(contentOf(doc));
  const version = Number(doc.version ?? 1);
  const seeded = id === FIXTURE_DOCUMENT_ID && version === REVISIONS[0].revision_no;
  const revisions: Json[] = seeded
    ? REVISIONS.map((revision) => ({ ...revision }))
    : [{ revision_id: `rev-${version}`, revision_no: version, parent_revision_id: null, kind: 'save', actor_type: 'human', origin: 'human', created_at: now, byte_size: 1200, content_hash: `h${version}`, summary: null }];
  const contents = new Map<string, Json>(
    revisions.map((revision) => [
      String(revision.revision_id),
      seeded ? revisionContent(content, Number(revision.revision_no)) : content,
    ]),
  );
  const created: MockHistory = { revisions, contents, pointer: String(revisions[0].revision_id) };
  histories.set(id, created);
  return created;
}

/** Record a write as a new revision under the current one, and move onto it. */
function recordRevision(doc: Json, summary: string | null = null): void {
  const history = historyOf(doc);
  const revisionNo = Math.max(...history.revisions.map((revision) => Number(revision.revision_no))) + 1;
  const revisionId = `rev-${revisionNo}`;
  const content = structuredClone(contentOf(doc));
  history.revisions.unshift({
    revision_id: revisionId,
    revision_no: revisionNo,
    parent_revision_id: history.pointer,
    kind: 'save',
    actor_type: 'human',
    origin: 'human',
    created_at: new Date().toISOString(),
    byte_size: JSON.stringify(content).length,
    content_hash: `h${revisionNo}`,
    summary,
  });
  history.contents.set(revisionId, content);
  history.pointer = revisionId;
}

/** Block-level changes between two stored states, by stable id as the API does. */
function blockChanges(base: Json, target: Json): Json[] {
  const blocksOf = (content: Json) => (content.blocks as Json[] | undefined) ?? [];
  const before = new Map(blocksOf(base).map((block, index) => [String(block.id), { block, index }]));
  const after = new Map(blocksOf(target).map((block, index) => [String(block.id), { block, index }]));
  const changes: Json[] = [];
  for (const [id, { block, index }] of before) {
    if (!after.has(id)) changes.push({ entity: 'block', change: 'deleted', entity_id: id, entity_type: block.type, from_index: index, fields: [] });
  }
  for (const [id, { block, index }] of after) {
    const previous = before.get(id);
    if (!previous) {
      changes.push({ entity: 'block', change: 'inserted', entity_id: id, entity_type: block.type, to_index: index, fields: [] });
      continue;
    }
    const fields = [...new Set([...Object.keys(previous.block), ...Object.keys(block)])].filter(
      (field) => JSON.stringify(previous.block[field]) !== JSON.stringify(block[field]),
    );
    if (fields.length > 0) changes.push({ entity: 'block', change: 'changed', entity_id: id, entity_type: block.type, fields });
  }
  return changes;
}

/* ----------------------------------------
   Stored change sets (durable proposals)
   ---------------------------------------- */

/**
 * A document whose stored change set was left half-reviewed, so per-operation
 * review can be seen without a backend: open "Camera-ready edits (review in
 * progress)" from the documents menu.
 *
 * Of its five operations, one was accepted and one rejected before; the
 * server's record says so, and they are not offered again. Three are left,
 * and one of those rewrites a paragraph the author changed after the
 * assistant read it, which the target fingerprints show. Shapes follow
 * ColWrite-api `docs/document-history-api.md` (Per-operation review,
 * Operation targets).
 */
export const REVIEW_DOCUMENT_ID = '66f0c0ffee0000000000d0c5';
const REVIEW_CHANGE_SET_ID = '7d1f0c6e-5a0b-4d7e-9f43-2b6f1c0a9e11';

/** What the assistant read in the Results paragraph, before the author changed it. */
const RESULTS_AS_PROPOSED = 'Sparse routing matches the dense baseline at roughly half the compute.';

const reviewParagraph = (id: string, html: string): Json => ({ id, type: 'paragraph', html, children: [] });

store.set(REVIEW_DOCUMENT_ID, {
  _id: REVIEW_DOCUMENT_ID,
  name: 'Camera-ready edits (review in progress)',
  version: 4,
  tags: [],
  blocks: [
    { id: 'cr-h', type: 'heading', level: 1, html: 'Camera-ready edits' },
    reviewParagraph('cr-abstract', 'We study sparse routing at long context lengths and find that it scales well.'),
    reviewParagraph('cr-setup', 'All models are trained for 100k steps on sequences of up to 128k tokens.'),
    // The insert the author already accepted.
    reviewParagraph('cr-seeds', 'Each configuration is run with three seeds, and we report the mean.'),
    // Rewritten by the author after the assistant proposed its own version.
    reviewParagraph('cr-results', 'Sparse routing matches the dense baseline at 38% of the compute, measured on the 128k split.'),
    reviewParagraph('cr-limits', 'We did not evaluate sequences longer than 128k tokens.'),
    // The deletion the author already rejected.
    reviewParagraph('cr-thanks', 'We thank the anonymous reviewers for their comments.'),
  ],
});

/**
 * A stand-in for the API's block digest. Like the real one it is only ever
 * compared with another digest from the same function, and it ignores how a
 * block is shown. It reads the fields the preview's paragraphs and headings
 * have, so the defaults the editor adds on a save do not count as an edit.
 */
function mockFingerprint(block: Json): string {
  const text = JSON.stringify([
    block.type ?? '', block.html ?? '', block.text ?? '', block.variant ?? '', block.level ?? 0, block.checked ?? false,
  ]);
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    hash = Math.imul(hash ^ text.charCodeAt(index), 0x01000193);
  }
  return `preview-${(hash >>> 0).toString(16).padStart(8, '0')}`;
}

type MockChangeSet = {
  change_set_id: string;
  document_id: string;
  status: string;
  /** In the API's wire shape (`block_id`, `reference_id`). */
  operations: Json[];
  /** The target block as each rewrite or deletion found it; `null` for the rest. */
  targets: Array<{ block_id: string; fingerprint: string } | null>;
  decisions: Array<{ index: number; decision: string; decided_at: string; decided_by: string }>;
  proposed_at: string;
  expires_at: string;
  decided_at: string | null;
  conflict_reason: string | null;
  rejection_reason: string | null;
  summary: string | null;
};

function seededChangeSet(): MockChangeSet {
  const blocks = new Map(
    ((store.get(REVIEW_DOCUMENT_ID)?.blocks as Json[] | undefined) ?? []).map((block) => [String(block.id), block]),
  );
  const found = (id: string, html?: string) => ({
    block_id: id,
    fingerprint: mockFingerprint(html === undefined ? blocks.get(id) ?? {} : { ...blocks.get(id), html }),
  });
  return {
    change_set_id: REVIEW_CHANGE_SET_ID,
    document_id: REVIEW_DOCUMENT_ID,
    status: 'pending',
    operations: [
      {
        op: 'replace_block',
        block_id: 'cr-abstract',
        block: { html: 'We study sparse routing at context lengths of up to 128k tokens and find that its compute cost grows <strong>sublinearly</strong>.' },
      },
      {
        op: 'insert_block_after',
        reference_id: 'cr-setup',
        block: reviewParagraph('cr-seeds', 'Each configuration is run with three seeds, and we report the mean.'),
      },
      {
        op: 'replace_block',
        block_id: 'cr-results',
        block: { html: 'Sparse routing matches the dense baseline at 40% of the compute.' },
      },
      { op: 'delete_block', block_id: 'cr-thanks' },
      {
        op: 'append_block',
        block: reviewParagraph('cr-future', 'Future work will extend the evaluation beyond 128k tokens.'),
      },
    ],
    targets: [found('cr-abstract'), null, found('cr-results', RESULTS_AS_PROPOSED), found('cr-thanks'), null],
    decisions: [
      { index: 1, decision: 'accepted', decided_at: '2026-09-20T13:10:00Z', decided_by: 'preview' },
      { index: 3, decision: 'rejected', decided_at: '2026-09-20T13:11:00Z', decided_by: 'preview' },
    ],
    proposed_at: '2026-09-20T13:05:00Z',
    expires_at: '2099-01-01T00:00:00Z',
    decided_at: null,
    conflict_reason: null,
    rejection_reason: null,
    summary: 'Tighten the abstract and the results for the camera-ready version.',
  };
}

const changeSets = new Map<string, MockChangeSet[]>([[REVIEW_DOCUMENT_ID, [seededChangeSet()]]]);

/** A change set as the API returns it, compared with the saved document. */
function changeSetResponse(changeSet: MockChangeSet, duplicate = false): Json {
  const doc = store.get(changeSet.document_id);
  const saved = new Map(((doc?.blocks as Json[] | undefined) ?? []).map((block) => [String(block.id), block]));
  const { targets, decisions, ...row } = changeSet;
  return {
    ...row,
    base_head_seq: 2,
    base_content_hash: 'h2',
    base_etag: '"cw:canonical-json-v1:1:2:preview"',
    base_revision_id: 'rev-2',
    proposer_id: 'preview-agent',
    proposer_type: 'agent',
    origin: 'agent',
    depends_on_change_set_id: null,
    run_uuid: 'preview-run',
    tool_call_id: 'call_edit',
    decided_by: changeSet.decided_at ? 'preview' : null,
    accepted_revision_id: null,
    accepted_head_seq: null,
    duplicate,
    operation_targets: targets.map((target) => {
      const block = target ? saved.get(target.block_id) : undefined;
      return target && { ...target, head_fingerprint: block ? mockFingerprint(block) : null };
    }),
    compared_head_seq: doc?.version ?? null,
    operation_decisions: decisions,
  };
}

function changeSetConflict(changeSet: MockChangeSet, reason: string, detail: string, context: Json = {}): Response {
  return new Response(
    JSON.stringify({
      type: 'https://colwrite.com/problems/change_set_conflict',
      title: 'Change Set Conflict',
      status: 409,
      detail,
      code: 'change_set_conflict',
      retryable: false,
      change_set_id: changeSet.change_set_id,
      change_set_status: changeSet.status,
      conflict_reason: reason,
      ...context,
    }),
    { status: 409, headers: { 'content-type': 'application/problem+json' } },
  );
}

/**
 * `POST …/change-sets/{id}/decisions`, with the API's rules: an operation is
 * decided once, repeating a decision is a duplicate, and the last decision
 * takes the set out of `pending` without applying anything.
 */
function decideOperations(changeSet: MockChangeSet, body: Json): Response {
  const invalid = (detail: string) =>
    new Response(
      JSON.stringify({ type: 'about:blank', title: 'Document Validation Failed', status: 422, detail, code: 'document_validation_failed', retryable: false }),
      { status: 422, headers: { 'content-type': 'application/problem+json' } },
    );
  const requested = Array.isArray(body.decisions) ? (body.decisions as Json[]) : [];
  if (requested.length === 0) return invalid('decisions must contain at least one item');
  const seen = new Set<number>();
  for (const item of requested) {
    const index = item?.index;
    if (!Number.isInteger(index) || (index as number) < 0) return invalid('operation index must be a non-negative integer');
    if (item.decision !== 'accepted' && item.decision !== 'rejected') return invalid('decision must be accepted or rejected');
    if (seen.has(index as number)) return invalid(`operation index ${index} is decided twice in one request`);
    if ((index as number) >= changeSet.operations.length) return invalid(`operation index ${index} is outside this change set`);
    seen.add(index as number);
  }

  const recorded = new Map(changeSet.decisions.map((item) => [item.index, item.decision]));
  const contradicted = requested.find(
    (item) => recorded.has(item.index as number) && recorded.get(item.index as number) !== item.decision,
  );
  if (contradicted) {
    return changeSetConflict(changeSet, 'operation_already_decided', 'That operation was already decided differently', {
      operation_index: contradicted.index,
    });
  }
  const fresh = requested.filter((item) => !recorded.has(item.index as number));
  if (fresh.length === 0) return json(changeSetResponse(changeSet, true), { headers: { 'cache-control': 'private, no-store' } });
  if (changeSet.status !== 'pending') {
    return changeSetConflict(changeSet, 'terminal_state', 'Only a pending change set can be decided');
  }

  const decidedAt = new Date().toISOString();
  for (const item of fresh) {
    changeSet.decisions.push({ index: item.index as number, decision: String(item.decision), decided_at: decidedAt, decided_by: 'preview' });
  }
  if (changeSet.decisions.length === changeSet.operations.length) {
    changeSet.status = changeSet.decisions.some((item) => item.decision === 'accepted') ? 'superseded' : 'rejected';
    changeSet.conflict_reason = 'decided_per_operation';
    changeSet.decided_at = decidedAt;
  }
  return json(changeSetResponse(changeSet), { headers: { 'cache-control': 'private, no-store' } });
}

/** Uploaded PDFs, so Research → My PDFs and the file manager have something to show. */
const pdf = (id: number, filename: string, title: string) => ({
  id, filename, title, content_type: 'application/pdf', byte_size: 1_840_000 + id * 1000, checksum_sha256: `sha-${id}`,
  extraction_status: 'ready', extraction_provider: 'jina', extraction_chars: 48_000, extraction_pages: 14, extraction_error: null,
  extracted_at: now, document_id: null, document_name: null, collection_id: null, collection_name: null, created_at: now, updated_at: now,
});
const PDFS = [
  pdf(41, 'switch-transformers.pdf', 'Switch Transformers: Scaling to Trillion Parameter Models'),
  pdf(42, 'st-moe.pdf', 'ST-MoE: Designing Stable and Transferable Sparse Expert Models'),
];

const uploadedImages = new Map<string, { image: ChatImage; file: File }>();
const uploadedPdfs = new Map<number, File>();

/** Stored conversations per document, so the assistant's chat switcher has history. */
type MockChat = { chat_id: string; title: string | null; last_thread_id: number; updated_at: string; messages: Array<{ role: 'user' | 'assistant'; content: string; attachments?: ChatAttachment[] }> };
const chats = new Map<string, MockChat[]>([
  [
    FIXTURE_DOCUMENT_ID,
    [
      {
        chat_id: 'chat-method',
        title: 'Tighten the method section',
        last_thread_id: 2,
        updated_at: '2026-09-20T13:05:00Z',
        messages: [
          { role: 'user', content: 'Tighten the method section without losing the load-balancing detail.' },
          { role: 'assistant', content: 'I shortened the gating paragraph and kept the auxiliary loss definition. The change is waiting in the page for you to review.' },
        ],
      },
      {
        chat_id: 'chat-related',
        title: 'Related work on expert routing',
        last_thread_id: 2,
        updated_at: '2026-09-18T09:40:00Z',
        messages: [
          { role: 'user', content: 'Which routing papers should the related work cite?' },
          { role: 'assistant', content: 'Switch Transformers and ST-MoE are the two closest; both study top-1 routing at scale.' },
        ],
      },
    ],
  ],
]);

/** Keep a turn with its chat, starting one when the request names none. */
function recordTurn(documentId: string, chatId: string | null, message: string, attachments: ChatAttachment[] = []): string {
  const list = chats.get(documentId) ?? [];
  let chat = chatId ? list.find((item) => item.chat_id === chatId) : undefined;
  if (!chat) {
    chat = { chat_id: `chat-preview-${list.length + 1}`, title: null, last_thread_id: 0, updated_at: now, messages: [] };
    list.unshift(chat);
    chats.set(documentId, list);
  }
  chat.messages.push(
    { role: 'user', content: message, attachments },
    { role: 'assistant', content: `Here is what I found about "${message.slice(0, 60)}".` },
  );
  chat.last_thread_id += 2;
  chat.updated_at = new Date().toISOString();
  return chat.chat_id;
}

function head(doc: Json): Json {
  const history = historyOf(doc);
  const current = history.revisions.find((revision) => revision.revision_id === history.pointer);
  return {
    document_id: doc._id,
    head_seq: doc.version,
    revision_no: current?.revision_no ?? doc.version,
    revision_id: history.pointer,
    current_revision_id: history.pointer,
    created_at: '2026-09-18T17:40:00Z',
    updated_at: now,
    deleted_at: null,
    content: contentOf(doc),
  };
}

const PAPERS = [
  { id: '2101.03961', title: 'Switch Transformers: Scaling to Trillion Parameter Models with Simple and Efficient Sparsity', authors: 'William Fedus, Barret Zoph, Noam Shazeer', year: 2021, venue: 'JMLR', cites: 2841, abstract: 'We simplify the MoE routing algorithm and design intuitive improved models with reduced communication and computational costs, training models up to a trillion parameters.' },
  { id: '2202.08906', title: 'ST-MoE: Designing Stable and Transferable Sparse Expert Models', authors: 'Barret Zoph, Irwan Bello, Sameer Kumar, Nan Du', year: 2022, venue: 'arXiv', cites: 512, abstract: 'We design a 269B sparse model with the router z-loss, which resolves training instabilities while keeping quality.' },
  { id: '2006.16668', title: 'GShard: Scaling Giant Models with Conditional Computation and Automatic Sharding', authors: 'Dmitry Lepikhin, HyoukJoong Lee, Yuanzhong Xu', year: 2020, venue: 'ICLR', cites: 1630, abstract: 'GShard enables scaling a multilingual translation Transformer with Sparsely-Gated Mixture-of-Experts beyond 600 billion parameters.' },
  { id: '2112.06905', title: 'GLaM: Efficient Scaling of Language Models with Mixture-of-Experts', authors: 'Nan Du, Yanping Huang, Andrew M. Dai', year: 2022, venue: 'ICML', cites: 690, abstract: 'GLaM uses a sparsely activated mixture-of-experts architecture to scale capacity while incurring substantially less training cost than dense variants.' },
  { id: '2401.04088', title: 'Mixtral of Experts', authors: 'Albert Q. Jiang, Alexandre Sablayrolles, Antoine Roux', year: 2024, venue: 'arXiv', cites: 1450, abstract: 'Mixtral 8x7B is a sparse mixture of experts language model where each layer is composed of 8 feed-forward blocks.' },
];

function semanticScholarSearch(): Json {
  return {
    total: PAPERS.length,
    offset: 0,
    next_offset: null,
    data: PAPERS.map((paper) => ({
      paper_id: `s2-${paper.id}`,
      corpus_id: 1000 + paper.cites,
      external_ids: { ArXiv: paper.id },
      title: paper.title,
      abstract: paper.abstract,
      url: `https://www.semanticscholar.org/paper/s2-${paper.id}`,
      authors: paper.authors.split(', ').map((name, index) => ({ author_id: `a${index}`, name })),
      year: paper.year,
      venue: paper.venue,
      citation_count: paper.cites,
      influential_citation_count: Math.round(paper.cites / 12),
      reference_count: 60,
      is_open_access: true,
      tldr: { model: 'tldr@v2', text: paper.abstract.split('.')[0] + '.' },
      publication_types: ['JournalArticle'],
      fields_of_study: ['Computer Science'],
    })),
  };
}

function s2Paper(paper: (typeof PAPERS)[number]): Json {
  return {
    paper_id: `s2-${paper.id}`,
    corpus_id: 1000 + paper.cites,
    external_ids: { ArXiv: paper.id },
    title: paper.title,
    abstract: paper.abstract,
    url: `https://www.semanticscholar.org/paper/s2-${paper.id}`,
    authors: paper.authors.split(', ').map((name, index) => ({ author_id: `a${index}`, name })),
    year: paper.year,
    venue: paper.venue,
    citation_count: paper.cites,
    influential_citation_count: Math.round(paper.cites / 12),
    reference_count: 60,
    is_open_access: true,
    tldr: { model: 'tldr@v2', text: paper.abstract.split('.')[0] + '.' },
    publication_types: ['JournalArticle'],
    fields_of_study: ['Computer Science'],
  };
}

/** Papers citing (or cited by) the one asked about, with citation contexts. */
function semanticScholarGraph(url: URL): Json {
  const paperId = url.searchParams.get('paper_id') ?? '';
  const direction = url.searchParams.get('direction') === 'references' ? 'references' : 'citations';
  const others = PAPERS.filter((paper) => `s2-${paper.id}` !== paperId);
  const contexts = direction === 'citations'
    ? [
        'Following Switch Transformers, we route each token to a single expert and keep the capacity factor at 1.25.',
        'Top-1 routing (Fedus et al.) reduces communication cost relative to top-2 gating.',
        'We adopt the load-balancing auxiliary loss introduced for sparse expert models.',
        'Sparse expert layers scale parameter count without a matching increase in compute.',
      ]
    : [
        'Mixture-of-experts layers were first shown to scale in machine translation.',
        'Conditional computation activates only part of the network per example.',
        'Expert parallelism shards experts across devices.',
        'Dense Transformers remain the baseline for quality per FLOP.',
      ];
  return {
    paper_id: paperId,
    direction,
    offset: 0,
    next_offset: null,
    data: others.map((paper, index) => ({
      contexts: [contexts[index % contexts.length]],
      intents: index === 0 ? ['methodology'] : index === 1 ? ['background', 'result'] : ['background'],
      is_influential: index < 2,
      paper: s2Paper(paper),
    })),
  };
}

/** A worked "check a claim" answer: a verdict, evidence both ways, limits. */
function claimAssessment(claim: string): Json {
  const [fedus, stmoe, gshard, glam] = PAPERS;
  const finding = (
    paper: (typeof PAPERS)[number],
    id: string,
    stance: 'supports' | 'contradicts' | 'context',
    kind: 'abstract' | 'body' | 'citation_context',
    excerpt: string,
    explanation: string,
    score: number,
  ) => ({
    evidence_id: id,
    stance,
    explanation,
    excerpt,
    kind,
    paper_id: `s2-${paper.id}`,
    corpus_id: 1000 + paper.cites,
    title: paper.title,
    authors: paper.authors,
    year: paper.year,
    url: `https://www.semanticscholar.org/paper/s2-${paper.id}`,
    score,
    license: 'CC BY 4.0',
    open_access_status: 'GREEN',
    disclaimer: null,
    provenance: [{ provider: 'semantic_scholar', endpoint: 'snippet/search', provider_id: `s2-${paper.id}` }],
  });
  return {
    claim,
    verdict: 'mixed',
    confidence: 0.64,
    rationale:
      'Several large-scale studies report that sparse expert models reach dense-model quality at lower training cost, but at least one reports instabilities and quality loss at small scale, so support depends on model size and routing choices.',
    evidence: [
      finding(fedus, 'E1', 'supports', 'abstract', 'We achieve up to 7x increases in pre-training speed with the same computational resources.', 'Reports a large speed-up at equal compute for a sparse model.', 0.91),
      finding(glam, 'E2', 'supports', 'abstract', 'GLaM consumes only 1/3 of the energy used to train GPT-3 while achieving better overall zero-shot performance.', 'Lower training cost at better quality than a dense baseline.', 0.86),
      finding(stmoe, 'E3', 'contradicts', 'body', 'Sparse models are prone to training instabilities, and at smaller scales we observe quality degradation relative to dense baselines.', 'Finds quality loss and instability, weakening the claim at small scale.', 0.72),
      finding(gshard, 'E4', 'context', 'citation_context', 'Conditional computation lets model capacity grow without a proportional increase in computation.', 'Background on why sparse routing can scale sublinearly.', 0.55),
    ],
    limitations: [
      'Only abstracts and open-access snippets were searched.',
      'Results at under 1B parameters are sparse.',
    ],
    provider: 'semantic_scholar',
    disclaimer: 'Automated assessment from literature snippets. Read the papers before relying on it.',
  };
}

function arxivSearch(): unknown[] {
  return PAPERS.map((paper, index) => ({
    id: paper.id,
    title: paper.title,
    authors: paper.authors,
    date: `${paper.year}-01-15`,
    abstract: paper.abstract,
    doi: null,
    score: 0.92 - index * 0.07,
  }));
}

function colpaliSearch(): Json {
  return {
    data: PAPERS.slice(0, 3).map((paper, index) => ({
      page: index + 3,
      id: paper.id,
      doi: null,
      date: `${paper.year}-01-15`,
      title: paper.title,
      authors: paper.authors,
      abstract: paper.abstract,
      url: `https://arxiv.org/abs/${paper.id}`,
      version: 'v1',
      page_image: null,
    })),
  };
}

function overview(): Json {
  const days = Array.from({ length: 30 }, (_, index) => {
    const day = new Date(Date.UTC(2026, 7, 22 + index)).toISOString().slice(0, 10);
    return { day, document_events: (index * 7) % 5, agent_run_events: (index * 3) % 4, resource_events: index % 6 === 0 ? 1 : 0 };
  });
  return {
    identity: { user_id: 'u-preview', username: 'Ada Author', user_type: 'user' },
    profile: {
      user_id: 'u-preview', username: 'Ada Author', display_name: 'Ada Author', headline: 'PhD student, efficient ML', affiliation: 'Example University',
      bio: null, locale: 'en', timezone: 'UTC', avatar_url: null, preferences: {}, last_seen_at: now, created_at: '2026-01-10T10:00:00Z', updated_at: now,
    },
    summary: {
      documents_active: store.size, documents_deleted: 1, first_document_at: '2026-02-01T10:00:00Z', last_document_at: now, document_saves: 412,
      chats_total: 18, chat_messages_total: 240, agent_runs_total: 96, agent_runs_completed: 91, agent_runs_failed: 5, last_agent_run_at: now,
      tokens_input: 1_240_000, tokens_output: 98_000, llm_calls_total: 310, tool_calls_total: 520, tool_calls_failed: 12,
      resources_active: 6, resources_bytes: 48_000_000, last_resource_at: now, resources_extracted: 5, collections_active: 2,
    },
    activity: days,
    tools: [
      { tool_name: 'doc_edit', call_count: 140, error_count: 3, avg_duration_ms: 420, last_used_at: now },
      { tool_name: 'semantic_scholar_search', call_count: 88, error_count: 2, avg_duration_ms: 900, last_used_at: now },
      { tool_name: 'cite_sources', call_count: 41, error_count: 0, avg_duration_ms: 610, last_used_at: now },
    ],
    documents: [...store.values()].map((doc) => ({
      document_id: doc._id, name: doc.name, version: doc.version, created_at: '2026-09-01T10:00:00Z', updated_at: now,
      chat_count: 2, agent_run_count: 5, save_count: 30, resource_count: 1,
    })),
    resources: [],
    collections: [],
  };
}

const json = (body: unknown, init: ResponseInit & { headers?: Record<string, string> } = {}) =>
  new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    headers: { 'content-type': 'application/json', ...(init.headers ?? {}) },
  });

const problem = (status: number, code: string, detail: string) =>
  new Response(JSON.stringify({ type: 'about:blank', title: code, status, code, detail, retryable: false }), {
    status,
    headers: { 'content-type': 'application/problem+json' },
  });

function etag(doc: Json): string {
  return `"cw:canonical-json-v1:1:${doc.version ?? 1}:preview"`;
}

function summary(doc: Json) {
  return {
    _id: doc._id,
    name: doc.name,
    version: doc.version,
    tags: (doc.tags as string[] | undefined) ?? [],
    created_at: '2026-09-01T10:00:00Z',
    updated_at: now,
  };
}

/**
 * A canned Ask AI rewrite (`mode: 'rewrite'`, `ephemeral`): the passage back
 * with a few words changed, so the prompt's diff view has something to show;
 * on an empty line, a short drafted paragraph.
 */
function rewriteReply(message: string): string {
  const passage = message.split('\nPassage:\n')[1]?.trim();
  if (!passage) {
    return 'Sparse expert models decouple capacity from compute: each token visits one expert, so parameters grow while the cost per token stays flat [S1].';
  }
  return passage
    .replace(/\bwe show\b/i, 'we demonstrate')
    .replace(/\bThe router\b/, 'A learned router')
    .replace(/\bwith a learned gate\b/, 'through a gating network')
    .replace(/\bmost promising\b/, 'most credible');
}

/**
 * The edits the preview agent proposes when asked to improve the text: a
 * rewrite, an addition and a deletion, so the review flow (pill, rows,
 * accept/reject) can be seen without a backend.
 */
function proposedEdits(documentId: string): Json {
  return {
    tool: 'doc_edit',
    tool_call_id: 'call_edit',
    document_id: documentId,
    version: 1,
    status: 'proposed',
    actions: [
      {
        op: 'replace_block',
        blockId: 'p-2',
        block: {
          id: 'p-2',
          type: 'paragraph',
          html: 'In this paper, we show that sparse routing lets models scale <strong>sublinearly</strong> in compute while keeping quality. A learned gate assigns each token to one expert.',
          children: [],
        },
      },
      {
        op: 'insert_block_after',
        referenceId: 'li-4',
        block: { id: 'li-5', type: 'paragraph', variant: 'bullet', html: 'A study of routing collapse under long contexts.', children: [] },
      },
      { op: 'delete_block', blockId: 'q-1' },
    ],
  };
}

/** Local engine names, as the server's `status: starting` names them. */
const ENGINE_NAMES: Record<string, string> = { claude: 'Claude Code', codex: 'Codex' };

/** One wire event, and how long the preview waits after sending it. */
type TimedEvent = [event: string, data: Json, pauseMs?: number];

/** Reasoning streamed in small fragments, the way a thinking model sends it. */
function reasoningEvents(text: string): TimedEvent[] {
  return text.split(/(?<= )/).map((piece) => ['reasoning', { content: piece }, 35]);
}

/**
 * A canned assistant turn in the order and shape the API sends it: an engine
 * start for a local CLI, reasoning, a research call (announced with deferred
 * arguments, then its arguments, then its outcome), sources, a drafted edit
 * whose length is reported while it is written, and prose with [S1] markers.
 * Pauses are long enough to see each progress state in the preview.
 */
function agentStream(
  message: string,
  rewrite = false,
  chatId: string | null = 'chat-preview',
  documentId = '',
  engine = 'legacy',
): Response {
  const encoder = new TextEncoder();
  let cancelled = false;
  const events: TimedEvent[] = [];
  if (chatId) events.push(['session.chat', { chat_id: chatId }, 0]);
  if (ENGINE_NAMES[engine]) {
    events.push(['status', { status: 'starting', detail: `Starting ${ENGINE_NAMES[engine]}…` }, 1400]);
    events.push(['status', { status: 'thinking', detail: 'Thinking…' }, 300]);
  }
  events.push(
    ...reasoningEvents(
      rewrite
        ? 'The author wants this passage tightened. Keep the claim and the citation, drop the hedging, and keep the terminology the paper already uses.'
        : 'The author is asking about sparse expert routing. I should check what the literature says about long contexts before answering, then ground each claim in a source.',
    ),
  );
  if (!rewrite) {
    const query = 'sparse mixture of experts long context';
    events.push(
      ['tool_call_start', { tool: 'semantic_scholar_search', tool_call_id: 'call_1', arguments: {}, arguments_preview: '{}', arguments_deferred: true }, 150],
      ['tool_call_args', { tool: 'semantic_scholar_search', tool_call_id: 'call_1', arguments: { query }, arguments_preview: JSON.stringify({ query }) }, 2600],
      ['tool_call_end', { tool: 'semantic_scholar_search', tool_call_id: 'call_1', duration_ms: 2612, is_error: false, error: null, error_type: null, output_preview: '5 papers', output_chars: 4200, output_truncated: false }, 150],
      [
        'sources',
        {
          sources: [
            { id: 'S1', key: '2101.03961', title: 'Switch Transformers', authors: 'William Fedus, Barret Zoph, Noam Shazeer', year: '2021', venue: 'JMLR', url: 'https://arxiv.org/abs/2101.03961', provider: 'semantic_scholar' },
            { id: 'S2', key: '2202.08906', title: 'ST-MoE: Designing Stable and Transferable Sparse Expert Models', authors: 'Barret Zoph, Irwan Bello, Sameer Kumar', year: '2022', venue: 'arXiv', url: 'https://arxiv.org/abs/2202.08906', provider: 'semantic_scholar' },
          ],
        },
        200,
      ],
      ...reasoningEvents('Two strong sources. Switch Transformers covers top-1 routing; ST-MoE covers stability at scale.'),
    );
    if (/\bimprove\b/i.test(message)) {
      events.push(
        ['tool_call_start', { tool: 'doc_edit', tool_call_id: 'call_edit', arguments: {}, arguments_preview: '{}', arguments_deferred: true }, 1000],
        ['tool_call_progress', { tool: 'doc_edit', tool_call_id: 'call_edit', arguments_chars: 640 }, 1000],
        ['tool_call_progress', { tool: 'doc_edit', tool_call_id: 'call_edit', arguments_chars: 1480 }, 1000],
        ['tool_call_progress', { tool: 'doc_edit', tool_call_id: 'call_edit', arguments_chars: 2410 }, 600],
        ['tool_call_args', { tool: 'doc_edit', tool_call_id: 'call_edit', arguments: { content_redacted: true, operation_count: 3, operation_names: ['replace_block', 'insert_block_after', 'delete_block'], block_count: 2 }, arguments_preview: '{"content_redacted": true, "operation_count": 3}' }, 400],
        ['tool_call_end', { tool: 'doc_edit', tool_call_id: 'call_edit', duration_ms: 380, is_error: false, error: null, error_type: null, output_preview: '{"status": "proposed"}', output_chars: 120, output_truncated: false }, 100],
        ['tool_action', proposedEdits(documentId), 300],
      );
    }
  }
  const reply = rewrite
    ? rewriteReply(message)
    : `Here is what I found about "${message.slice(0, 60)}".\n\n` +
    'Top-1 routing keeps per-token compute constant while the parameter count grows [S1]. ' +
    'Router z-loss stabilises training at scale [S2].\n\n' +
    '- **Load balance**: keep the auxiliary coefficient around `1e-2`.\n' +
    '- **Capacity factor**: 1.25 is a good default for training.\n' +
    // Asking about maths or a diagram exercises the chat's KaTeX and Mermaid
    // rendering, including a fence that is drawn only once it has closed.
    (/\b(diagram|mermaid|flowchart|math|maths|equation|latex|formula)\b/i.test(message)
      ? '\nThe balance loss is $\\mathcal{L}_{aux} = \\alpha N \\sum_{i=1}^{N} f_i P_i$, where $f_i$ is the share of tokens sent to expert $i$:\n\n' +
        '$$\nP_i = \\frac{1}{T} \\sum_{x \\in \\mathcal{B}} p_i(x)\n$$\n\n' +
        '```mermaid\nsequenceDiagram\n  participant T as Token\n  participant R as Router\n  participant E as Expert\n  T->>R: hidden state\n  R->>E: top-1 dispatch\n  E-->>T: gated output\n```\n'
      : '');
  return new Response(
    new ReadableStream({
      async start(controller) {
        const send = (event: string, data: Json) =>
          controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
        for (const [event, data, pauseMs = 250] of events) {
          if (cancelled) return;
          send(event, data);
          await new Promise((resolve) => setTimeout(resolve, pauseMs));
        }
        for (const word of reply.split(/(?<= )/)) {
          if (cancelled) return;
          send('token', { content: word });
          await new Promise((resolve) => setTimeout(resolve, 18));
        }
        if (cancelled) return;
        send('done', { chat_id: chatId, thread_id: 1, usage: { prompt_tokens: 5120, completion_tokens: 210 } });
        controller.close();
      },
      cancel() { cancelled = true; },
    }),
    { status: 200, headers: { 'content-type': 'text/event-stream', 'x-request-id': 'run-preview' } },
  );
}

/**
 * `GET /api/agent/engines` as a *local* API answers it: the preview shows the
 * engine choice with Claude Code signed in and Codex waiting for `codex login`.
 * "Check again" on Codex then reports it signed in, as if the author had run
 * the command. A deployed API reports `runtime: "deployed"` and only `legacy`
 * available; see ColWrite-api/docs/agent-engines.md.
 */
const engines: Record<string, Json> = {
  legacy: { engine: 'legacy', name: 'ColWrite model gateway', state: 'ready', available: true, message: 'Magic LLM through the configured model gateway.' },
  claude: {
    engine: 'claude', name: 'Claude Code', state: 'ready', available: true,
    message: 'Signed in to Claude Code with your account.', auth_method: 'claude.ai', plan: 'max',
    version: '2.1.280 (Claude Code)', checked_at: 1790290000,
  },
  codex: {
    engine: 'codex', name: 'Codex', state: 'unauthenticated', available: false,
    message: 'Codex is not signed in. Run `codex login` in your terminal and sign in with your own ChatGPT account, then check again.',
    login_command: 'codex login', version: 'codex-cli 0.156.1', checked_at: 1790290000,
  },
};

async function handle(method: string, path: string, url: URL, init?: RequestInit): Promise<Response> {
  const body = (() => {
    try {
      return typeof init?.body === 'string' ? (JSON.parse(init.body) as Json) : {};
    } catch {
      return {};
    }
  })();
  let match: RegExpMatchArray | null;

  if (path === '/users/profile') {
    return json({ success: true, user_hash: 'preview', username: 'Ada Author', email: 'ada@example.org', user_type: 'user', is_active: true });
  }
  if (path === '/auth/refresh') return json({ success: true });
  if (path === '/users/me/agent-tools') {
    if (method === 'PUT') {
      const tools = agentPreferences.categories.flatMap((category) => category.tools);
      for (const [key, options] of [
        ['sources', agentPreferences.sources], ['tools', tools],
        ['skills', agentPreferences.skills], ['features', agentPreferences.features],
      ] as const) {
        const changes = body[key] as Record<string, unknown> | undefined;
        for (const option of options) {
          if (typeof changes?.[option.id] === 'boolean') option.enabled = changes[option.id] as boolean;
        }
      }
      for (const source of agentPreferences.sources) source.effective_enabled = source.enabled && source.available;
      // Resolve tool dependencies before skills, exactly as the API catalog does.
      for (let pass = 0; pass < tools.length; pass += 1) {
        for (const tool of tools) {
          const dependencies = tool.requires_sources.map((id) => agentPreferences.sources.find((source) => source.id === id)?.effective_enabled === true);
          const sourcesReady = dependencies.length === 0 || (tool.source_policy === 'any' ? dependencies.some(Boolean) : dependencies.every(Boolean));
          tool.effective_enabled = tool.enabled && tool.available && sourcesReady && (tool.requires_tools ?? []).every((id) => tools.find((candidate) => candidate.id === id)?.effective_enabled);
        }
      }
      for (const item of [...agentPreferences.skills, ...agentPreferences.features]) {
        item.effective_enabled = item.enabled && item.available && item.requires_tools.every((id) => tools.find((tool) => tool.id === id)?.effective_enabled);
      }
    }
    return json(agentPreferences);
  }
  if (path === '/document/list') {
    const docs = [...store.values()].map(summary);
    return json({ documents: docs, count: docs.length, page: 1, limit: 10, total_pages: 1, status: 'ok', message: '' });
  }
  if ((match = path.match(/^\/document\/load\/([^/]+)$/))) {
    const doc = store.get(decodeURIComponent(match[1]));
    return doc ? json({ document: doc, status: 'ok', message: '' }) : problem(404, 'DOCUMENT_NOT_FOUND', 'No such document');
  }
  if ((match = path.match(/^\/document\/save\/([^/]+)$/)) && method === 'PUT') {
    const id = decodeURIComponent(match[1]);
    const previous = store.get(id);
    // Saves are optimistically locked on `version`, as in the API: a stale
    // one is a 409 with this wording (ColWrite-api `document_actions.py`).
    const sent = (body.document as Json | undefined)?.version;
    if (previous && typeof sent === 'number' && sent !== previous.version) {
      return new Response(
        JSON.stringify({ detail: `Version conflict: the document was modified elsewhere (sent version ${sent}, server has ${previous.version})` }),
        { status: 409, headers: { 'content-type': 'application/json' } },
      );
    }
    const version = Number(previous?.version ?? 0) + 1;
    // The history is seeded from what was there before this write.
    if (previous) historyOf(previous);
    const saved = { ...(body.document as Json), _id: id, version };
    store.set(id, saved);
    recordRevision(saved);
    return json({ status: 'ok', message: 'saved', version });
  }
  if ((match = path.match(/^\/document\/export\/([^/]+)$/)) && method === 'GET') {
    // `GET /document/export/{id}?format=tex|pdf` renders the *saved* document
    // server-side (ColWrite-api docs/document.md). The preview has no LaTeX
    // renderer, so it answers with a minimal source in the same shape; PDF
    // reports a missing compiler, as an API without one does.
    const doc = store.get(decodeURIComponent(match[1]));
    if (!doc) return new Response(JSON.stringify({ detail: 'Document not found' }), { status: 404, headers: { 'content-type': 'application/json' } });
    const format = url.searchParams.get('format');
    if (format === 'pdf') return new Response(JSON.stringify({ detail: 'PDF export is unavailable' }), { status: 503, headers: { 'content-type': 'application/json' } });
    if (format !== 'tex') return new Response(JSON.stringify({ detail: [{ msg: "Input should be 'tex' or 'pdf'" }] }), { status: 422, headers: { 'content-type': 'application/json' } });
    const name = String(doc.name ?? 'Untitled document');
    const escaped = name.replace(/[\\{}$&#^_%~]/g, (character) => `\\${character}`);
    const source = `\\documentclass{article}\n\\title{${escaped}}\n\\begin{document}\n\\maketitle\n% Dev preview: ColWrite-api renders the full document here.\n\\end{document}\n`;
    return new Response(source, {
      status: 200,
      headers: {
        'content-type': 'application/x-tex',
        'content-disposition': `attachment; filename="document.tex"; filename*=UTF-8''${encodeURIComponent(`${name}.tex`)}`,
        'cache-control': 'private, no-store',
      },
    });
  }
  if (path === '/document/create' && method === 'POST') {
    const id = `66f0c0ffee0000000000${String(store.size + 10).padStart(4, '0')}`;
    store.set(id, { ...(body.document as Json), _id: id, version: 1 });
    return json({ document_id: id, version: 1 });
  }
  if ((match = path.match(/^\/v2\/documents\/([^/]+)\/change-sets$/)) && method === 'GET') {
    const wanted = url.searchParams.get('status');
    const rows = (changeSets.get(decodeURIComponent(match[1])) ?? [])
      .filter((changeSet) => !wanted || changeSet.status === wanted)
      // Newest first, as the API lists them.
      .sort((a, b) => b.proposed_at.localeCompare(a.proposed_at));
    return json({ change_sets: rows.map((changeSet) => changeSetResponse(changeSet)), next_cursor: null });
  }
  if ((match = path.match(/^\/v2\/documents\/([^/]+)\/change-sets\/([^/]+)(?:\/(decisions|reject))?$/))) {
    const changeSet = (changeSets.get(decodeURIComponent(match[1])) ?? []).find(
      (candidate) => candidate.change_set_id === decodeURIComponent(match![2]),
    );
    if (!changeSet) return problem(404, 'change_set_not_found', 'Change set not found');
    if (!match[3] && method === 'GET') return json(changeSetResponse(changeSet));
    if (match[3] === 'decisions' && method === 'POST') return decideOperations(changeSet, body);
    if (match[3] === 'reject' && method === 'POST') {
      // A whole-set reject closes a partly decided set and keeps its record.
      if (changeSet.status === 'pending') {
        changeSet.status = 'rejected';
        changeSet.decided_at = new Date().toISOString();
        changeSet.rejection_reason = typeof body.reason === 'string' ? body.reason : null;
      } else if (changeSet.status !== 'rejected') {
        return changeSetConflict(changeSet, 'terminal_state', 'Change set cannot be rejected in its current state');
      }
      return json(changeSetResponse(changeSet));
    }
  }
  if ((match = path.match(/^\/v2\/documents\/([^/]+)\/revisions$/))) {
    const doc = store.get(decodeURIComponent(match[1]));
    return json({ revisions: doc ? historyOf(doc).revisions : [], next_cursor: null });
  }
  if ((match = path.match(/^\/v2\/documents\/([^/]+)\/revisions\/([^/]+)\/diff$/))) {
    const doc = store.get(decodeURIComponent(match[1]));
    const base = decodeURIComponent(match[2]);
    const against = url.searchParams.get('against') ?? 'current';
    if (!doc) return problem(404, 'DOCUMENT_NOT_FOUND', 'No such document');
    const history = historyOf(doc);
    const target = against === 'current' ? history.pointer : against;
    const seeded = (id: string) => REVISIONS.some((revision) => revision.revision_id === id);
    const from = history.contents.get(base);
    // Against the live document, which may hold a save that is not a revision
    // of this tree yet; between two revisions, what each of them held.
    const to = against === 'current' ? contentOf(doc) : history.contents.get(target);
    if (!from || !to) return problem(404, 'REVISION_NOT_FOUND', 'No such revision');
    return json({
      base_revision_id: base,
      target_revision_id: against === 'current' ? null : against,
      target_head_seq: against === 'current' ? doc.version : null,
      // The seeded revisions keep their written-out changes (a citation's
      // sources among them); anything saved in the preview is compared.
      diff: { changes: seeded(base) && seeded(target) ? revisionChanges(base, target) : blockChanges(from, to) },
    });
  }
  if ((match = path.match(/^\/v2\/documents\/([^/]+)\/revisions\/([^/]+)\/restore$/)) && method === 'POST') {
    // Moves the current-version pointer; no revision is written, and the head
    // sequence still advances (docs/doc_architecture/13-branching-versions.md).
    const id = decodeURIComponent(match[1]);
    const doc = store.get(id);
    const target = decodeURIComponent(match[2]);
    if (!doc) return problem(404, 'DOCUMENT_NOT_FOUND', 'No such document');
    const history = historyOf(doc);
    const content = history.contents.get(target);
    if (!content) return problem(404, 'REVISION_NOT_FOUND', 'No such revision');
    const restored = { ...doc, ...structuredClone(content), _id: id, version: Number(doc.version ?? 1) + 1 };
    store.set(id, restored);
    history.pointer = target;
    return json(head(restored), { headers: { etag: etag(restored) } });
  }
  if ((match = path.match(/^\/v2\/documents\/([^/]+)\/revisions\/([^/]+)$/))) {
    const doc = store.get(decodeURIComponent(match[1]));
    const revisionId = decodeURIComponent(match[2]);
    const history = doc ? historyOf(doc) : null;
    const revision = history?.revisions.find((item) => item.revision_id === revisionId);
    const content = history?.contents.get(revisionId);
    if (!revision || !content) return problem(404, 'REVISION_NOT_FOUND', 'No such revision');
    return json({ ...revision, content });
  }
  if ((match = path.match(/^\/v2\/documents\/([^/]+)$/))) {
    const doc = store.get(decodeURIComponent(match[1]));
    if (!doc) return problem(404, 'DOCUMENT_NOT_FOUND', 'No such document');
    return json(head(doc), { headers: { etag: etag(doc) } });
  }
  if (path === '/research/semantic-scholar/search') return json(semanticScholarSearch());
  if (path === '/research/semantic-scholar/graph') return json(semanticScholarGraph(url));
  if (path === '/research/semantic-scholar/recommendations') {
    return json({ paper_id: url.searchParams.get('paper_id'), data: PAPERS.slice(1, 4).map(s2Paper) });
  }
  if (path === '/research/semantic-scholar/claim-assessment' && method === 'POST') {
    return json(claimAssessment(String(body.claim ?? '')));
  }
  if (path === '/users/me/overview') return json(overview());
  if (path === '/users/me') return json({ identity: overview().identity, profile: overview().profile });
  if (path === '/users/me/documents') return json({ documents: overview().documents, count: store.size });
  if (path === '/users/me/usage') return json(overview().summary);
  if ((match = path.match(/^\/document\/([^/]+)\/chats$/))) {
    const list = (chats.get(decodeURIComponent(match[1])) ?? []).map(({ messages: _messages, ...chat }) => ({
      ...chat,
      document_id: decodeURIComponent(match![1]),
      user_id: null,
      created_at: chat.updated_at,
    }));
    return json({ chats: list, count: list.length, status: 'ok', message: '' });
  }
  if ((match = path.match(/^\/document\/([^/]+)\/chats\/([^/]+)$/))) {
    const list = chats.get(decodeURIComponent(match[1])) ?? [];
    const chatId = decodeURIComponent(match[2]);
    if (method === 'DELETE') chats.set(decodeURIComponent(match[1]), list.filter((chat) => chat.chat_id !== chatId));
    if (method === 'PUT') {
      const chat = list.find((item) => item.chat_id === chatId);
      if (chat) chat.title = String(body.title ?? '') || null;
    }
    return json({ status: 'ok', message: '' });
  }
  if ((match = path.match(/^\/document\/([^/]+)\/chats\/([^/]+)\/threads$/))) {
    const chat = chats.get(decodeURIComponent(match[1]))?.find((item) => item.chat_id === decodeURIComponent(match![2]));
    return json({ threads: [{ id: chat?.last_thread_id ?? 1 }], count: 1, status: 'ok', message: '' });
  }
  if ((match = path.match(/^\/document\/([^/]+)\/chats\/([^/]+)\/messages$/))) {
    const chat = chats.get(decodeURIComponent(match[1]))?.find((item) => item.chat_id === decodeURIComponent(match![2]));
    return json({ messages: chat?.messages ?? [], pivotThreadId: chat?.last_thread_id ?? null, status: 'ok', message: '' });
  }
  if (path === '/agent/engines' && method === 'GET') {
    return json({ runtime: 'local', default_engine: 'legacy', engines: Object.values(engines) });
  }
  if ((match = path.match(/^\/agent\/engines\/([^/]+)\/check$/)) && method === 'POST') {
    const id = decodeURIComponent(match[1]);
    if (!engines[id]) return problem(422, 'VALIDATION_ERROR', `Unknown engine ${id}`);
    if (id === 'codex') {
      engines.codex = {
        engine: 'codex', name: 'Codex', state: 'ready', available: true,
        message: 'Signed in to Codex with your ChatGPT account.', auth_method: 'chatgpt',
        version: 'codex-cli 0.156.1', checked_at: Date.now() / 1000,
      };
    }
    return json(engines[id]);
  }
  if (path === '/agent/chat' && method === 'POST') {
    const message = String(body.message ?? '');
    const attachments: ChatAttachment[] = (Array.isArray(body.attachments) ? body.attachments : []).flatMap<ChatAttachment>((ref) => {
      if (ref.kind === 'image') {
        const stored = uploadedImages.get(ref.image_id);
        return stored ? [{ kind: 'image' as const, image_id: stored.image.id, filename: stored.image.filename,
          media_type: stored.image.media_type, size_bytes: stored.image.size_bytes }] : [];
      }
      const resource = PDFS.find((item) => item.id === ref.resource_id);
      return resource ? [{ kind: 'resource' as const, resource_id: resource.id, filename: resource.filename,
        media_type: resource.content_type, size_bytes: resource.byte_size }] : [];
    });
    // An ephemeral rewrite (Ask AI) keeps no chat; an assistant turn does.
    const chatId = body.ephemeral === true
      ? null
      : recordTurn(String(body.document_id ?? ''), typeof body.chat_id === 'string' ? body.chat_id : null, message, attachments);
    return agentStream(
      message,
      body.mode === 'rewrite' && body.ephemeral === true,
      chatId,
      String(body.document_id ?? ''),
      typeof body.engine === 'string' ? body.engine : 'legacy',
    );
  }
  if (path === '/sources/resolve') {
    const identifier = url.searchParams.get('identifier') ?? '';
    return json({ source: { key: identifier.toLowerCase(), title: 'A resolved paper', authors: 'A. Author', year: '2024', provider: 'crossref' } });
  }
  if (path === '/users/me/resources/search') {
    const term = url.searchParams.get('query') ?? '';
    const matches = PDFS.map((pdf, index) => ({
      resource_id: pdf.id,
      filename: pdf.filename,
      title: pdf.title,
      offset: 1200 + index * 800,
      excerpt: `… the auxiliary ${term} term keeps experts evenly used; without it, a few experts receive most tokens and the rest collapse …`,
    }));
    return json({ query: term, scope: url.searchParams.get('scope') ?? 'library', matches, match_count: matches.length, resources_searched: PDFS.length, resources_skipped: [], truncated: false, next_offset: null });
  }
  if (path === '/users/me/chat-images' && method === 'POST') {
    const file = init?.body instanceof FormData ? init.body.get('file') : null;
    if (!(file instanceof File)) return problem(422, 'INVALID_FILE', 'Choose an image.');
    const image = { id: uid(), filename: file.name, media_type: file.type, size_bytes: file.size };
    uploadedImages.set(image.id, { image, file });
    return json({ image });
  }
  if ((match = path.match(/^\/users\/me\/chat-images\/([^/]+)\/content$/))) {
    const stored = uploadedImages.get(decodeURIComponent(match[1]));
    return stored ? new Response(stored.file, { headers: { 'content-type': stored.image.media_type } })
      : problem(404, 'IMAGE_NOT_FOUND', 'Image unavailable');
  }
  if (path === '/users/me/resources') {
    if (method === 'POST') {
      const file = init?.body instanceof FormData ? init.body.get('file') : null;
      if (!(file instanceof File)) return problem(422, 'INVALID_FILE', 'Choose a PDF.');
      const resource = { ...pdf(Math.max(...PDFS.map((item) => item.id)) + 1, file.name, file.name.replace(/\.pdf$/i, '')), byte_size: file.size };
      PDFS.unshift(resource);
      uploadedPdfs.set(resource.id, file);
      return json({ resource, status: 'success', message: 'Resource stored' });
    }
    const limit = Number(url.searchParams.get('limit') ?? 20);
    const offset = Number(url.searchParams.get('offset') ?? 0);
    const resources = PDFS.slice(offset, offset + limit);
    return json({ resources, count: resources.length, scope: url.searchParams.get('scope') ?? 'library', limit, offset });
  }
  if ((match = path.match(/^\/users\/me\/resources\/(\d+)\/content$/))) {
    const file = uploadedPdfs.get(Number(match[1]));
    return file ? new Response(file, { headers: { 'content-type': 'application/pdf' } })
      : problem(404, 'RESOURCE_NOT_FOUND', 'The preview has metadata only for this sample PDF.');
  }
  if ((match = path.match(/^\/users\/me\/resources\/(\d+)$/))) {
    const pdf = PDFS.find((item) => item.id === Number(match![1]));
    return pdf ? json({ resource: pdf }) : problem(404, 'RESOURCE_NOT_FOUND', 'No such resource');
  }
  if ((match = path.match(/^\/users\/me\/resources\/(\d+)\/markdown$/))) {
    const pdf = PDFS.find((item) => item.id === Number(match![1]));
    const text = `# ${pdf?.title ?? 'Document'}\n\nMixture-of-experts layers route each token to a few experts. The auxiliary load balancing loss term keeps experts evenly used.`;
    return json({ resource: pdf, text, offset: 0, returned_chars: text.length, total_chars: text.length, next_offset: null, truncated: false });
  }
  if (path === '/users/me/collections/tree') {
    return json({ collections: [], count: 0, parent_id: null, limit: 100, offset: 0, next_offset: null });
  }
  if (path === '/users/me/collections') {
    return json({ collections: [], count: 0, limit: 50, offset: 0 });
  }

  console.warn('[dev-preview] unmocked API call', method, path);
  return problem(404, 'NOT_MOCKED', `${method} ${path} is not mocked in the dev preview`);
}

export function installMockApi(): void {
  installMockAssistantSocket({
    documentExists: (id) => store.has(id),
    stream: (request) => handle('POST', '/agent/chat', new URL('/api/agent/chat', window.location.origin), { body: JSON.stringify(request) }),
    enabledFeatures: async () => {
      const response = await handle('GET', '/users/me/agent-tools', new URL('/api/users/me/agent-tools', window.location.origin));
      const catalog = await response.json() as { features?: Array<{ id: string; effective_enabled?: boolean }> };
      return (catalog.features ?? []).filter((feature) => feature.effective_enabled).map((feature) => feature.id);
    },
  });
  const realFetch = window.fetch.bind(window);
  window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const raw = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const url = new URL(raw, window.location.origin);
    // The public arXiv and ColPali search services are external; answer them too.
    if (url.pathname.endsWith('/rag/source/arxiv')) return json(arxivSearch());
    if (url.pathname.endsWith('/rag/colpali/arxiv')) return json(colpaliSearch());
    if (url.origin !== window.location.origin || !url.pathname.startsWith('/api/')) return realFetch(input, init);
    const path = url.pathname.slice('/api'.length);
    const method = (init?.method ?? (input instanceof Request ? input.method : 'GET')).toUpperCase();
    return handle(method, path, url, init);
  };

  // For trying the save-conflict flow by hand. `__colwritePreview.editElsewhere()`
  // in the console changes the open document the way another tab would: the
  // next autosave is refused, and the page asks which version to keep.
  (window as unknown as { __colwritePreview?: unknown }).__colwritePreview = {
    editElsewhere(id: string = new URLSearchParams(window.location.search).get('doc') ?? FIXTURE_DOCUMENT_ID): boolean {
      const doc = store.get(id);
      if (!doc) return false;
      const blocks = [...((doc.blocks as Json[] | undefined) ?? [])];
      const index = blocks.findIndex((block) => block.type === 'paragraph');
      if (index >= 0) {
        blocks[index] = { ...blocks[index], html: `${String(blocks[index].html ?? '')} (Edited in another tab.)` };
      }
      historyOf(doc);
      const edited = { ...doc, blocks, version: Number(doc.version ?? 1) + 1 };
      store.set(id, edited);
      recordRevision(edited, 'Edited in another tab');
      return true;
    },
  };

  try {
    localStorage.setItem('cw_user', JSON.stringify({ name: 'Ada Author', email: 'ada@example.org' }));
    localStorage.setItem('colwrite:lastDocId', FIXTURE_DOCUMENT_ID);
  } catch {
    /* storage blocked: the preview opens signed out */
  }
}
