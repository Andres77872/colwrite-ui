import { useId, type ReactNode } from 'react';
import { cn } from '@/lib/utils';

/*
 * The layout of a Settings pane, shared by Account and Workspace: a titled
 * section of rows, each a label and a short description beside its control.
 */

export function Section({ title, note, children }: { title: string; note?: string; children: ReactNode }) {
  const headingId = useId();
  return (
    <section aria-labelledby={headingId}>
      <h3 id={headingId} className="border-b border-border pb-2.5 text-sm font-medium text-foreground">
        {title}
      </h3>
      <div className="divide-y divide-border">{children}</div>
      {note && <p className="pt-2 text-xs text-muted-foreground">{note}</p>}
    </section>
  );
}

/**
 * One settings row: the label and a short description on the left, the
 * control on the right. On a phone, or for a long field, the control goes
 * under the label at full width.
 */
export function Row({
  id,
  label,
  description,
  stacked = false,
  children,
}: {
  id?: string;
  label: string;
  description?: string;
  stacked?: boolean;
  children: ReactNode;
}) {
  const LabelTag = id ? 'label' : 'p';
  return (
    <div
      className={cn(
        'grid gap-x-8 gap-y-2 py-3.5',
        !stacked && 'sm:grid-cols-[minmax(0,1fr)_minmax(0,17rem)] sm:items-center',
      )}
    >
      <div className="min-w-0">
        <LabelTag {...(id ? { htmlFor: id } : {})} className="text-sm font-medium text-foreground">
          {label}
        </LabelTag>
        {description && <p className="mt-0.5 text-xs text-muted-foreground">{description}</p>}
      </div>
      <div className="min-w-0">{children}</div>
    </div>
  );
}

export function ReadOnlyValue({ value }: { value: string }) {
  return (
    <p className={cn('truncate text-sm sm:text-right', value ? 'text-foreground' : 'text-muted-foreground')} title={value || undefined}>
      {value || 'Not available'}
    </p>
  );
}
