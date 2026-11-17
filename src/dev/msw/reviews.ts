/** Scripted review findings, stored beside the page as the API stores them.
 * This is a UI fixture, not a claim-support classifier or model evaluation.
 */
import { uid } from '@/lib/uid';
import { htmlToText } from '@/editor/blockKinds';
import type { DocumentComment, ReviewSummary } from '@/api/schema';
import { FIXTURE_DOCUMENT_ID, PERSONAL_WORKSPACE_ID, fixtures, wireBlock, type StoredDocument } from './fixtures';

type Kind = ReviewSummary['review'];
const LABELS: Record<Kind, string> = {
  proofread: 'Proofread', claims: 'Claims and evidence', sources: 'Sources',
  structure: 'Structure and guideline', peer_review: 'Peer review',
};
export const REVIEW_MANUSCRIPT_ID = '66f0c0ffee0000000000d0c6';

/** Opt-in manuscript with known faults; default preview/test inventories stay small. */
export function seedReviewFixture(workspaceId = PERSONAL_WORKSPACE_ID) {
  const base = fixtures.documents.get(FIXTURE_DOCUMENT_ID);
  if (!base) throw new Error('The review fixture needs the main manuscript.');
  const source = base.sources?.find((record) => record.flags.includes('retracted'));
  if (!source) throw new Error('The review fixture needs the registered retracted work.');
  const doc: StoredDocument = {
    ...structuredClone(base), _id: REVIEW_MANUSCRIPT_ID, workspace_id: workspaceId, name: 'Manuscript review — seeded faults',
    collection_id: null, sort_key: 'z', head_seq: 1, sources: [source],
    blocks: [
      wireBlock({ id: 'review-abstract', type: 'heading', level: 1, html: 'Abstract' }),
      wireBlock({ id: 'review-a', type: 'paragraph', html: 'Accuracy reached 90%.', children: [] }),
      wireBlock({ id: 'review-results', type: 'heading', level: 1, html: 'Results' }),
      wireBlock({ id: 'review-claim', type: 'paragraph', html: 'Our method always works in every setting<span data-child-id="review-cite"></span>.',
        children: [{ id: 'review-cite', type: 'citation', keys: [source.key], sources: [source] }] }),
      wireBlock({ id: 'review-numbers', type: 'paragraph', html: 'Accuracy reached 80%. Improvement occurred in 40 of 50 (90%) participants.', children: [] }),
    ],
  };
  fixtures.documents.set(doc._id, doc);
  return doc;
}
export const mockAnchorText = (block: StoredDocument['blocks'][number]) =>
  ('html' in block ? htmlToText(String(block.html)) : 'text' in block ? String(block.text) : '').replace(/\s+/g, ' ').trim();

export function beginReview(documentId: string, runId: string, review: Kind, sessionId: string | null, afterSeq: number | null) {
  const record: ReviewSummary = {
    run_id: runId, document_id: documentId, review, label: LABELS[review], status: 'running',
    created_by: 'u-preview', created_at: new Date().toISOString(), ended_at: null,
    checks: [
      ...(['claims', 'sources', 'peer_review'].includes(review) ? ['reference_status', 'orphan_citations'] : []),
      ...(['proofread', 'claims', 'peer_review'].includes(review) ? ['percentages'] : []),
    ], notes: [],
    counts: { total: 0, by_kind: {}, by_severity: {} }, session_id: sessionId, after_seq: afterSeq,
  };
  fixtures.reviewRuns.set(documentId, [record, ...(fixtures.reviewRuns.get(documentId) ?? [])]);
  return record;
}

export function finishReview(documentId: string, runId: string, status: 'completed' | 'failed' | 'stopped') {
  const run = fixtures.reviewRuns.get(documentId)?.find((item) => item.run_id === runId);
  if (!run || run.status !== 'running') return;
  run.status = status;
  run.ended_at = new Date().toISOString();
  const comments = fixtures.comments.get(documentId)?.filter((item) => item.run_id === runId) ?? [];
  run.counts = { total: comments.length, by_kind: {}, by_severity: {} };
  for (const comment of comments) {
    run.counts.by_kind[comment.kind] = (run.counts.by_kind[comment.kind] ?? 0) + 1;
    run.counts.by_severity[comment.severity] = (run.counts.by_severity[comment.severity] ?? 0) + 1;
  }
}

function citationQuote(html: string, id: string) {
  const marked = html.replace(/<span[^>]*data-child-id="([^"]*)"[^>]*><\/span>/g, (_span, childId: string) => childId === id ? '\u0001' : '');
  const plain = htmlToText(marked).replace(/\s+/g, ' ').trim();
  const at = plain.indexOf('\u0001');
  const start = plain.lastIndexOf('. ', at) + 2;
  const end = plain.indexOf('.', at);
  return plain.slice(start < 2 ? 0 : start, end < 0 ? undefined : end + 1).replace('\u0001', '').trim().slice(0, 300);
}

export function scriptedReviewFindings(doc: StoredDocument, run: ReviewSummary): DocumentComment[] {
  const findings: DocumentComment[] = [];
  const add = (blockId: string, quote: string, kind: DocumentComment['kind'], body: string, check: string | null) => {
    if (!quote || findings.some((item) => item.block_id === blockId && item.quote === quote && item.kind === kind)) return;
    findings.push({
      comment_id: uid(), document_id: doc._id, block_id: blockId, quote, kind,
      severity: kind === 'source' || kind === 'claim' ? 'must_fix' : 'should_fix',
      body, sources: [], suggestion: null, status: 'open', origin: check ? 'check' : 'assistant',
      check, run_id: run.run_id, review: run.review, created_by: 'u-preview', decided_by: null,
      created_at: new Date().toISOString(), decided_at: null, outdated: false,
    });
  };
  const sourceReview = ['claims', 'sources', 'peer_review'].includes(run.review);
  for (const block of doc.blocks) {
    if (block.aiHidden) continue;
    const plain = mockAnchorText(block);
    if (sourceReview && block.type === 'paragraph') for (const child of block.children ?? []) {
      if (child.type !== 'citation') continue;
      for (const key of child.keys) {
        const source = doc.sources?.find((item) => item.key === key);
        if (!source) add(block.id, citationQuote(block.html, child.id), 'source', `The citation ${key} has no record in this page’s sources.`, 'orphan_citations');
        else if (source.flags.includes('retracted')) {
          add(block.id, citationQuote(block.html, child.id), 'source', `The stored record marks “${source.csl.title}” as retracted. Check its notice and whether this claim can rely on it.`, 'reference_status');
        }
      }
    }
    if (['proofread', 'claims', 'peer_review'].includes(run.review)) {
      const match = /(\d+)\s+of\s+(\d+)\s*\((\d+(?:\.\d+)?)%\)/.exec(plain);
      if (match && Number(match[2]) > 0 && Math.abs(100 * Number(match[1]) / Number(match[2]) - Number(match[3])) > 0.51) {
        add(block.id, match[0], 'consistency', `The counts give about ${(100 * Number(match[1]) / Number(match[2])).toFixed(2)}%, not ${match[3]}%. Check which value is authoritative.`, 'percentages');
      }
    }
    if (['claims', 'peer_review'].includes(run.review) && /\balways\b/.test(plain)) {
      const quote = plain.split(/(?<=[.!?])\s+/).find((sentence) => /\balways\b/.test(sentence))?.slice(0, 300) ?? '';
      add(block.id, quote, 'claim', 'The universal claim goes beyond the conditions reported here. Restrict it to the evaluation or supply evidence for the generalization.', null);
    }
    if (run.review === 'proofread' && /\bvery\b/.test(plain)) {
      add(block.id, plain.slice(0, 300), 'language', 'Consider removing the unnecessary intensifier so the statement is more precise.', null);
    }
  }
  const existing = fixtures.comments.get(doc._id) ?? [];
  const fresh = findings.filter((item) => !existing.some((other) =>
    other.status === 'open' && other.block_id === item.block_id && other.quote === item.quote && other.kind === item.kind && other.body === item.body));
  fixtures.comments.set(doc._id, [...fresh, ...existing]);
  run.counts = {
    total: fresh.length,
    by_kind: Object.fromEntries([...new Set(fresh.map((item) => item.kind))].map((kind) => [kind, fresh.filter((item) => item.kind === kind).length])),
    by_severity: Object.fromEntries([...new Set(fresh.map((item) => item.severity))].map((severity) => [severity, fresh.filter((item) => item.severity === severity).length])),
  };
  return fresh;
}
