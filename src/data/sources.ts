import { api, unwrap } from '@/api/client';
import { toEditorRecord } from '@/api/content';
import { problemBody, problemCode } from '@/api/errors';
import type { ReferenceRecord } from '@/editor/types';

/** Why an identifier could not be resolved, in the author's terms. */
export function resolveFailure(error: unknown): string {
  switch (problemCode(error)) {
    case 'unrecognized_identifier':
      return 'That is not a DOI, an arXiv id, a PMID or a paper source’s id.';
    case 'source_not_found':
      return 'No registry has a record for that identifier. Check it for typos.';
    case 'source_mismatch': {
      const body = problemBody(error);
      const found = body?.found_title;
      return found
        ? `That identifier is “${found}”${body?.claimed_title ? `, not “${body.claimed_title}”` : ''}. Check which work you meant.`
        : 'That identifier names a different work. Check which work you meant.';
    }
    case 'resolver_unavailable':
      return 'The registry could not be reached. Try again in a moment.';
    case 'paper_source_unavailable':
      return 'No paper source that reads that identifier is available on this server.';
    // Every registry is an outside scholarly service, which the workspace's policy closed.
    case 'workspace_policy':
      return 'Outside research is switched off in this workspace, so identifiers cannot be looked up here. Add the source by hand.';
    default:
      // `paper_source_disabled` says which source to turn on.
      return error instanceof Error && error.message ? error.message : 'The source could not be resolved.';
  }
}

/** What the work is believed to be, which the resolved record is matched against. */
export type ClaimedWork = { title?: string; firstAuthor?: string; year?: number };

/** A checked reference: the record, the other keys it is known by, and what the pipeline noted. */
export type ResolvedSource = { record: ReferenceRecord; aliases: string[]; notes: string[] };

/**
 * Resolve an identifier into a checked reference, through the workspace
 * (`GET /workspaces/{w}/sources/resolve`, `ColWrite-api/docs/citations.md#resolving-an-identifier`).
 *
 * The record comes from the registry that owns the identifier, is matched
 * against the claimed work when one is given, corroborated in a second
 * source and carries its status (retracted, a published version). Every
 * registry is an outside scholarly service, so a workspace whose policy
 * turned outside research off refuses every lookup. Rejects with an
 * `ApiError` whose `code` says why: `unrecognized_identifier`,
 * `source_not_found`, `source_mismatch` (with `claimed_title` and
 * `found_title`), `workspace_policy`, `paper_source_disabled`,
 * `paper_source_unavailable` or `resolver_unavailable`.
 */
export async function resolveSource(
  workspaceId: string,
  identifier: string,
  claimed: ClaimedWork = {},
  init?: { signal?: AbortSignal },
): Promise<ResolvedSource> {
  const response = await unwrap(api.GET('/workspaces/{workspace_id}/sources/resolve', {
    params: {
      path: { workspace_id: workspaceId },
      query: {
        identifier: identifier.trim(),
        ...(claimed.title ? { title: claimed.title } : {}),
        ...(claimed.firstAuthor ? { first_author: claimed.firstAuthor } : {}),
        ...(claimed.year ? { year: claimed.year } : {}),
      },
    },
    signal: init?.signal,
  }));
  return { record: toEditorRecord(response.source), aliases: response.aliases, notes: response.notes };
}
