import { formatBytes, formatCompact, formatCost } from '@/lib/text';
import type { WorkspaceUsageEntry } from '@/data/workspaces';

/**
 * Usage → All workspaces: each workspace's part, so the totals above can be
 * told apart. Plain figures, read in each workspace's own scope.
 */
export function WorkspaceUsageTable({ workspaces }: { workspaces: readonly WorkspaceUsageEntry[] }) {
  return (
    <section className="border-t border-border pt-6" aria-labelledby="usage-workspaces">
      <h2 id="usage-workspaces" className="text-md font-semibold">
        By workspace
      </h2>
      <div className="mt-3 overflow-x-auto">
        <table className="w-full min-w-[32rem] text-sm">
          <thead>
            <tr className="border-b border-border text-left text-xs text-muted-foreground">
              <th scope="col" className="py-2 pr-3 font-medium">Workspace</th>
              <th scope="col" className="py-2 pr-3 text-right font-medium">Pages</th>
              <th scope="col" className="py-2 pr-3 text-right font-medium">Assistant runs</th>
              <th scope="col" className="py-2 pr-3 text-right font-medium">Cost</th>
              <th scope="col" className="py-2 pr-3 text-right font-medium">PDFs</th>
              <th scope="col" className="py-2 text-right font-medium">Storage</th>
            </tr>
          </thead>
          <tbody>
            {workspaces.map((workspace) => (
              <tr key={workspace.id} className="border-b border-border last:border-0">
                <th scope="row" className="max-w-[16rem] truncate py-2 pr-3 text-left font-normal text-foreground">
                  {workspace.name}
                  {workspace.kind === 'personal' && <span className="ml-1.5 text-xs text-muted-foreground">Personal</span>}
                </th>
                <td className="py-2 pr-3 text-right tabular-nums">{formatCompact(workspace.summary.documents_active)}</td>
                <td className="py-2 pr-3 text-right tabular-nums">{formatCompact(workspace.summary.assistant_runs_total)}</td>
                <td className="py-2 pr-3 text-right tabular-nums">{formatCost(workspace.summary.cost)}</td>
                <td className="py-2 pr-3 text-right tabular-nums">{formatCompact(workspace.storage.pdfs)}</td>
                <td className="py-2 text-right tabular-nums">{formatBytes(workspace.storage.pdf_bytes)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
