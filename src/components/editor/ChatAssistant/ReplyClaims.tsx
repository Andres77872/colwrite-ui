import type { AgentClaim, AgentSource } from '@/api/assistant/streamParser';
import { ClaimCard } from '@/components/panels/shared/ClaimCard';

/** `S3.2` is the second passage of `S3`. */
const handleOf = (passageId: string) => passageId.slice(0, passageId.indexOf('.'));

/**
 * A reply's claim checks (`claim`, kept in its record as `claims`): each a
 * claim card whose passages are read against the conversation's sources by
 * handle, so Cite and Add build from the work's record. The claim's words
 * and the passages' text are not sent; a passage whose source never arrived
 * says so.
 */
export function ReplyClaims({ claims, sources }: { claims: readonly AgentClaim[]; sources: readonly AgentSource[] }) {
  if (claims.length === 0) return null;
  const byHandle = new Map(sources.map((source) => [source.handle, source.record]));
  return (
    <div className="space-y-2">
      {claims.map((claim) => (
        <ClaimCard
          key={claim.toolCallId}
          verdict={claim.verdict}
          evidenceLevel={claim.evidenceLevel}
          cannotAssess={claim.cannotAssess}
          passages={claim.passages.map((passage) => ({ ...passage, record: byHandle.get(handleOf(passage.id)) ?? null }))}
        />
      ))}
    </div>
  );
}
