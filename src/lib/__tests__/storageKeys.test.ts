import { afterEach, describe, expect, it } from 'vitest';
import {
  LAST_WORKSPACE_KEY,
  THEME_KEY,
  USER_PROFILE_KEY,
  chatSelectionKey,
  draftKey,
  lastPageKey,
  reviewKey,
  sweepWorkspaceStorage,
  treeExpandedKey,
  unsavedKey,
  workspaceOfKey,
} from '../storageKeys';

/**
 * The sweep of workspaces the account no longer has (M5.UI-4, 08 §5.3, 11
 * §5 "Storage scoping"): every `colwrite:ws:<id>:*` key of a workspace not
 * kept is removed by prefix, and nothing else is touched.
 */

afterEach(() => localStorage.clear());

describe('sweepWorkspaceStorage', () => {
  it('removes every key of a workspace that is not kept, by prefix, and leaves the others', () => {
    const kept = 'wsp-kept';
    const gone = 'wsp-gone';
    for (const key of [
      lastPageKey(gone), draftKey(gone, 'd1'), draftKey(gone, null), unsavedKey(gone, 'd1'),
      reviewKey(gone, 'd1', 'cs-1'), chatSelectionKey(gone, 'd1'), treeExpandedKey(gone),
    ]) localStorage.setItem(key, 'x');
    localStorage.setItem(lastPageKey(kept), 'd2');
    localStorage.setItem(unsavedKey(kept, 'd2'), '{}');
    localStorage.setItem(THEME_KEY, 'dark');
    localStorage.setItem(USER_PROFILE_KEY, '{}');
    localStorage.setItem('other-app:key', 'kept');

    expect(sweepWorkspaceStorage([kept])).toEqual([gone]);

    expect(Object.keys(localStorage).sort()).toEqual([
      'colwrite:device:theme',
      'colwrite:user:profile',
      lastPageKey(kept),
      unsavedKey(kept, 'd2'),
      'other-app:key',
    ].sort());
  });

  it('forgets this browser’s last workspace when it is not one of the account’s', () => {
    localStorage.setItem(LAST_WORKSPACE_KEY, 'wsp-gone');
    sweepWorkspaceStorage(['wsp-kept']);
    expect(localStorage.getItem(LAST_WORKSPACE_KEY)).toBeNull();

    localStorage.setItem(LAST_WORKSPACE_KEY, 'wsp-kept');
    sweepWorkspaceStorage(['wsp-kept']);
    expect(localStorage.getItem(LAST_WORKSPACE_KEY)).toBe('wsp-kept');
  });

  it('reads the workspace out of a workspace key only', () => {
    expect(workspaceOfKey(lastPageKey('wsp-1'))).toBe('wsp-1');
    expect(workspaceOfKey(THEME_KEY)).toBeNull();
    expect(workspaceOfKey('colwrite:ws:')).toBeNull();
  });
});
