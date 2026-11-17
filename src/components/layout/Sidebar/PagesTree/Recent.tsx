import { useEffect, useId, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ChevronDown, ChevronRight, FileText } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Spinner } from '@/components/ui/spinner';
import { useDocumentActions, useDocumentSession, useDocumentStatus, useEditorDoc } from '@/editor';
import { useWorkspaceId } from '@/components/workspace/workspaceContextState';
import { displayTitle, isUntitledName } from '@/components/layout/displayTitle';
import { shortDateTime } from '@/components/layout/editedLabel';
import { readItem, recentCollapsedKey, writeItem } from '@/lib/storageKeys';
import { documentListQuery, patchOpenRow } from '@/data/documents';
import { sidebarRow, sidebarRowActive } from '../sidebarStyles';

/** How many pages Recent shows (08 §2.1). */
export const RECENT_COUNT = 5;

/**
 * "Recent": the five pages edited last, wherever they live. What is left of
 * the old flat list's usefulness, next to the tree; it can be folded away,
 * and remembers that for the workspace.
 */
export function Recent({ onPageOpened }: { onPageOpened?: () => void }) {
  const workspaceId = useWorkspaceId();
  const { switchTo } = useDocumentActions();
  const { documentId, loadingDocumentId } = useDocumentSession();
  const { doc } = useEditorDoc();
  const { lastSavedAt } = useDocumentStatus();
  const headingId = useId();
  const listId = useId();
  const [collapsed, setCollapsed] = useState(() => readItem(recentCollapsedKey(workspaceId)) === 'true');
  useEffect(() => {
    writeItem(recentCollapsedKey(workspaceId), String(collapsed));
  }, [collapsed, workspaceId]);

  const list = useQuery({
    ...documentListQuery(workspaceId, { limit: RECENT_COUNT, sortBy: 'updated_at', sortOrder: 'desc' }),
    enabled: !collapsed,
  });
  const rows = list.data
    ? patchOpenRow(list.data, { documentId, name: doc.name, lastSavedAt }).documents
    : [];
  // A workspace with no pages has no Recent to show.
  if (list.data && rows.length === 0) return null;

  const open = async (id: string) => {
    if (id === documentId || id === loadingDocumentId) return;
    try {
      if (await switchTo(id)) onPageOpened?.();
    } catch {
      // The editor shows the one load-failure notice and keeps the open page.
    }
  };

  return (
    <section aria-labelledby={headingId} className="mb-2 flex flex-col gap-px">
      <button
        type="button"
        className="flex h-7 items-center gap-1 rounded-md px-2 text-left text-xs font-medium text-muted-foreground transition-colors hover:bg-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        aria-expanded={!collapsed}
        aria-controls={listId}
        onClick={() => setCollapsed((value) => !value)}
      >
        <h2 id={headingId} className="min-w-0 flex-1 truncate">Recent</h2>
        {collapsed ? <ChevronRight aria-hidden="true" className="size-3.5" /> : <ChevronDown aria-hidden="true" className="size-3.5" />}
      </button>
      {!collapsed && (
        <ul id={listId} className="flex flex-col gap-px" aria-busy={list.isFetching}>
          {rows.map((row) => {
            const current = row.id === documentId;
            const pending = row.id === loadingDocumentId;
            const name = displayTitle(row.name);
            const updated = shortDateTime(row.updatedAt);
            return (
              <li key={row.id}>
                <button
                  type="button"
                  className={cn(sidebarRow, current && sidebarRowActive)}
                  aria-current={current ? 'page' : undefined}
                  title={updated ? `${name}\nEdited ${updated}` : name}
                  onClick={() => void open(row.id)}
                >
                  {pending ? <Spinner className="size-[18px]" /> : <FileText aria-hidden="true" />}
                  <span className={cn('min-w-0 flex-1 truncate', isUntitledName(row.name) && 'text-muted-foreground')}>{name}</span>
                  {pending && <span className="sr-only">Opening…</span>}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
