import { useEffect, useId, useState, type FormEvent } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Download, RotateCcw, Trash2 } from 'lucide-react';
import { problemCode } from '@/api/errors';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { NativeSelect } from '@/components/ui/select';
import { Spinner } from '@/components/ui/spinner';
import { Switch } from '@/components/ui/switch';
import { useView } from '@/components/layout/viewContextState';
import { relativeTime } from '@/components/layout/relativeTime';
import { shortDate } from '@/components/layout/editedLabel';
import { purgeLabel } from '@/components/collections/trashCopy';
import { useWorkspace } from '@/components/workspace/workspaceContextState';
import { WorkspaceIcon } from '@/components/workspace/WorkspaceIcon';
import { WorkspaceIconPicker } from '@/components/workspace/WorkspaceIconPicker';
import { kindLabel } from '@/components/workspace/workspaceIcon';
import { useWorkspaceActions, workspaceProblem } from '@/actions/useWorkspaceActions';
import { followJob, useWorkspaceJobs } from '@/actions/trashJobs';
import { collectionKeys } from '@/data/resources';
import {
  WORKSPACE_NAME_MAX,
  downloadWorkspaceExport,
  exportWorkspace,
  noteOwnTreeChange,
  roleAtLeast,
  setWorkspaceDetail,
  updateWorkspace,
  workspaceKeys,
  workspaceQuery,
  type SortMode,
  type WorkspaceChanges,
  type WorkspaceDetail,
  type WorkspacePolicy,
} from '@/data/workspaces';
import type { JobResult } from '@/api/schema';
import { downloadBlob } from '@/export/download';
import { formatBytes } from '@/lib/text';
import { ReadOnlyValue, Row, Section } from './SettingsSection';
import { TypedConfirmDialog } from './TypedConfirmDialog';

const SORT_MODES: ReadonlyArray<{ value: SortMode; label: string }> = [
  { value: 'name', label: 'Name' },
  { value: 'custom', label: 'Custom order' },
  { value: 'updated', label: 'Last edited' },
];

/** The policy switches, as the API names them, in the author's words (D7). */
const POLICY: ReadonlyArray<{ key: keyof WorkspacePolicy; title: string; description: string }> = [
  {
    key: 'web_search',
    title: 'Web search',
    description: 'The assistant can search the public web and read the pages it finds.',
  },
  {
    key: 'outside_research',
    title: 'Outside research',
    description: 'The assistant and Research can use arXiv, Semantic Scholar and claim checks, and citing can look up DOIs and arXiv ids. This workspace’s own PDFs stay available.',
  },
  {
    key: 'auto',
    title: 'Auto',
    description: 'Auto in the assistant can apply its edits without asking first.',
  },
  {
    key: 'images',
    title: 'Images',
    description: 'The assistant can propose generated illustrations. Each image still needs explicit confirmation; Auto cannot confirm it.',
  },
];

/**
 * Settings → Workspace (M5.UI-3, 08 §6.7, 14 §3.5): the workspace being
 * shown. Its name, icon and the order of its top level; its policy, which
 * can only switch the assistant's features off for everyone here; an export
 * of every page; and, for its owner, deleting it, which can be undone for 30
 * days. The deleted workspaces the account can still restore are listed at
 * the end.
 *
 * Changes are an admin's; everyone else sees them read-only. Every write is
 * locked on the workspace's ETag: one made elsewhere since is said, and the
 * workspace is read again.
 */
export function WorkspacePane() {
  const { workspace, deleted } = useWorkspace();
  const detail = useQuery(workspaceQuery(workspace.id));
  const data = detail.data;
  return (
    <>
      {!data ? (
        detail.isError ? (
          <Alert variant="destructive">{workspaceProblem(detail.error, 'Could not load this workspace.')}</Alert>
        ) : (
          <p className="flex min-h-40 items-center justify-center gap-2 text-sm text-muted-foreground">
            <Spinner />
            Loading the workspace…
          </p>
        )
      ) : (
        <ShownWorkspaceSettings detail={data} />
      )}
      {deleted.length > 0 && <DeletedWorkspaces />}
    </>
  );
}

function ShownWorkspaceSettings({ detail }: { detail: WorkspaceDetail }) {
  const queryClient = useQueryClient();
  const admin = roleAtLeast(detail.role, 'admin');
  const [error, setError] = useState<{ section: 'general' | 'policy'; message: string } | null>(null);
  const [saving, setSaving] = useState<string | null>(null);

  /** One change, locked on the ETag read; the detail it answers is the one shown. */
  const save = async (section: 'general' | 'policy', field: string, changes: WorkspaceChanges) => {
    setSaving(field);
    setError(null);
    try {
      const next = await updateWorkspace(detail.id, detail.etag, changes);
      setWorkspaceDetail(queryClient, next);
      if (changes.root_sort_mode && changes.root_sort_mode !== detail.root_sort_mode) {
        noteOwnTreeChange(detail.id, next.tree_version);
        void queryClient.invalidateQueries({ queryKey: [...collectionKeys.all(detail.id), 'branch'] });
      }
      return true;
    } catch (caught) {
      if (problemCode(caught) === 'stale_workspace') void queryClient.invalidateQueries({ queryKey: workspaceKeys.detail(detail.id) });
      setError({ section, message: workspaceProblem(caught, 'Could not save the change.') });
      return false;
    } finally {
      setSaving(null);
    }
  };

  return (
    <div className="flex flex-col gap-9">
      <GeneralSection detail={detail} admin={admin} saving={saving} onSave={(field, changes) => save('general', field, changes)}
        error={error?.section === 'general' ? error.message : null} />
      <Section
        title="Assistant in this workspace"
        note="These switch a feature off for everyone in this workspace. They never turn on what someone switched off in their own AI & tools settings."
      >
        {POLICY.map(({ key, title, description }) => (
          <PolicyRow
            key={key}
            title={title}
            description={description}
            checked={detail.policy[key]}
            disabled={!admin || saving !== null}
            busy={saving === `policy:${key}`}
            onChange={(on) => void save('policy', `policy:${key}`, { policy: { [key]: on } })}
          />
        ))}
        {error?.section === 'policy' && <div className="py-3"><Alert variant="destructive">{error.message}</Alert></div>}
      </Section>
      {admin && <ExportSection detail={detail} />}
      <DeleteSection detail={detail} />
      {!admin && (
        <p className="text-xs text-muted-foreground">
          Only this workspace’s admins can change its settings. You are {detail.role === 'editor' ? 'an editor' : `a ${detail.role}`} here.
        </p>
      )}
    </div>
  );
}

function GeneralSection({
  detail,
  admin,
  saving,
  onSave,
  error,
}: {
  detail: WorkspaceDetail;
  admin: boolean;
  saving: string | null;
  onSave: (field: string, changes: WorkspaceChanges) => Promise<boolean>;
  error: string | null;
}) {
  const nameId = useId();
  const sortId = useId();
  const [name, setName] = useState(detail.name);
  const [shownName, setShownName] = useState(detail.name);
  // A save here or a read from elsewhere brings a new name: take it, unless one is being typed.
  if (detail.name !== shownName) {
    setShownName(detail.name);
    if (name.trim() === shownName) setName(detail.name);
  }
  const trimmed = name.trim();
  const nameChanged = trimmed !== '' && trimmed !== detail.name;

  const submitName = async (event: FormEvent) => {
    event.preventDefault();
    if (!nameChanged || saving) return;
    if (await onSave('name', { name: trimmed })) setName(trimmed);
  };

  return (
    <Section title="General">
      <Row id={nameId} label="Name" description={`How it is shown in the sidebar and the workspace menu. ${kindLabel(detail.kind)} workspace.`}>
        {admin ? (
          <form className="flex gap-2" onSubmit={(event) => void submitName(event)}>
            <Input
              id={nameId}
              value={name}
              maxLength={WORKSPACE_NAME_MAX}
              disabled={saving === 'name'}
              onChange={(event) => setName(event.target.value)}
            />
            {nameChanged && (
              <Button type="submit" variant="outline" className="shrink-0" disabled={saving !== null}>
                {saving === 'name' && <Spinner />}
                Save
              </Button>
            )}
          </form>
        ) : (
          <ReadOnlyValue value={detail.name} />
        )}
      </Row>
      <Row label="Icon" description="An emoji, or a colour tile with the workspace’s initials." stacked>
        {admin ? (
          <WorkspaceIconPicker
            name={detail.name}
            value={detail.icon}
            disabled={saving !== null}
            onChange={(icon) => void onSave('icon', { icon })}
          />
        ) : (
          <WorkspaceIcon workspace={detail} size="lg" />
        )}
      </Row>
      <Row id={sortId} label="Default order" description="How the top level of Pages is ordered. Each collection keeps its own order.">
        <NativeSelect
          id={sortId}
          className="w-full sm:w-48"
          value={detail.root_sort_mode}
          disabled={!admin || saving !== null}
          onChange={(event) => void onSave('sort', { root_sort_mode: event.target.value as SortMode })}
        >
          {SORT_MODES.map((mode) => (
            <option key={mode.value} value={mode.value}>
              {mode.label}
            </option>
          ))}
        </NativeSelect>
      </Row>
      {error && <div className="py-3"><Alert variant="destructive">{error}</Alert></div>}
    </Section>
  );
}

function PolicyRow({
  title,
  description,
  checked,
  disabled,
  busy,
  onChange,
}: {
  title: string;
  description: string;
  checked: boolean;
  disabled: boolean;
  busy: boolean;
  onChange: (on: boolean) => void;
}) {
  const id = useId();
  return (
    <div className="flex items-center justify-between gap-6 py-4">
      <div className="min-w-0">
        <label htmlFor={id} className="text-sm font-medium text-foreground">
          {title}
        </label>
        <p className="mt-0.5 text-xs text-muted-foreground">{description}</p>
        {!checked && <p className="mt-0.5 text-xs font-medium text-foreground">Switched off for everyone here.</p>}
      </div>
      <span className="flex shrink-0 items-center gap-2">
        {busy && <Spinner className="size-3.5" />}
        <Switch id={id} checked={checked} disabled={disabled} onCheckedChange={onChange} />
      </span>
    </div>
  );
}

/**
 * Export: every live page as JSON and Markdown in a zip, with the PDFs if
 * asked, built as a job; the zip downloads for seven days.
 */
function ExportSection({ detail }: { detail: WorkspaceDetail }) {
  const queryClient = useQueryClient();
  const [includePdfs, setIncludePdfs] = useState(false);
  const [starting, setStarting] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pdfsId = useId();
  const running = useWorkspaceJobs(detail.id).find((item) => item.job.kind === 'workspace_export');
  // What this session's last export made; its job's answer fills it.
  const ready = useQuery({
    queryKey: workspaceKeys.export(detail.id),
    queryFn: (): JobResult | null => null,
    enabled: false,
    initialData: null,
    staleTime: Infinity,
  }).data;

  const start = async () => {
    setStarting(true);
    setError(null);
    try {
      const job = await exportWorkspace(detail.id, includePdfs);
      followJob(detail.id, job, {
        label: `Exporting ${detail.name}`,
        unit: 'pages',
        onSettled: (final) => {
          if (final.status === 'done') queryClient.setQueryData(workspaceKeys.export(detail.id), final.progress?.result ?? null);
        },
      });
    } catch (caught) {
      setError(workspaceProblem(caught, 'Could not start the export.'));
    } finally {
      setStarting(false);
    }
  };

  const download = async () => {
    setDownloading(true);
    setError(null);
    try {
      const { blob, filename } = await downloadWorkspaceExport(detail.id);
      downloadBlob(blob, filename ?? `${detail.name}.zip`);
    } catch (caught) {
      setError(problemCode(caught) === 'export_not_found'
        ? 'There is no export to download: it expired, or none was made yet. Export the workspace first.'
        : workspaceProblem(caught, 'Could not download the export.'));
    } finally {
      setDownloading(false);
    }
  };

  const progress = running?.job.progress;
  const summary = ready ? exportSummary(ready) : null;

  return (
    <Section title="Export" note="Pages and PDFs in the Trash are left out. An export can be downloaded for 7 days.">
      <Row label="Export this workspace" description="Every page as JSON and as Markdown, in one zip file." stacked>
        <div className="flex flex-col gap-3">
          <label htmlFor={pdfsId} className="flex items-center gap-2 text-sm">
            <Checkbox id={pdfsId} checked={includePdfs} onCheckedChange={(checked) => setIncludePdfs(checked === true)} />
            Include the PDFs
          </label>
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="outline" onClick={() => void start()} disabled={starting || Boolean(running && !running.error)}>
              {(starting || (running && !running.error)) && <Spinner />}
              {running && !running.error ? 'Exporting…' : 'Export workspace'}
            </Button>
            <Button variant="ghost" onClick={() => void download()} disabled={downloading}>
              {downloading ? <Spinner /> : <Download aria-hidden="true" />}
              {summary ? 'Download' : 'Download the last export'}
            </Button>
          </div>
          <div role="status" aria-live="polite" className="text-xs text-muted-foreground">
            {running && !running.error && progress && progress.total > 0 && (
              <span>{Math.min(progress.done, progress.total).toLocaleString()} of {progress.total.toLocaleString()} pages</span>
            )}
            {running?.error && <span className="text-destructive">Could not finish the export. {running.error}</span>}
            {!running && summary && <span>Ready: {summary}</span>}
          </div>
          {error && <Alert variant="destructive">{error}</Alert>}
        </div>
      </Row>
    </Section>
  );
}

/** "12 pages and 3 PDFs, 4.1 MB, until Nov 22". */
function exportSummary(result: JobResult): string {
  const pages = result.page_count ?? 0;
  const pdfs = result.pdf_count ?? 0;
  const parts = [`${pages.toLocaleString()} ${pages === 1 ? 'page' : 'pages'}`];
  if (pdfs > 0) parts.push(`${pdfs.toLocaleString()} ${pdfs === 1 ? 'PDF' : 'PDFs'}`);
  const size = result.byte_size ? `, ${formatBytes(result.byte_size)}` : '';
  const until = result.expires_at ? `, until ${shortDate(new Date(result.expires_at))}` : '';
  return `${parts.join(' and ')}${size}${until}`;
}

/** Deleting the workspace: its owner's, a shared one only, with its name typed. */
function DeleteSection({ detail }: { detail: WorkspaceDetail }) {
  const { deleteShown } = useWorkspaceActions();
  const { setView } = useView();
  const [confirming, setConfirming] = useState(false);
  const owner = detail.role === 'owner';

  let body: string;
  if (detail.kind === 'personal') {
    body = 'Your personal workspace goes with your account, so it cannot be deleted on its own. Deleting your account, in Settings → Account, deletes it.';
  } else if (!owner) {
    body = 'Only the workspace’s owner can delete it.';
  } else {
    body = 'Everyone in it loses access at once. You can restore it here for 30 days; then it is deleted for good, with its pages, collections, PDFs and chats.';
  }

  return (
    <Section title="Delete workspace">
      <Row label={detail.kind === 'personal' ? 'Personal workspace' : 'Delete this workspace'} description={body}>
        {detail.kind === 'shared' && owner && (
          <div className="flex sm:justify-end">
            <Button variant="outline" className="text-destructive" onClick={() => setConfirming(true)}>
              <Trash2 aria-hidden="true" />
              Delete workspace
            </Button>
          </div>
        )}
      </Row>
      {confirming && (
        <TypedConfirmDialog
          title={`Delete ${detail.name}?`}
          description="Everyone in it loses access at once. You can restore it from Settings → Workspace for 30 days."
          expected={detail.name}
          confirmLabel="Delete workspace"
          onClose={() => setConfirming(false)}
          describe={(error) => workspaceProblem(error, 'Could not delete the workspace.')}
          onConfirm={() => deleteShown(detail.etag, detail.name, () => setView('editor'))}
        />
      )}
    </Section>
  );
}

/** The deleted workspaces the account can still restore, with how long is left. */
function DeletedWorkspaces() {
  const { deleted } = useWorkspace();
  const { restore } = useWorkspaceActions();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(timer);
  }, []);

  const bringBack = async (workspaceId: string) => {
    setBusy(workspaceId);
    setError(null);
    try {
      await restore(workspaceId);
    } catch (caught) {
      setError(workspaceProblem(caught, 'Could not restore the workspace.'));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="mt-9">
      <Section title="Deleted workspaces" note="Restoring brings a workspace back as it was, with everything it held.">
        {deleted.map((item) => (
          <div key={item.id} className="flex items-center gap-3 py-3">
            <WorkspaceIcon workspace={item} size="lg" />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium text-foreground">{item.name}</p>
              <p className="text-xs text-muted-foreground">
                Deleted {relativeTime(Date.parse(item.deleted_at), now)} · {purgeLabel(item.purge_after, now)}
              </p>
            </div>
            <Button variant="outline" size="sm" disabled={busy !== null} onClick={() => void bringBack(item.id)} aria-label={`Restore ${item.name}`}>
              {busy === item.id ? <Spinner /> : <RotateCcw aria-hidden="true" />}
              Restore
            </Button>
          </div>
        ))}
        {error && <div className="py-3"><Alert variant="destructive">{error}</Alert></div>}
      </Section>
    </div>
  );
}
