import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowDown, ArrowUp, Plus, X } from 'lucide-react';
import type { AgentPlan } from '@/api/assistant/streamParser';
import type { PlanEdit } from '@/api/schema';
import { errorMessage, problemCode } from '@/api/errors';
import { chatPlanQuery, updateChatPlan, type PlanLocation } from '@/data/chatPlans';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { uid } from '@/lib/uid';
import { itemAt } from '@/lib/itemAt';
import { PLAN_STATUS, SECTION_STATUS, planChanges } from './planState';

type DraftSection = { key: string; id: string | null; title: string; goal: string; sources: string[] };
type Draft = { base: AgentPlan; brief: string; sections: DraftSection[]; questions: string };
export type StartPlan = (plan: AgentPlan, edit: PlanEdit) => void;

function draftOf(plan: AgentPlan): Draft {
  return {
    base: plan, brief: plan.brief, questions: plan.open_questions.join('\n'),
    sections: plan.sections.map((section) => ({
      key: section.id, id: section.id, title: section.title, goal: section.goal ?? '', sources: [...section.sources],
    })),
  };
}

function contentOf(draft: Draft): string {
  return JSON.stringify({
    brief: draft.brief, questions: draft.questions,
    sections: draft.sections.map(({ key: _key, ...section }) => section),
  });
}

function editOf(draft: Draft): PlanEdit {
  return {
    revision: draft.base.revision, brief: draft.brief,
    sections: draft.sections.map(({ key: _key, ...section }) => section),
    open_questions: draft.questions.split('\n').map((text) => text.trim()).filter(Boolean),
  };
}

/** An admitted start can confirm the exact edit we sent (including ids the
 * server assigned to new sections). This is acknowledgement, not rebasing
 * a changed draft onto an unrelated newer revision. */
function confirmsDraft(plan: AgentPlan, draft: Draft): boolean {
  return plan.brief === draft.brief
    && JSON.stringify(plan.open_questions) === JSON.stringify(editOf(draft).open_questions)
    && plan.sections.length === draft.sections.length
    && plan.sections.every((section, index) => {
      const sent = itemAt(draft.sections, index);
      return (!sent.id || section.id === sent.id) && section.title === sent.title
        && (section.goal ?? '') === sent.goal && JSON.stringify(section.sources) === JSON.stringify(sent.sources);
    });
}

/** The HTTP plan is current; a recorded event is only a snapshot of it.
 * Drafts retain their own revision, and never silently rebase after a 412. */
export function PlanCard({
  plan, location, busy, canEdit, onStart,
}: {
  plan: AgentPlan;
  location: PlanLocation;
  busy: boolean;
  canEdit: boolean;
  onStart: StartPlan;
}) {
  const titleId = useId();
  const client = useQueryClient();
  const query = useQuery(chatPlanQuery(location));
  const remote = query.data && query.data.plan.revision >= plan.revision ? query.data.plan : plan;
  const [stored, setDraft] = useState(() => draftOf(plan));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState<string | null>(null);
  const [notice, setNotice] = useState(() => ({ plan, changes: [] as string[] }));
  const fields = useRef(new Map<string, HTMLInputElement>());
  const focusKey = useRef<string | null>(null);
  useLayoutEffect(() => {
    if (!focusKey.current) return;
    fields.current.get(focusKey.current)?.focus();
    focusKey.current = null;
  });
  if (remote.revision > notice.plan.revision) setNotice({ plan: remote, changes: planChanges(notice.plan, remote) });
  const dirty = contentOf(stored) !== contentOf(draftOf(stored.base));
  let draft = stored;
  if (remote.revision > stored.base.revision && (!dirty
    || (submitted === contentOf(stored) && remote.state === 'running' && confirmsDraft(remote, stored)))) {
    draft = draftOf(remote);
    setDraft(draft);
    setSubmitted(null);
  }
  const newer = remote.revision > draft.base.revision;
  const editable = canEdit && ['proposed', 'running', 'stopped'].includes(remote.state);
  const etag = query.data?.plan.revision === draft.base.revision ? query.data.etag : null;
  const writable = editable && !newer && Boolean(etag) && !query.isError && !saving;

  const savedRevision = query.data?.plan.revision;
  const { refetch } = query;
  useEffect(() => {
    if (savedRevision !== undefined && savedRevision < plan.revision) void refetch();
  }, [plan.revision, refetch, savedRevision]);

  const validation = () => {
    const edit = editOf(draft);
    if (!draft.brief.trim() || draft.sections.some((section) => !section.title.trim())) return 'Give the brief and each section a title before continuing.';
    if (edit.open_questions && (edit.open_questions.length > 10 || edit.open_questions.some((text) => text.length > 500))) {
      return 'Keep open questions to ten lines, each up to 500 characters.';
    }
    return null;
  };

  const save = async (discard = false) => {
    if (!writable || !etag) return;
    const invalid = discard ? null : validation();
    if (invalid) { setError(invalid); return; }
    setSaving(true);
    setError(null);
    const { revision: _revision, ...edit } = editOf(draft);
    try {
      const version = await updateChatPlan(location, etag, discard ? { state: 'discarded' } : edit);
      client.setQueryData(chatPlanQuery(location).queryKey, version);
      setDraft(draftOf(version.plan));
    } catch (failure) {
      setError(problemCode(failure) === 'stale_plan'
        ? 'The plan changed. Your edits are kept here; read the current revision before continuing.'
        : errorMessage(failure, 'The plan could not be updated. Your edits are kept here.'));
      if (problemCode(failure) === 'stale_plan') void query.refetch();
    } finally {
      setSaving(false);
    }
  };

  const updateSection = (key: string, patch: Partial<DraftSection>) => setDraft((current) => ({
    ...current, sections: current.sections.map((section) => section.key === key ? { ...section, ...patch } : section),
  }));
  const sectionOpen = (section: DraftSection) => !section.id
    || (remote.sections.find((item) => item.id === section.id)?.state ?? 'pending') === 'pending';
  const move = (index: number, step: -1 | 1) => setDraft((current) => {
    const sections = [...current.sections];
    const section = sections[index];
    const other = sections[index + step];
    if (!section || !other) return current;
    sections[index] = other;
    sections[index + step] = section;
    return { ...current, sections };
  });
  const remove = (key: string, index: number) => {
    const remaining = draft.sections.filter((section) => section.key !== key);
    setDraft((current) => ({ ...current, sections: remaining }));
    focusKey.current = remaining[Math.min(index, remaining.length - 1)]?.key ?? null;
  };
  const add = () => {
    const key = uid();
    setDraft((current) => ({ ...current, sections: [...current.sections, { key, id: null, title: '', goal: '', sources: [] }] }));
    focusKey.current = key;
  };

  return (
    <section id={`assistant-plan-${plan.plan_id}`} tabIndex={-1} aria-labelledby={titleId} className="rounded-lg border border-border bg-popover p-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring">
      <div className="flex items-start justify-between gap-3">
        <h3 id={titleId} className="font-medium">Plan</h3>
        <span className="text-xs text-muted-foreground">Deep · {PLAN_STATUS[remote.state]} · revision {remote.revision}</span>
      </div>
      {remote.revision > 1 && <p className="mt-1 text-xs text-muted-foreground" role="status">Plan updated to revision {remote.revision}.</p>}
      {!!notice.changes.length && <p className="mt-1 text-xs text-muted-foreground">{notice.changes.join(' · ')}</p>}
      <label className="mt-3 block space-y-1 text-xs font-medium">
        <span>Brief</span>
        <Textarea
          value={draft.brief} maxLength={4_000} readOnly={!writable || remote.state === 'running'}
          onChange={(event) => setDraft((current) => ({ ...current, brief: event.target.value }))}
          className="min-h-20 font-normal"
        />
      </label>
      <ol aria-label="Plan sections" className="mt-3 space-y-3">
        {draft.sections.map((section, index) => {
          const open = sectionOpen(section);
          const state = remote.sections.find((item) => item.id === section.id)?.state ?? 'pending';
          return (
            <li key={section.key} className="rounded-md border border-border p-2">
              <div className="mb-2 flex items-center justify-between gap-2 text-xs">
                <span>{index + 1}. {SECTION_STATUS[state]}</span>
                {editable && (
                  <div className="flex gap-0.5">
                    <Button type="button" variant="ghost" size="icon-xs" aria-label={`Move section ${index + 1} up`}
                      disabled={!writable || !open || index === 0 || !sectionOpen(itemAt(draft.sections, index - 1))}
                      onClick={() => move(index, -1)}><ArrowUp /></Button>
                    <Button type="button" variant="ghost" size="icon-xs" aria-label={`Move section ${index + 1} down`}
                      disabled={!writable || !open || index === draft.sections.length - 1 || !sectionOpen(itemAt(draft.sections, index + 1))}
                      onClick={() => move(index, 1)}><ArrowDown /></Button>
                    <Button type="button" variant="ghost" size="icon-xs" aria-label={`Remove section ${index + 1}`}
                      disabled={!writable || !open || draft.sections.length === 1}
                      onClick={() => remove(section.key, index)}><X /></Button>
                  </div>
                )}
              </div>
              <Input aria-label={`Section ${index + 1} title`} value={section.title} maxLength={200}
                ref={(field) => { if (field) fields.current.set(section.key, field); else fields.current.delete(section.key); }}
                readOnly={!writable || !open} onChange={(event) => updateSection(section.key, { title: event.target.value })} />
              <Textarea aria-label={`Section ${index + 1} goal`} value={section.goal} maxLength={1_000}
                readOnly={!writable || !open} onChange={(event) => updateSection(section.key, { goal: event.target.value })}
                className="mt-1.5 min-h-16" />
              <p className="mt-1 text-xs text-muted-foreground">{section.sources.length ? `Sources: ${section.sources.join(' ')}` : 'From the page; no sources selected yet'}</p>
            </li>
          );
        })}
      </ol>
      {editable && (
        <Button type="button" variant="ghost" size="xs" className="mt-2" disabled={!writable || draft.sections.length >= 20}
          onClick={add}>
          <Plus />Add a section
        </Button>
      )}
      <label className="mt-3 block space-y-1 text-xs font-medium">
        <span>Open questions <span className="font-normal text-muted-foreground">(one per line)</span></span>
        <Textarea value={draft.questions} readOnly={!writable} className="min-h-16 font-normal"
          onChange={(event) => setDraft((current) => ({ ...current, questions: event.target.value }))} />
      </label>
      {(newer || error) && (
        <div className="mt-3 space-y-2 text-xs" role="alert">
          <p>{error ?? 'A newer plan revision is available. Your edits are kept here.'}</p>
          {newer && <Button type="button" variant="outline" size="xs" onClick={() => { setDraft(draftOf(remote)); setError(null); }}>Use current plan</Button>}
          {newer && <p className="text-muted-foreground">Use current plan replaces only your unsaved plan edits.</p>}
        </div>
      )}
      {query.isError && <p role="alert" className="mt-2 text-xs text-destructive">The current plan could not be read. Your edits are kept. <button type="button" className="underline" onClick={() => { void query.refetch(); }}>Read again</button></p>}
      {editable && (
        <div className="mt-3 flex flex-wrap justify-end gap-2">
          {remote.state !== 'running' && <Button type="button" variant="ghost" size="xs" disabled={!writable || busy} onClick={() => { void save(true); }}>Discard plan</Button>}
          <Button type="button" variant="outline" size="xs" disabled={!writable || !dirty} onClick={() => { void save(); }}>Save plan changes</Button>
          {remote.state !== 'running' && (
            <Button type="button" size="xs" disabled={!writable || busy} onClick={() => {
              const invalid = validation();
              if (invalid) { setError(invalid); return; }
              setSubmitted(contentOf(draft));
              onStart(remote, editOf(draft));
            }}>{remote.state === 'stopped' ? 'Continue writing' : 'Start writing'}</Button>
          )}
        </div>
      )}
    </section>
  );
}
