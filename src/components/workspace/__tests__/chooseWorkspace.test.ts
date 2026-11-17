import { describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/api/errors';
import type { WorkspaceList } from '@/data/workspaces';
import { chooseWorkspace } from '../chooseWorkspace';

/**
 * The order of `docs/workspace_collection/08` §3.2: a located `?doc=`, then
 * `?ws=`, the server's last workspace, this browser's, and the personal one.
 * An id the account is not a member of is skipped at every step, and a link
 * says how it was followed: into another workspace, or not at all.
 */

const PERSONAL = 'wsp-personal';
const LAB = 'wsp-lab';
const TEAM = 'wsp-team';

function list(lastWorkspaceId: string | null = null): WorkspaceList {
  const row = (id: string, kind: 'personal' | 'shared') =>
    ({ id, name: id, kind, role: 'owner', icon: null, last_opened_at: null, member_count: kind === 'personal' ? 1 : 2 }) as const;
  return {
    items: [row(LAB, 'shared'), row(PERSONAL, 'personal'), row(TEAM, 'shared')],
    last_workspace_id: lastWorkspaceId,
    capabilities: { multi_workspace: true },
    deleted: [],
  };
}

const nowhere = vi.fn(async () => {
  throw new ApiError('Document not found', 404, { detail: 'Document not found' });
});
const offline = vi.fn(async () => {
  throw new TypeError('Failed to fetch');
});
const at = (workspaceId: string) => vi.fn(async () => ({ workspace_id: workspaceId, collection_id: null }));
const url = (workspaceId: string | null, documentId: string | null = null) => ({ workspaceId, documentId });

describe('chooseWorkspace', () => {
  it('opens a page link in the page’s own workspace, over every other choice, and says it went elsewhere', async () => {
    const locate = at(TEAM);
    expect(await chooseWorkspace(list(LAB), url(PERSONAL, 'doc-1'), LAB, locate))
      .toEqual({ workspaceId: TEAM, documentId: 'doc-1', link: 'elsewhere' });
    expect(locate).toHaveBeenCalledExactlyOnceWith('doc-1');
  });

  it('says nothing about a link into the workspace the order picks anyway', async () => {
    expect(await chooseWorkspace(list(LAB), url(null, 'doc-1'), null, at(LAB)))
      .toEqual({ workspaceId: LAB, documentId: 'doc-1', link: null });
  });

  it('does not open a page it cannot locate, and says the link is unavailable', async () => {
    expect(await chooseWorkspace(list(), url(null, 'gone'), null, nowhere))
      .toEqual({ workspaceId: PERSONAL, documentId: null, link: 'unavailable' });
  });

  it('keeps a page it cannot locate requested in the ?ws= workspace it names, whose read says what it is', async () => {
    expect(await chooseWorkspace(list(), url(LAB, 'trashed'), null, nowhere))
      .toEqual({ workspaceId: LAB, documentId: 'trashed', link: null });
  });

  it('keeps the page requested when the lookup itself failed', async () => {
    expect(await chooseWorkspace(list(), url(null, 'doc-1'), null, offline))
      .toEqual({ workspaceId: PERSONAL, documentId: 'doc-1', link: null });
  });

  it('does not open a page of a located workspace the account is not a member of', async () => {
    expect(await chooseWorkspace(list(), url(null, 'doc-1'), null, at('wsp-elsewhere')))
      .toEqual({ workspaceId: PERSONAL, documentId: null, link: 'unavailable' });
  });

  it('then takes ?ws=, then the server’s last workspace, then this browser’s', async () => {
    const locate = vi.fn();
    expect(await chooseWorkspace(list(LAB), url(TEAM), PERSONAL, locate)).toEqual({ workspaceId: TEAM, documentId: null, link: null });
    expect(await chooseWorkspace(list(LAB), url(null), TEAM, locate)).toEqual({ workspaceId: LAB, documentId: null, link: null });
    expect(await chooseWorkspace(list(null), url(null), TEAM, locate)).toEqual({ workspaceId: TEAM, documentId: null, link: null });
    // No page link, no lookup.
    expect(locate).not.toHaveBeenCalled();
  });

  it('skips ids the account is not a member of, down to the personal workspace', async () => {
    expect(await chooseWorkspace(list('wsp-left'), url('wsp-gone'), 'wsp-old', vi.fn()))
      .toEqual({ workspaceId: PERSONAL, documentId: null, link: null });
  });

  it('says so when the account has no workspace at all', async () => {
    const none: WorkspaceList = { ...list(), items: [] };
    await expect(chooseWorkspace(none, url(null), null, vi.fn())).rejects.toThrow('This account has no workspace.');
  });
});
