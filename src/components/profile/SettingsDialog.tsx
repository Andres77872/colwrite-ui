import { useRef } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { useReturnFocus } from '@/hooks/useReturnFocus';
import { ProfileView } from './ProfileView';
import { SettingsEscapeContext } from './settingsEscape';

/**
 * Settings, as a large dialog over the workspace — account, preferences,
 * agent tools, usage and documents — instead of a separate full-screen page
 * that took the sidebar and the open document away.
 *
 * `?view=profile` still addresses it, so the URL stays shareable and Back
 * closes it.
 */
export function SettingsDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const escapeHandler = useRef<(() => void) | null>(null);
  // Opened from a sidebar row or the account menu, never a DialogTrigger:
  // closing hands focus back to whichever it was.
  const returnFocus = useReturnFocus();

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        onOpenAutoFocus={returnFocus.onOpenAutoFocus}
        onCloseAutoFocus={returnFocus.onCloseAutoFocus}
        className="flex h-[min(calc(100dvh-2rem),760px)] max-w-[1040px] flex-col overflow-hidden p-0"
        onEscapeKeyDown={(event) => {
          const handler = escapeHandler.current;
          if (!handler) return;
          // An edit in progress: Escape cancels the edit, not Settings.
          event.preventDefault();
          handler();
        }}
      >
        <DialogTitle className="sr-only">Settings</DialogTitle>
        <DialogDescription className="sr-only">
          Your account, appearance, assistant tools, usage and documents.
        </DialogDescription>
        <SettingsEscapeContext.Provider value={escapeHandler}>
          <ProfileView />
        </SettingsEscapeContext.Provider>
      </DialogContent>
    </Dialog>
  );
}
