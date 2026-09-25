import { Fragment } from 'react';
import { Kbd } from '@/components/ui/kbd';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { useReturnFocus } from '@/hooks/useReturnFocus';
import { modifierLabel, shortcutReference } from './shortcuts';

/**
 * ShortcutsDialog — the reference for the bindings, reachable from Mod+/.
 *
 * Grouped the way people look for them (General, Navigation, AI, Editing),
 * one row per action with its alternate chords side by side, and including
 * the editor's own keys that the block and selection menus advertise.
 */
export function ShortcutsDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const modifier = modifierLabel();
  const returnFocus = useReturnFocus();
  const sections = shortcutReference();

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="flex max-h-[min(640px,calc(100dvh-2rem))] max-w-lg flex-col p-0"
        onOpenAutoFocus={returnFocus.onOpenAutoFocus}
        onCloseAutoFocus={returnFocus.onCloseAutoFocus}
      >
        <DialogHeader className="shrink-0 px-6 pb-2 pt-5">
          <DialogTitle>Keyboard shortcuts</DialogTitle>
          <DialogDescription>
            The same actions are in the search palette ({modifier} K), with their shortcuts beside them.
          </DialogDescription>
        </DialogHeader>
        <div className="min-h-0 overflow-y-auto px-6 pb-6">
          {sections.map(({ group, rows }) => (
            <section key={group} aria-labelledby={`shortcuts-${group}`} className="pt-3">
              <h3 id={`shortcuts-${group}`} className="pb-1 text-xs font-medium text-muted-foreground">
                {group}
              </h3>
              <ul className="divide-y divide-border">
                {rows.map((row) => (
                  <li key={row.label} className="flex min-h-9 items-center justify-between gap-4 py-1.5">
                    <span className="min-w-0 text-sm">{row.label}</span>
                    <span className="flex shrink-0 flex-wrap items-center justify-end gap-1 text-xs text-muted-foreground">
                      {row.bindings.map((binding, index) => (
                        <Fragment key={binding.join('+')}>
                          {index > 0 && <span className="px-0.5">{row.joiner ?? 'or'}</span>}
                          <span className="flex items-center gap-0.5">
                            {binding.map((part) => (
                              <Kbd key={part}>{part === 'Mod' ? modifier : part}</Kbd>
                            ))}
                          </span>
                        </Fragment>
                      ))}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
