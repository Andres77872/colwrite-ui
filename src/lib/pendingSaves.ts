/**
 * Saves that have to reach the server before the account's data leaves this
 * browser.
 *
 * Sign-out sits above the editor (`AuthProvider`) and removes every `user`
 * key, drafts included. The open page's session registers here so that a
 * deliberate sign-out can first send the edits still inside the autosave
 * window ({@link flushPendingSaves}), and then tell the session the account is
 * gone ({@link endPendingSaves}) before the storage is cleared, so neither a
 * late timer nor the editor's unmount writes a draft back afterwards.
 */
export type PendingSave = {
  /** Send the pending edits now. Settles once the save did, either way. */
  flush: () => Promise<unknown>;
  /** The account is signed out: stop saving, and keep nothing more on this device. */
  end: () => void;
};

const pending = new Set<PendingSave>();

/** Returns the unregister function. */
export function registerPendingSave(entry: PendingSave): () => void {
  pending.add(entry);
  return () => {
    pending.delete(entry);
  };
}

/**
 * Flush every registered save, waiting at most `timeoutMs`: a server that
 * does not answer must not keep the author from signing out.
 */
export async function flushPendingSaves(timeoutMs = 5000): Promise<void> {
  if (pending.size === 0) return;
  const flushes = Promise.allSettled([...pending].map((entry) => entry.flush()));
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<void>((resolve) => {
    timer = setTimeout(resolve, timeoutMs);
  });
  try {
    await Promise.race([flushes, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

export function endPendingSaves(): void {
  for (const entry of pending) entry.end();
}
