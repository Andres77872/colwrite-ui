/**
 * Every key this app keeps in `localStorage`, declared once with its scope,
 * and the only module that touches `localStorage`.
 *
 * A key is `colwrite:{scope}:<name>`:
 *
 * - `device`: how this browser is set up (theme, panel layout, page layout,
 *   engine choice). It outlives a sign-out.
 * - `user`: what belongs to the signed-in account (the cached profile, the
 *   last workspace).
 * - `ws:<workspace id>`: what belongs to one workspace (the last page, the
 *   local starter page, drafts and kept edits, unsent review decisions,
 *   chat selections). A key names the workspace it was written in, so
 *   nothing of one workspace is read in another.
 *
 * Sign-out removes every `user` and `ws:*` key by prefix
 * ({@link clearUserStorage}). A key never changes its scope without changing
 * its name.
 *
 * Storage can be unavailable or full (private windows, quota): every helper
 * here swallows that, and callers treat a miss as "nothing kept".
 */

const DEVICE = 'colwrite:device:';
const USER = 'colwrite:user:';
const WORKSPACE = 'colwrite:ws:';

/** The theme; the pre-paint scripts in `index.html` and `dev-preview.html` read it too. */
export const THEME_KEY = `${DEVICE}theme`;
export const PAGE_SETTINGS_KEY = `${DEVICE}page-settings`;
export const AGENT_ENGINE_KEY = `${DEVICE}agent-engine`;
/** One panel-layout setting (`activeTool`, `leftWidth`, …). */
export const panelKey = (setting: string) => `${DEVICE}panels:${setting}`;
/**
 * The last session refresh, shared between tabs so a tab that lost a refresh
 * race adopts the winner's cookies. Coordination only, never a credential.
 */
export const sessionRefreshKey = (refreshUrl: string) => `${DEVICE}session-refresh:${refreshUrl}`;

export const USER_PROFILE_KEY = `${USER}profile`;
/** The workspace this browser last showed; the server's `last_workspace_id` comes first. */
export const LAST_WORKSPACE_KEY = `${USER}lastWorkspaceId`;

/** Every key of one workspace starts with this. */
export const workspaceStoragePrefix = (workspaceId: string) => `${WORKSPACE}${workspaceId}:`;
/** The page a workspace last had open. */
export const lastPageKey = (workspaceId: string) => `${workspaceStoragePrefix(workspaceId)}lastDocId`;
/** A page's local copy; `null` is the workspace's starter page that has no id yet. */
export const draftKey = (workspaceId: string, documentId: string | null) =>
  documentId === null
    ? `${workspaceStoragePrefix(workspaceId)}doc:local`
    : `${workspaceStoragePrefix(workspaceId)}draft:${documentId}`;
/** Edits of a page that never reached the server. */
export const unsavedKey = (workspaceId: string, documentId: string) =>
  `${workspaceStoragePrefix(workspaceId)}unsaved:${documentId}`;
/** Every unsent review decision of a workspace starts with this. */
export const reviewPrefix = (workspaceId: string) => `${workspaceStoragePrefix(workspaceId)}review:`;
/** Decisions on a change set that were not sent yet. */
export const reviewKey = (workspaceId: string, documentId: string, changeSetId: string) =>
  `${reviewPrefix(workspaceId)}${encodeURIComponent(documentId)}:${encodeURIComponent(changeSetId)}`;
/** The chat a page last had open. */
export const chatSelectionKey = (workspaceId: string, documentId: string) =>
  `${workspaceStoragePrefix(workspaceId)}chat:${documentId}`;
/** The collections open in the sidebar's pages tree (at most 200 ids). */
export const treeExpandedKey = (workspaceId: string) => `${workspaceStoragePrefix(workspaceId)}tree:expanded`;
/** Whether the sidebar's Recent list is folded away. */
export const recentCollapsedKey = (workspaceId: string) => `${workspaceStoragePrefix(workspaceId)}recent:collapsed`;
/** The author said "Not now" to using a collection's PDFs on this page. */
export const pdfOfferDismissedKey = (workspaceId: string, documentId: string) =>
  `${workspaceStoragePrefix(workspaceId)}pdf-offer:${documentId}`;

/** Every `user` key starts with this; sign-out removes them all. */
export const USER_STORAGE_PREFIX = USER;
/** Every workspace key starts with this; sign-out removes them all. */
export const WORKSPACE_STORAGE_PREFIX = WORKSPACE;

export function readItem(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

/** A stored JSON value, or `undefined` when there is none or it is unreadable. */
export function readJson(key: string): unknown {
  const raw = readItem(key);
  if (raw === null) return undefined;
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return undefined;
  }
}

/** False when the browser refused the write (blocked or full). */
export function writeItem(key: string, value: string): boolean {
  try {
    window.localStorage.setItem(key, value);
    return true;
  } catch {
    return false;
  }
}

export function writeJson(key: string, value: unknown): boolean {
  return writeItem(key, JSON.stringify(value));
}

export function removeItem(key: string): void {
  try {
    window.localStorage.removeItem(key);
  } catch {
    /* storage unavailable */
  }
}

/** Every stored key that starts with `prefix`. */
export function keysWithPrefix(prefix: string): string[] {
  const found: string[] = [];
  try {
    for (let index = 0; index < window.localStorage.length; index += 1) {
      const key = window.localStorage.key(index);
      if (key?.startsWith(prefix)) found.push(key);
    }
  } catch {
    /* storage unavailable */
  }
  return found;
}

export function removeByPrefix(prefix: string): void {
  for (const key of keysWithPrefix(prefix)) removeItem(key);
}

/** Sign-out: nothing of the account or its workspaces stays in this browser. */
export function clearUserStorage(): void {
  removeByPrefix(USER_STORAGE_PREFIX);
  removeByPrefix(WORKSPACE_STORAGE_PREFIX);
}

/** The workspace a `colwrite:ws:<id>:…` key belongs to, or `null` for any other key. */
export function workspaceOfKey(key: string): string | null {
  if (!key.startsWith(WORKSPACE)) return null;
  const end = key.indexOf(':', WORKSPACE.length);
  return end > WORKSPACE.length ? key.slice(WORKSPACE.length, end) : null;
}

/**
 * The workspaces the account no longer has (it left them, or they were
 * purged) leave nothing in this browser: every `colwrite:ws:<id>:*` key of a
 * workspace not in `kept` is removed by prefix (08 §5.3, M5.UI-4). The
 * caller keeps the workspaces in the list and the deleted ones still
 * restorable, whose restore is lossless, edits kept on this device included.
 * Returns the workspaces swept.
 */
export function sweepWorkspaceStorage(kept: Iterable<string>): string[] {
  const keep = new Set(kept);
  const swept = new Set<string>();
  for (const key of keysWithPrefix(WORKSPACE)) {
    const workspaceId = workspaceOfKey(key);
    if (workspaceId !== null && !keep.has(workspaceId)) swept.add(workspaceId);
  }
  for (const workspaceId of swept) removeByPrefix(workspaceStoragePrefix(workspaceId));
  // The browser's pointer to its last workspace names one of the account's, or nothing.
  const last = readItem(LAST_WORKSPACE_KEY);
  if (last !== null && !keep.has(last)) removeItem(LAST_WORKSPACE_KEY);
  return [...swept];
}
