import { api, unwrap } from '@/api/client';
import { toEditorRecord } from '@/api/content';
import { problemCode } from '@/api/errors';
import type { ClaimCheckResult as WireClaimCheck } from '@/api/schema';
import type { ReferenceRecord } from '@/editor/types';
import type { WorkspaceJob } from './trash';
import { paperFailure } from './papers';

/* ----------------------------------------
   The Research panel's claim check (`ColWrite-api/docs/citations.md#claim-checks`)

   `POST /workspaces/{w}/claims/check` judges one claim against passages,
   outside a conversation: the named papers' passages about it, a named
   paper's abstract where no source holds its text, or with none named,
   passages of papers' text found for it. It answers 202 with a
   `claim_check` job; when the job is `done`, `progress.result.claim` is the
   verdict with the passages it rests on, each with its evidence level, the
   judge's stance and the work's reference record. It advises and acts on
   nothing; every member may ask.
   ---------------------------------------- */

/** Papers one check may name (`MAX_CLAIM_SOURCES`). */
export const MAX_CLAIM_SOURCES = 10;

export type ClaimVerdict = WireClaimCheck['verdict'];
export type ClaimEvidenceLevel = NonNullable<WireClaimCheck['evidence_level']>;
export type ClaimStance = WireClaimCheck['passages'][number]['stance'];

/** A passage the judge read, with its work's reference: what Cite and Add build from. */
export type ClaimCheckPassage = {
  id: string;
  text: string;
  level: ClaimEvidenceLevel;
  stance: ClaimStance;
  record: ReferenceRecord;
  section: string | null;
  page: number | null;
};

/** A finished claim check. */
export type ClaimCheck = {
  claim: string;
  verdict: ClaimVerdict;
  summary: string;
  evidenceLevel: ClaimEvidenceLevel | null;
  /** `insufficient` on abstracts and snippets alone: "Cannot assess without the full text". */
  cannotAssess: boolean;
  note: string | null;
  /** How to get the full text, for a check that could not assess. */
  howToGet: string | null;
  passages: ClaimCheckPassage[];
  /** Sources named that no paper source knew, or held no text of. */
  notFound: string[];
  notes: string[];
};

/** `POST …/claims/check`: one claim, and up to ten papers by identifier with their scheme (`doi:…`, `arxiv:…`). */
export async function checkClaim(workspaceId: string, claim: string, sources: readonly string[] = []): Promise<WorkspaceJob> {
  const { job } = await unwrap(api.POST('/workspaces/{workspace_id}/claims/check', {
    params: { path: { workspace_id: workspaceId } },
    body: { claim, sources: sources.slice(0, MAX_CLAIM_SOURCES) },
  }));
  return job;
}

/** A finished `claim_check` job's verdict, or `null` for a job that carries none. */
export function claimCheckOf(job: WorkspaceJob): ClaimCheck | null {
  const result = job.progress?.result?.claim;
  if (!result) return null;
  return {
    claim: result.claim,
    verdict: result.verdict,
    summary: result.summary,
    evidenceLevel: result.evidence_level,
    cannotAssess: result.cannot_assess,
    note: result.note,
    howToGet: result.how_to_get,
    passages: result.passages.map((passage) => ({
      id: passage.id,
      text: passage.text,
      level: passage.level,
      stance: passage.stance,
      record: toEditorRecord(passage.record),
      section: passage.section ?? null,
      page: passage.page ?? null,
    })),
    notFound: result.not_found,
    notes: result.notes,
  };
}

/** Why a claim check could not run, for the author. */
export function claimFailure(error: unknown): string {
  switch (problemCode(error)) {
    case 'claim_check_failed':
      return 'The claim could not be judged just now. Try again in a moment.';
    case 'unrecognized_identifier':
      return 'Name each paper by an identifier with its scheme, such as doi:10.… or arxiv:2101.00001.';
    default:
      return paperFailure(error, 'The claim could not be checked. Try again.');
  }
}
