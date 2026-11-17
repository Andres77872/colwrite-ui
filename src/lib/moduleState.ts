/**
 * Module-level state that names content (page and change-set ids, a
 * remembered caret, a focus snapshot) registers how to forget it here.
 *
 * React state is reset by remounting the scope that owns it; module state is
 * not, so a sign-out (and, with workspaces, a switch) calls
 * {@link resetModuleState} to drop what belonged to the old scope.
 */
const resets = new Set<() => void>();

/** Called once, at module load, by each module that keeps such state. */
export function registerModuleReset(reset: () => void): void {
  resets.add(reset);
}

export function resetModuleState(): void {
  for (const reset of resets) reset();
}
