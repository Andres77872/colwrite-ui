import { useContext, useId, useState } from 'react';
import { Search } from 'lucide-react';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { NativeSelect } from '@/components/ui/select';
import { Spinner } from '@/components/ui/spinner';
import { Switch } from '@/components/ui/switch';
import { errorMessage } from '@/api/errors';
import { useUpdateAssistantSettings, type AssistantSettings, type CapabilityState, type PermissionGroup } from '@/data/assistant';
import { AssistantCatalogContext } from './assistantCatalogContextState';

const TABS = { tools: 'Tools', skills: 'Skills', workers: 'Workers' } as const;
const STATUS: Record<CapabilityState, string> = {
  on: 'Available', off: 'Off in settings', blocked: 'Blocked here', unavailable: 'Unavailable',
};

type Item = {
  id: string; label: string; description?: string; detail?: string;
  state: CapabilityState; reason: string | null; configurable: boolean;
};

export function ToolingCatalog({ permissions }: { permissions: AssistantSettings['permissions'] }) {
  const context = useContext(AssistantCatalogContext);
  const heading = useId();
  const [tab, setTab] = useState<PermissionGroup>('tools');
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState('all');
  const update = useUpdateAssistantSettings();
  const catalog = context?.catalog;
  const text = query.trim().toLowerCase();
  const matches = (row: Item) => (
    (status === 'all' || row.state === status)
    && `${row.label} ${row.id} ${row.description ?? ''}`.toLowerCase().includes(text)
  );
  const groups: { id: string; label: string; items: Item[] }[] = catalog
    ? tab === 'tools'
      ? catalog.toolsets.map((group) => ({
        id: group.id,
        label: group.label,
        items: catalog.tools.filter((tool) => tool.toolset === group.id && matches(tool))
          .map((tool) => ({ ...tool, detail: tool.profiles.join(' · ') })),
      })).filter((group) => group.items.length)
      : [{
        id: tab, label: TABS[tab],
        items: tab === 'skills'
          ? catalog.skills.filter(matches).map((skill) => ({
            ...skill, detail: [`v${skill.version}`, ...skill.needs].join(' · '),
          }))
          : catalog.workers.filter(matches).map((worker) => ({
            ...worker, detail: `Potential tools: ${worker.tools.join(', ')}`,
          })),
      }].filter((group) => group.items.length)
    : [];
  const engineName = catalog?.engines.find((entry) => entry.id === catalog.engine)?.label ?? catalog?.engine;
  const overrides = permissions?.[tab] ?? {};

  return (
    <section aria-labelledby={heading}>
      <h2 id={heading} className="text-sm font-semibold text-foreground">Tooling catalog</h2>
      <p className="mt-1 text-xs text-muted-foreground">
        {engineName ? `${context?.workspaceName ?? 'Current workspace'} · Chat engine: ${engineName}. ` : ''}
        Availability here can differ from what you allow in your account. Individual settings affect new assistant runs, not manual actions.
      </p>
      {context?.loading && !catalog && (
        <p role="status" className="mt-3 flex items-center gap-2 text-xs text-muted-foreground"><Spinner /> Loading catalog…</p>
      )}
      {context?.error && (
        <div className="mt-3">
          <Alert variant="destructive">{context.error}</Alert>
          <Button className="mt-2" variant="outline" size="xs" onClick={context.retry}>Retry catalog</Button>
        </div>
      )}
      {catalog && (
        <>
          <div className="mt-3 flex flex-wrap gap-1" role="group" aria-label="Catalog section">
            {(Object.keys(TABS) as PermissionGroup[]).map((id) => (
              <Button key={id} type="button" size="sm" variant={id === tab ? 'secondary' : 'ghost'}
                aria-pressed={id === tab} onClick={() => setTab(id)}>
                {TABS[id]}
              </Button>
            ))}
          </div>
          <div className="my-3 flex flex-wrap items-center gap-2">
            <div className="relative min-w-40 flex-1">
              <Search aria-hidden="true" className="pointer-events-none absolute left-2.5 top-2.5 size-4 text-muted-foreground" />
              <Input aria-label="Search catalog" placeholder="Search by name or ID…" className="pl-8"
                value={query} onChange={(event) => setQuery(event.target.value)} />
            </div>
            <NativeSelect className="w-full sm:w-44" aria-label="Filter by availability" value={status} onChange={(event) => setStatus(event.target.value)}>
              <option value="all">All states</option>
              {Object.entries(STATUS).map(([id, label]) => <option key={id} value={id}>{label}</option>)}
            </NativeSelect>
          </div>
          {update.error && (
            <Alert variant="destructive" className="mb-3">{errorMessage(update.error, 'Could not save your tooling preference.')}</Alert>
          )}
          {update.isPending && <p role="status" className="mb-2 text-xs text-muted-foreground">Saving tooling preference…</p>}
          {!groups.length && <p className="py-4 text-sm text-muted-foreground">No matching entries.</p>}
          <div className="space-y-2">
            {groups.map((group) => (
              <details key={group.id} open className="rounded-md border border-border">
                <summary className="cursor-pointer px-3 py-2 text-sm font-medium">{group.label} · {group.items.length}</summary>
                <ul className="divide-y divide-border border-t border-border">
                  {group.items.map((row) => (
                    <CatalogRow key={row.id} row={row} allowed={overrides[row.id] !== false} saving={update.isPending}
                      onChange={(allowed) => update.mutate({ permissions: { [tab]: { [row.id]: allowed } } })} />
                  ))}
                </ul>
              </details>
            ))}
          </div>
        </>
      )}
    </section>
  );
}

function CatalogRow({ row, allowed, saving, onChange }: {
  row: Item; allowed: boolean; saving: boolean; onChange: (allowed: boolean) => void;
}) {
  const id = useId();
  return (
    <li className="flex items-start justify-between gap-3 px-3 py-2.5">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="text-sm font-medium">{row.label}</span>
          <Badge variant={row.state === 'blocked' ? 'warning' : 'secondary'}>{STATUS[row.state]}</Badge>
        </div>
        <code className="break-all text-xs text-muted-foreground">{row.id}</code>
        {row.description && <p className="mt-0.5 text-xs text-muted-foreground">{row.description}</p>}
        {row.detail && <p className="mt-0.5 break-words text-xs text-muted-foreground">{row.detail}</p>}
        {row.reason && <p id={id} className="mt-1 text-xs text-foreground">{row.reason}</p>}
      </div>
      {row.configurable
        ? <Switch className="mt-1 shrink-0" checked={allowed} disabled={saving}
            aria-label={`Allow ${row.id} in my account`} aria-describedby={row.reason ? id : undefined} onCheckedChange={onChange} />
        : <span className="mt-1 max-w-24 text-right text-xs text-muted-foreground">No individual setting</span>}
    </li>
  );
}
