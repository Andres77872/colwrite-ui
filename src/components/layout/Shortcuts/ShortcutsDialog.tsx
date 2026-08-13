import { Kbd } from '@/components/ui/kbd';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { SHORTCUTS, modifierLabel, shortcutBindingKey } from './shortcuts';

/**
 * ShortcutsDialog — the reference for the bindings, reachable from Mod+/.
 *
 * Undiscoverable shortcuts are shortcuts nobody uses, and `Kbd` already existed
 * for exactly this and was being spent on a single hint line in the composer.
 */
export function ShortcutsDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const modifier = modifierLabel();

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Keyboard shortcuts</DialogTitle>
          <DialogDescription>
            Switch tools with the arrow keys once the tools rail has focus.
          </DialogDescription>
        </DialogHeader>
        <ul className="mt-4 divide-y divide-border/50">
          {SHORTCUTS.map((shortcut) => (
            <li
              key={shortcutBindingKey(shortcut)}
              className="flex items-center justify-between gap-4 py-2"
            >
              <span className="min-w-0 text-sm">{shortcut.label}</span>
              <span className="flex shrink-0 items-center gap-1">
                {shortcut.keys.map((part) => (
                  <Kbd key={part}>{part === 'Mod' ? modifier : part}</Kbd>
                ))}
              </span>
            </li>
          ))}
        </ul>
      </DialogContent>
    </Dialog>
  );
}
