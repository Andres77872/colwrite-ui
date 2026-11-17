/**
 * Entry for `dev-preview.html`: the real app, signed in against the mock API
 * (`src/dev/msw`), served by MSW's service worker (served at `/mockServiceWorker.js` by the dev server, `vite.msw-worker.ts`).
 * Open http://localhost:5180/dev-preview.html while `vite` runs.
 */
import { setupWorker } from 'msw/browser';
import { focusManager } from '@tanstack/react-query';
import { USER_PROFILE_KEY, lastPageKey, writeItem, writeJson } from '@/lib/storageKeys';
import {
  FIXTURE_DOCUMENT_ID,
  PERSONAL_WORKSPACE_ID,
  deleteWorkspaceElsewhere,
  editElsewhere,
  moveElsewhere,
  seedSizeFixture,
  setRoleElsewhere,
  trashElsewhere,
  type WorkspaceRole,
} from './msw/fixtures';
import { handlers, unmockedApi } from './msw/handlers';
import { seedPreviewRuns } from './msw/socket';
import { seedReviewFixture } from './msw/reviews';
import { enableImageFixture } from './msw/imageGenerations';
import { VIEWER_WORKSPACE_ID } from './msw/fixtures';

// Every other request (Vite's modules, fonts, the HMR socket) goes out as usual.
await setupWorker(...handlers, unmockedApi).start({ onUnhandledRequest: 'bypass', quiet: true });

const params = new URLSearchParams(window.location.search);
const openPage = () => new URLSearchParams(window.location.search).get('doc') ?? FIXTURE_DOCUMENT_ID;

// `?fixture=size` measures the tree against a full workspace: 300 collections
// up to eight deep, 2,000 pages and 1,500 PDFs. Without it the preview is light.
if (params.get('fixture') === 'size') seedSizeFixture();
if (params.get('fixture') === 'runs') seedPreviewRuns();
if (params.get('fixture') === 'review') seedReviewFixture();
if (params.get('fixture') === 'review-viewer') seedReviewFixture(VIEWER_WORKSPACE_ID);
if (params.get('fixture') === 'images') enableImageFixture();

// For trying the conflict flows by hand from the console. `editElsewhere()`
// changes the open page the way another tab would: the next autosave is
// refused, and the page asks which version to keep. `trashElsewhere(id)` moves
// a page to the Trash the same way; the app looks at once, as it does when its
// window regains focus, so the open page says it is in the Trash, with
// Restore. `moveElsewhere(id, collectionId)` moves a
// page as another tab would (`null` is the top level): the tree catches up
// through `tree_version` on focus or within a minute, and a move this tab
// started from the old place is refused with 412.
// `deleteWorkspaceElsewhere(id)` deletes a shared workspace (the one shown by
// default) as its owner would from another tab: the app's next read of it
// finds it gone, says so, and moves to the next workspace.
// `setRoleElsewhere(role, id)` changes the account's role in a shared
// workspace (the one shown by default) as an admin would from another tab:
// `'viewer'` turns the open page read-only on the next workspace read (unsaved
// edits are kept on this device), `null` removes the account, and the app
// moves to the next workspace. Invitation links: `?invite=cwinv-preview-join`
// joins Thesis committee; `cwinv-preview-expired` and
// `cwinv-preview-mismatch` show the refusals.
const shownWorkspace = () => new URLSearchParams(window.location.search).get('ws') ?? PERSONAL_WORKSPACE_ID;
(window as unknown as { __colwritePreview?: unknown }).__colwritePreview = {
  editElsewhere: (id: string = openPage()) => editElsewhere(id),
  trashElsewhere: (id: string = openPage()) => {
    const trashed = trashElsewhere(id);
    // As if the window had just regained focus: the tree reads `tree_version`.
    focusManager.setFocused(true);
    focusManager.setFocused(undefined);
    return trashed;
  },
  moveElsewhere: (id: string = openPage(), collectionId: number | null = null) => moveElsewhere(id, collectionId),
  deleteWorkspaceElsewhere: (id: string = shownWorkspace()) => {
    const deleted = deleteWorkspaceElsewhere(id);
    // As if the window had just regained focus: the tree reads the workspace.
    focusManager.setFocused(true);
    focusManager.setFocused(undefined);
    return deleted;
  },
  setRoleElsewhere: (role: WorkspaceRole | null = 'viewer', id: string = shownWorkspace()) => {
    const changed = setRoleElsewhere(id, role);
    focusManager.setFocused(true);
    focusManager.setFocused(undefined);
    return changed;
  },
};

// With storage blocked the preview opens signed out.
writeJson(USER_PROFILE_KEY, { name: 'Ada Author', email: 'ada@example.org' });
writeItem(lastPageKey(PERSONAL_WORKSPACE_ID), FIXTURE_DOCUMENT_ID);

await import('../main');
