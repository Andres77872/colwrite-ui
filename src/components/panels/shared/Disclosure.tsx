import { useState, type ReactNode } from 'react';
import { ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';

interface DisclosureProps {
  /** The always-visible trigger content. */
  summary: ReactNode;
  children: ReactNode;
  /** Overrides the accessible name when `summary` is not self-explanatory. */
  label?: string;
  defaultOpen?: boolean;
  className?: string;
  triggerClassName?: string;
}

/**
 * Disclosure — one expand/collapse treatment for the tool panels.
 *
 * These were three separate raw `<details>/<summary>` pairs, each at a
 * different text size, each rendering the browser's default ▶ marker in a UI
 * that uses lucide chevrons everywhere else. Radix gives the trigger real
 * button semantics and `aria-expanded`, which `<summary>` only approximates.
 */
export function Disclosure({
  summary,
  children,
  label,
  defaultOpen = false,
  className,
  triggerClassName,
}: DisclosureProps) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <Collapsible open={open} onOpenChange={setOpen} className={className}>
      <CollapsibleTrigger
        aria-label={label}
        className={cn(
          'flex w-full items-center gap-1 rounded-sm text-left font-medium transition-colors hover:text-foreground',
          triggerClassName,
        )}
      >
        <ChevronRight
          aria-hidden="true"
          className={cn(
            'h-3 w-3 shrink-0 transition-transform duration-150',
            open && 'rotate-90',
          )}
        />
        <span className="min-w-0 flex-1">{summary}</span>
      </CollapsibleTrigger>
      <CollapsibleContent>{children}</CollapsibleContent>
    </Collapsible>
  );
}
