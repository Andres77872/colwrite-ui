import { PanelHeader, Skeleton, Spinner } from 'colwrite-ui';
import { FileText, Library } from 'lucide-react';

// A single Skeleton is one shimmering bar, so every cell here is a whole loading
// state: bars sized and stacked to stand in for the row that is about to arrive,
// inside the panel chrome that stays put while it loads. Ported from
// ResultsSkeleton (research panels), DocumentsMenu and the profile dashboard.
//
// The containers are border-only rather than `bg-card`: the fill is
// `bg-muted/60` (#1a1a24 at 60%), which is a ~4/255 step above `bg-card` and
// effectively invisible on it. On the app background the same bar reads.
// See .design-sync/learnings/F-feedback.md.

const PANEL = 'overflow-hidden rounded-xl border border-border/60';

export function SearchResultCards() {
  return (
    <div className={`w-80 ${PANEL}`}>
      <PanelHeader title="arXiv" icon={<Library aria-hidden="true" className="h-4 w-4" />} />
      <div aria-busy="true" className="p-3">
        <p className="mb-3 flex items-center gap-1.5 text-xs text-muted-foreground">
          <Spinner className="h-3 w-3" />
          Searching arXiv…
        </p>
        <div aria-hidden="true" className="space-y-3">
          {[0, 1, 2].map((index) => (
            <div key={index} className="rounded-lg border border-border p-3">
              <Skeleton className="mb-2 h-4 w-4/6" />
              <Skeleton className="mb-2 h-3 w-2/3" />
              <Skeleton className="h-3 w-full" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export function DocumentListRows() {
  const widths = ['w-3/4', 'w-2/3', 'w-5/6', 'w-1/2', 'w-4/6'];
  return (
    <div className={`w-64 ${PANEL}`}>
      <PanelHeader title="Documents" icon={<FileText aria-hidden="true" className="h-4 w-4" />} />
      <ul aria-busy="true" className="flex flex-col gap-1 p-2">
        {widths.map((width, index) => (
          <li key={index} className="px-2 py-2">
            <Skeleton className={`h-4 ${width}`} />
          </li>
        ))}
      </ul>
    </div>
  );
}

export function UploadRows() {
  const rows = [
    { title: 'w-3/4', meta: 'w-1/2' },
    { title: 'w-2/3', meta: 'w-2/3' },
    { title: 'w-5/6', meta: 'w-1/3' },
    { title: 'w-1/2', meta: 'w-1/2' },
  ];
  return (
    <div className={`w-full max-w-md ${PANEL} p-4`}>
      <p className="text-md font-semibold">Uploads</p>
      <p className="mt-0.5 flex items-center gap-1.5 text-xs text-muted-foreground">
        <Spinner className="h-3 w-3" />
        Loading the files on your account…
      </p>
      <ul aria-busy="true" className="mt-3 divide-y divide-border/50">
        {rows.map((row, index) => (
          <li key={index} className="flex items-center gap-3 py-3">
            <Skeleton className="h-9 w-9 shrink-0 rounded-md" />
            <div className="min-w-0 flex-1">
              <Skeleton className={`h-4 ${row.title}`} />
              <div className="mt-2 flex items-center gap-2">
                <Skeleton className="h-4 w-16 rounded-full" />
                <Skeleton className={`h-4 ${row.meta}`} />
              </div>
            </div>
            <Skeleton className="h-8 w-16 shrink-0 rounded-md" />
          </li>
        ))}
      </ul>
    </div>
  );
}

export function DashboardTiles() {
  return (
    <div className={`w-full max-w-md ${PANEL} p-4`}>
      <p className="text-md font-semibold">This month</p>
      <div aria-busy="true" className="mt-3 grid grid-cols-2 gap-3">
        {['Documents', 'Words written', 'Uploads', 'Assistant chats'].map((label) => (
          <div key={label} className="rounded-lg border border-border p-3">
            <Skeleton className="h-3 w-2/3" />
            <Skeleton className="mt-3 h-7 w-1/2" />
            <Skeleton className="mt-2 h-3 w-full" />
          </div>
        ))}
      </div>
    </div>
  );
}
