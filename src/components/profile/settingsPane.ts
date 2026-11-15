import { registerModuleReset } from '@/lib/moduleState';

/**
 * Which Settings pane to open next.
 *
 * Settings has no router of its own; a caller that knows which pane the
 * author needs (the assistant's engine menu → "AI & tools") asks for it just
 * before opening the dialog (the workspace menu's "Workspace settings" →
 * Workspace), and the pane view takes the request once when it mounts. Opening Settings any other way still lands on Account.
 */
export type SettingsPane = 'account' | 'preferences' | 'ai' | 'workspace' | 'members' | 'usage';

let requested: SettingsPane | null = null;

// A request left untaken at sign-out must not open the next account's
// Settings on that pane.
registerModuleReset(() => {
  requested = null;
});

export function requestSettingsPane(pane: SettingsPane): void {
  requested = pane;
}

export function takeRequestedSettingsPane(): SettingsPane | null {
  const pane = requested;
  requested = null;
  return pane;
}
