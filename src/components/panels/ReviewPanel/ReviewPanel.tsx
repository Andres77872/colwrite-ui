import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useInfiniteQuery, useQueryClient } from '@tanstack/react-query';
import { ChevronDown, ChevronUp } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useDocumentActions, useDocumentId, useEditorDoc } from '@/editor';
import { useProposals } from '@/editor/proposalsContextState';
import { useWorkspaceId } from '@/components/workspace/workspaceContextState';
import { useWorkspaceAccess } from '@/components/workspace/workspaceAccess';
import { useAgentRun } from '@/components/editor/AgentRun';
import { AgentStatusLine } from '@/components/editor/AgentProgress';
import { useReviewComments } from '@/components/editor/ReviewComments/reviewCommentsContext';
import { commentIsOutdated } from '@/components/editor/ReviewComments/quote';
import { COMMENT_KINDS, COMMENT_SEVERITIES, REVIEW_LABELS, reviewKeys, reviewRunsQuery, type ReviewComment, type ReviewKind, type ReviewRun } from '@/data/reviews';
import type { ResumeAgentRun } from '@/api/assistant/agentSessionChat';
import { itemAt } from '@/lib/itemAt';
import { usePanels } from '../panelsContextState';
import { useReviewAdmission } from './reviewAdmission';
import { uid } from '@/lib/uid';

export function ReviewPanel() {
  const documentId = useDocumentId();
  const { activePanel, isOpen } = usePanels();
  // Other tabs may stay mounted when hidden. A review deliberately detaches:
  // its summary locator reattaches on return, without admitting another run.
  return activePanel === 'review' && isOpen ? <ReviewPage key={documentId ?? 'draft'} /> : null;
}

function ReviewPage() {
  const workspaceId = useWorkspaceId();
  const documentId = useDocumentId();
  const { blocks } = useEditorDoc();
  const documentActions = useDocumentActions();
  const { canEdit } = useWorkspaceAccess();
  const comments = useReviewComments();
  const { receive, sets, focusChange } = useProposals();
  const client = useQueryClient();
  const { admission, remember, forget, forgetRefused } = useReviewAdmission(workspaceId, documentId ?? '');
  const { start, isRunning, running: driverRunning, progress, stop } = useAgentRun({
    surface: 'review',
    document: { documentId, ...documentActions, readOnly: !canEdit },
  });
  const query = useInfiniteQuery({
    ...reviewRunsQuery(workspaceId, documentId ?? ''), enabled: Boolean(documentId),
    refetchOnMount: 'always',
    ...(driverRunning || admission ? { refetchInterval: 1_000 } : {}),
  });
  const runs = useMemo(() => query.data?.pages.flatMap((page) => page.items) ?? [], [query.data]);
  const [kind, setKind] = useState<ReviewKind>('proofread');
  const [status, setStatus] = useState<ReviewComment['status']>('open');
  const [runFilter, setRunFilter] = useState('');
  const [error, setError] = useState<string | null>(null);
  const following = useRef<string | null>(null);
  const showSuggestion = useRef<ReviewComment['suggestion']>(null);
  useEffect(() => () => {
    // StrictMode replays mount effects after the driver's cleanup detaches.
    // Its replay must observe again, not keep a marker for the dead observer.
    following.current = null;
  }, []);

  const refresh = useCallback(() => {
    if (documentId) void client.invalidateQueries({ queryKey: reviewKeys.page(workspaceId, documentId) });
  }, [client, documentId, workspaceId]);
  const follow = useCallback(async (review: ReviewKind, resume?: ResumeAgentRun) => {
    setError(null);
    const attemptId = uid();
    let locator = resume;
    let terminalObserved = false;
    const result = await start({
      request: { message: '', review, effort: 'standard', web: false },
      resume,
      handlers: {
        onComments: refresh,
        onToolAction: (action) => { receive(action); refresh(); },
        onDone: () => { terminalObserved = true; },
        onError: () => { terminalObserved = true; },
      },
      onRunStarted: (run) => {
        locator = { ...locator, ...run };
        following.current = run.runId ?? run.requestId ?? run.sessionId;
        remember(review, run, attemptId);
        refresh();
      },
      onAdmissionRefused: (run) => forgetRefused(run, attemptId),
    });
    // Admission can fail before the review notebook creates a summary.
    // A confirmed terminal stream is also proof that this run has ended;
    // a detach or a connection failure is not, and must retain its locator.
    if (result.status !== 'stopped' && terminalObserved && locator?.runId) forget(locator.runId);
    if (result.status === 'failed' && result.code !== 'AGENT_CANCELLED') setError(result.error.message);
    refresh();
  }, [start, receive, refresh, remember, forget, forgetRefused]);

  // Reattachment observes the admitted run, from its own starting sequence.
  // Shared summaries expose this locator to the run's author only.
  useEffect(() => {
    const recorded = admission?.locator.runId
      ? runs.find((run) => run.run_id === admission.locator.runId) : undefined;
    if (recorded && recorded.status !== 'running') {
      if (!isRunning()) forget(recorded.run_id);
      return;
    }
    const active = runs.find((run) => run.status === 'running' && run.session_id !== null);
    const recovery: { review: ReviewKind; locator: ResumeAgentRun } | null = admission ?? (active?.session_id ? {
      review: active.review, locator: { sessionId: active.session_id, runId: active.run_id, afterSeq: active.after_seq ?? 0 },
    } : null);
    const key = recovery && (recovery.locator.runId ?? recovery.locator.requestId ?? recovery.locator.sessionId);
    if (recovery && !isRunning() && following.current !== key) {
      following.current = key;
      void follow(recovery.review, recovery.locator);
    }
  }, [admission, runs, isRunning, driverRunning, follow, forget]);

  const listed = useMemo(() => {
    const order = new Map(blocks.map((block, index) => [block.id, index]));
    return (comments?.comments ?? [])
      .filter((comment) => comment.status === status && (!runFilter || comment.run_id === runFilter))
      .sort((a, b) => (order.get(a.block_id) ?? Infinity) - (order.get(b.block_id) ?? Infinity) || a.comment_id.localeCompare(b.comment_id));
  }, [blocks, comments?.comments, runFilter, status]);
  const current = listed.findIndex((comment) => comment.comment_id === comments?.focusedId);
  const step = useCallback((direction: number) => {
    if (!listed.length || !comments) return;
    const index = current < 0 ? (direction > 0 ? 0 : listed.length - 1) : (current + direction + listed.length) % listed.length;
    comments.focus(itemAt(listed, index));
  }, [comments, current, listed]);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (!event.altKey || event.ctrlKey || event.metaKey || event.shiftKey || !['ArrowUp', 'ArrowDown'].includes(event.key)) return;
      const target = event.target;
      if (target instanceof HTMLElement && (target.isContentEditable || target.closest('input, textarea, select'))) return;
      if (!listed.length) return;
      event.preventDefault();
      step(event.key === 'ArrowUp' ? -1 : 1);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [listed.length, step]);
  useEffect(() => {
    const target = showSuggestion.current;
    if (!target) return;
    const change = sets.find((set) => set.changeSetId === target.change_set_id)
      ?.changes.find((item) => item.opIndex === target.operation_index);
    if (change) { showSuggestion.current = null; focusChange(change.id); }
  }, [sets, focusChange]);

  const openSuggestion = (comment: ReviewComment) => {
    if (!comment.suggestion || !documentId) return;
    showSuggestion.current = comment.suggestion;
    const change = sets.find((set) => set.changeSetId === comment.suggestion?.change_set_id)
      ?.changes.find((item) => item.opIndex === comment.suggestion?.operation_index);
    if (change) { showSuggestion.current = null; focusChange(change.id); return; }
    receive({
      tool: 'doc_comment', toolCallId: '', documentId, actions: [], status: 'proposed',
      changeSetId: comment.suggestion.change_set_id, applyPolicy: 'review',
    });
  };
  const running = driverRunning || Boolean(admission) || runs.some((run) => run.status === 'running');
  // A cached empty list is not evidence that the detached review ended.
  // Do not admit new work until this mount has a successful, settled read.
  const checkingReviews = query.isPending || query.isFetching || !query.isFetchedAfterMount;
  const canStart = !running && !checkingReviews && !query.isError && Boolean(documentId);
  if (!comments) return null;
  return (
    <section className="flex h-full flex-col overflow-y-auto p-3 text-sm" aria-label="Review">
      <h2 className="mb-1 font-medium">Review this page</h2>
      <p className="mb-3 text-xs text-muted-foreground">Shared comments, not changes to the page. Reviews give no score.</p>
      <div className="flex items-center gap-2">
        <select aria-label="Review type" value={kind} disabled={running} onChange={(event) => {
          const value = event.target.value;
          if (Object.hasOwn(REVIEW_LABELS, value)) setKind(value as ReviewKind);
        }} className="min-w-0 flex-1 rounded-md border border-border bg-surface px-2 py-1.5 text-sm">
          {Object.entries(REVIEW_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select>
        <Button size="sm" disabled={!canStart} onClick={() => void follow(kind)}>Run a review</Button>
      </div>
      {!documentId && <p className="mt-2 text-xs text-muted-foreground">Save this page before running a review.</p>}
      {running && <div className="mt-2 flex items-center gap-2">
        {progress ? <AgentStatusLine progress={progress} /> : <p role="status" className="text-xs text-muted-foreground">A review is running…</p>}
        {driverRunning && <Button size="sm" variant="ghost" onClick={() => {
          // Cancellation can precede notebook preparation, leaving no summary.
          // Observe its terminal acknowledgement rather than waiting forever
          // for a summary that could never have been created.
          following.current = null;
          stop();
          refresh();
        }}>Stop review</Button>}
      </div>}
      {error && <p role="alert" className="mt-2 text-xs text-destructive">{error}</p>}
      {!running && checkingReviews && documentId && <p role="status" className="mt-2 text-xs text-muted-foreground">Checking for a running review…</p>}
      {query.isError && <div className="mt-2 text-xs">
        <p role="alert" className="text-destructive">Past reviews could not be loaded. Check them before starting another review.</p>
        <Button size="sm" variant="ghost" onClick={() => void query.refetch()}>Retry loading reviews</Button>
      </div>}
      {admission && error && !driverRunning && <Button size="sm" variant="ghost" className="mt-2 self-start"
        onClick={() => void follow(admission.review, admission.locator)}>Reconnect review</Button>}
      {runs.length > 0 && <div className="mt-4 space-y-2" aria-label="Past reviews">
        {runs.map((run) => <ReviewSummaryRow key={run.run_id} run={run} onSelect={() => { setRunFilter(run.run_id); setStatus('open'); }} />)}
        {query.hasNextPage && <Button size="sm" variant="ghost" disabled={query.isFetchingNextPage} onClick={() => void query.fetchNextPage()}>More reviews</Button>}
      </div>}
      <div className="mt-4 flex flex-wrap items-center gap-2">
        <h3 className="mr-auto font-medium">Comments</h3>
        <select aria-label="Comment status" value={status} onChange={(event) => {
          if (['open', 'resolved', 'dismissed'].includes(event.target.value)) setStatus(event.target.value as ReviewComment['status']);
        }} className="rounded-md border border-border bg-surface px-2 py-1 text-xs">
          <option value="open">Open</option><option value="resolved">Resolved</option><option value="dismissed">Dismissed</option>
        </select>
        <Button size="icon-xs" variant="icon" aria-label="Previous comment" title="Previous comment (Alt+↑)" disabled={!listed.length} onClick={() => step(-1)}><ChevronUp /></Button>
        <span className="text-xs tabular-nums text-muted-foreground" aria-live="polite">{current >= 0 ? current + 1 : '–'} of {listed.length}</span>
        <Button size="icon-xs" variant="icon" aria-label="Next comment" title="Next comment (Alt+↓)" disabled={!listed.length} onClick={() => step(1)}><ChevronDown /></Button>
      </div>
      {runFilter && <Button variant="ghost" size="sm" className="mt-1 self-start" onClick={() => setRunFilter('')}>Show all reviews’ comments</Button>}
      {!canEdit && <p className="mt-2 text-xs text-muted-foreground">Viewers can run reviews and read comments, but cannot resolve or dismiss them.</p>}
      {comments.loading && documentId && <p role="status" className="mt-3 text-xs text-muted-foreground">Loading comments…</p>}
      {comments.error && <p role="alert" className="mt-3 text-xs text-destructive">Comments could not be loaded.</p>}
      {comments.decisionError && <p role="alert" className="mt-2 text-xs text-destructive">{comments.decisionError}</p>}
      {!comments.loading && !comments.error && !listed.length && <p className="mt-3 text-xs text-muted-foreground">No {status} comments in the reviews shown.</p>}
      <div className="mt-3 space-y-4">
        {Object.entries(COMMENT_KINDS).map(([group, label]) => {
          const entries = listed.filter((comment) => comment.kind === group);
          return entries.length > 0 && <section key={group} aria-label={label}>
            <h4 className="mb-2 text-xs font-medium text-muted-foreground">{label} ({entries.length})</h4>
            <ul className="space-y-2">{entries.map((comment) => <li key={comment.comment_id} data-comment-id={comment.comment_id}
              className={`rounded-md border p-2 ${comments.focusedId === comment.comment_id ? 'border-primary' : 'border-border'}`}>
              <div className="mb-1 flex gap-2 text-xs text-muted-foreground">
                <span>{COMMENT_SEVERITIES[comment.severity]}</span>
                {commentIsOutdated(comment, blocks) && <span>Outdated · quote no longer present</span>}
              </div>
              <button type="button" className="w-full border-l-2 border-border pl-2 text-left text-xs italic" onClick={() => comments.focus(comment)}>{comment.quote}</button>
              <p className="mt-2 whitespace-pre-wrap text-sm">{comment.body}</p>
              {comment.sources.length > 0 && <p className="mt-2 text-xs text-muted-foreground">Recorded sources: {comment.sources.map((source) => source.title).join('; ')}. A source is not proof of support.</p>}
              <div className="mt-2 flex flex-wrap gap-1">
                {comment.status === 'open' ? <>
                  <Button size="sm" variant="ghost" disabled={!canEdit || comments.deciding === comment.comment_id} onClick={() => comments.decide(comment, 'resolved')}>Resolve</Button>
                  <Button size="sm" variant="ghost" disabled={!canEdit || comments.deciding === comment.comment_id} onClick={() => comments.decide(comment, 'dismissed')}>Dismiss</Button>
                </> : <Button size="sm" variant="ghost" disabled={!canEdit || comments.deciding === comment.comment_id} onClick={() => comments.decide(comment, 'open')}>Reopen</Button>}
                {comment.suggestion && <Button size="sm" variant="ghost" onClick={() => openSuggestion(comment)}>Show suggested edit</Button>}
              </div>
            </li>)}</ul>
          </section>;
        })}
      </div>
      {comments.hasMore && <Button size="sm" variant="ghost" className="mt-3" disabled={comments.loadingMore} onClick={comments.loadMore}>More comments</Button>}
    </section>
  );
}

function ReviewSummaryRow({ run, onSelect }: { run: ReviewRun; onSelect: () => void }) {
  const counts = Object.entries(COMMENT_KINDS).flatMap(([kind, label]) => {
    const count = run.counts.by_kind[kind as ReviewComment['kind']];
    return count ? [`${label}: ${count}`] : [];
  }).join(' · ');
  return <div className="rounded-md border border-border p-2 text-xs">
    <button type="button" className="text-left font-medium" onClick={onSelect}>{run.label} · {run.status}</button>
    <p className="mt-1 text-muted-foreground">{run.counts.total} {run.counts.total === 1 ? 'comment' : 'comments'}{counts && ` · ${counts}`}</p>
    {run.checks.length > 0 && <p className="mt-1 text-muted-foreground">Deterministic checks: {run.checks.map((check) => check.replaceAll('_', ' ')).join(', ')}.</p>}
    {run.notes.map((note, index) => <p key={index} className="mt-1 text-muted-foreground">{note}</p>)}
  </div>;
}
